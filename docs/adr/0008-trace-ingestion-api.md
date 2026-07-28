# ADR-0008: Trace ingestion API design

Status: Accepted

## Context

`POST /traces` and `POST /traces/:traceId/spans` are the first endpoints
called by something other than us testing the API by hand, an agent's
own instrumentation. A real agent run takes real time, so these calls
need to support reporting a trace or span more than once as it goes from
started to finished, safely, without duplicating rows or losing data
that was already written.

## Decision

### Upsert, not separate start/end endpoints

Both endpoints act as an upsert keyed by a client supplied identifier
(see naming section below). If that identifier is new, a row is
created. If it already exists for that project (traces) or that trace
(spans), the existing row is updated instead. This lets an agent report
"this trace just started" and later "this trace just finished" using the
same two calls, without needing four separate endpoints (start trace,
end trace, start span, end span).

The actual write always goes through Prisma's `upsert()`, which Postgres
executes as one atomic statement, not a find-then-decide-what-to-do
flow in application code. That matters under concurrent retries: if a
network call is retried, two requests for the same logical write can
arrive close together, and the database, not our code, has to be the
thing that decides atomically whether that is a first insert or a
repeat update.

### Omitted fields are preserved, explicit null clears them

On an update, a field the client did not include in the request body is
left untouched in the database. A field explicitly sent as `null` does
overwrite the existing value. This relies on a real Prisma behavior:
passing `undefined` for a field in `create`/`update` data means "don't
mention this column," while `null` means "write an actual NULL." Our
code just needs to avoid accidentally converting an omitted field into
something other than `undefined` (for example by applying a fallback
default) before it reaches Prisma. We verified this directly with a real
request: creating a trace with `input` set, then updating it without
resending `input`, left the original value in place; a later request
sending `input: null` explicitly cleared it.

The one field this does not apply to cleanly is `status`, since it has
an actual database default (`RUNNING`). An omitted `status` on a create
should become `RUNNING`; an omitted `status` on an update should leave
whatever status is already stored. So `status` is computed differently
for the create branch (`dto.status ?? RUNNING`) versus the update branch
(`dto.status`, left as `undefined` when omitted). Every other field is
shared as-is between both branches, since none of the others have a
database default worth preserving.

Fields that are required with no default (`name`, `agentName`,
`startedAt` on traces; `name`, `type`, `startedAt` on spans) are required
on every request, including updates. This keeps them simple: they never
need to be merged with a previous value, because the client always
resends them. In practice these do not change over an entity's
lifetime anyway.

Prisma's JSON columns need one more layer here: a plain JS `null` is
ambiguous for a nullable JSON column, since it could mean "no value" or
"the JSON value `null`." A small helper (`toJsonInput`) maps an explicit
`null` to `Prisma.DbNull`, which means "clear the column," matching the
behavior we want for every other field type.

### externalTraceId and externalSpanId, not idempotencyKey

The `Trace` table had an `idempotencyKey` column since M1. This
milestone renamed it to `externalTraceId`, and added `externalSpanId` to
`Span`, because "idempotency key" is the wrong mental model for what
this field actually does. A textbook idempotency key (Stripe's pattern,
for example) exists to safely retry one specific request; the advice
that comes with that pattern is to generate a fresh key per distinct
operation. If an SDK author followed that advice literally here, they
would generate a new key every time they called the API for the same
span, which would silently break the "report now, update later" pattern
this whole design depends on. Calling it `externalTraceId` /
`externalSpanId` states the real contract: this is the client's chosen,
stable identity for this entity, reused deliberately across calls,
which also happens to make retries safe as a side effect, rather than
being a value invented fresh per request. This is also why `.upsert()`
was already the right implementation before the rename: the mechanism
did not change, only the name, once the name was understood to mean the
wrong thing.

The column was dropped and recreated rather than data-migrated, since
there was no real data at stake locally.

### parentSpanId requires parent-first ingestion

`parentSpanId` refers to the server-assigned `Span.id` of an
already-created span, not the client's own `externalSpanId`. This means
a client must create a parent span before it can create a child span
that references it, which is naturally true for a synchronous agent (a
step starts, calls sub-steps, sub-steps finish, the step finishes).

This would not hold for a future distributed or batched SDK, where a
child span's write could arrive before its parent's due to network
reordering or parallel delivery. Supporting that would need either
accepting an unresolved parent reference and reconciling it once the
parent arrives, or letting a child reference a parent by the parent's
own `externalSpanId` instead of a server-assigned id it may not have
seen yet. Neither is built now. This is a real limitation of the current
design, not an oversight, and worth revisiting only once there is an
actual out-of-order ingestion need (a queue-based SDK, for example).

### Semantic validation

- `durationMs`, `promptTokens`, `completionTokens`, `totalTokens` must be
  nonnegative integers; `costUsd`, `totalCostUsd` must be nonnegative
  numbers. Enforced declaratively with class-validator on the DTOs.
- `endedAt` must not be before `startedAt`. Since `startedAt` is always
  present on every request (see above), this check only ever needs the
  current request's own fields, no lookup of a previous value is needed.
- A span cannot be its own parent. This is only possible on the update
  path (an existing span, found by its `externalSpanId`, would need to
  already know its own server-assigned id to reference itself), so the
  check only runs a lookup when both `externalSpanId` and `parentSpanId`
  are present on the same request, not on every request.

### lastUsedAt: updated after authentication, throttled to once per hour

M3 deferred writing `ApiKey.lastUsedAt` to avoid a database write on
every single authenticated request, once ingestion made that the
busiest path in the system. It is now implemented in `ApiKeyGuard`,
updated after a key successfully authenticates, not after the request it
authenticated also happens to succeed, since a key that is being
correctly presented but hitting validation errors downstream is still
"in use," and should not look stale to someone deciding whether it is
safe to revoke. The write is throttled: it only happens if the stored
value is missing or more than an hour old, bounding it to at most one
write per key per hour no matter how many requests that key makes.

## Alternatives considered

- **Separate start/end endpoints for traces and spans.** Rejected for
  now. Doubles the endpoint surface for a benefit (explicit lifecycle
  transitions) the upsert pattern already delivers with fewer moving
  parts.
- **Server-computed `totalTokens` / `totalCostUsd` on the trace**, by
  summing the trace's spans on every write. Rejected for now. The client
  already has this data by the time it reports a finished trace, and
  recomputing it server-side on every ingestion write is real cost we do
  not need yet. Revisit as a background job if client-reported totals
  ever prove untrustworthy.
- **A separate, dedicated idempotency mechanism** (an `Idempotency-Key`
  header, independent of entity identity) for true retry-only
  deduplication. Not needed: every write in this API is already scoped
  to a specific trace or span, so "retry this exact write" and "refer to
  this exact entity" are the same thing here.

## Consequences

- Gain: one ingestion contract that supports both "report once" and
  "report progressively" clients, an authorization boundary
  (project/org/trace ownership) consistent with every earlier milestone,
  and validation that catches real mistakes (bad time ranges,
  self-parenting, negative numbers) before they become bad data.
- Give up: parent-first ingestion is a real constraint on ingestion
  order. Out-of-order or batched span reporting is not supported yet.
- Later: `GET /api-keys/verify` (from M3) now has a real endpoint to be
  tested against; it was kept as a permanent, supported "check my
  credentials" endpoint rather than removed, per the M4 planning
  discussion.
