# ADR-0009: SDK design

Status: Accepted

## Context

Starting with M6, something other than us testing the API by hand needs
to report traces and spans: a real reference agent. Calling the raw
ingestion API directly would mean hand-building HTTP requests, tracking
timestamps, and re-deriving the external id / upsert pattern from M4 in
every agent that wants to use AgentTrace. The SDK exists to make that
unnecessary, at the cost of taking on a few real design decisions about
what an observability library is allowed to do to the code it instruments.

## Decision

### Wrap a function, do not expose raw start/end calls

`client.trace(info, async (trace) => { ... })` measures start and end
time itself, and `trace.span(info, async (span) => { ... })` nests the
same way, as deep as needed. This is closer to how Sentry and
OpenTelemetry's active-span APIs work than to a bare HTTP client, and it
is what actually earns the SDK's existence: timing, status, and error
capture the caller would otherwise do by hand.

### Fail open, always, with a bounded timeout to make that possible

Every outbound call is wrapped so a failure (network error, timeout, a
non-2xx response) is caught, logged as a warning, and resolved to
`undefined`, never thrown. This is completely separate from the wrapped
code's own errors: if the callback throws, that error is recorded on the
trace or span and then re-thrown unchanged, so wrapping code never
changes its behavior from the caller's point of view. Only AgentTrace's
own reporting failures are swallowed.

Fail-open only actually holds if a hanging request cannot also hang the
caller. Every request has a bounded timeout (default 5 seconds,
configurable), implemented with a real `AbortController`: a `setTimeout`
calls `controller.abort()`, cleared in a `finally` block regardless of
outcome. Without this, a slow or unresponsive AgentTrace instance could
delay the actual agent it's instrumenting, which is a worse outcome than
just not being instrumented at all.

### No automatic output capture

A wrapped function's return value is never sent as `output`
automatically. `trace.setOutput(value)` / `span.setOutput(value)` are
the only way output gets recorded, and they must be called deliberately.
Automatically capturing a return value would mean application code
returning a result silently determines what gets sent over the network
to a third system, and that return value could contain secrets, private
user data, a circular reference (which would crash a naive
`JSON.stringify`), or simply be very large. `input` stays as an explicit,
optional argument at call time instead, since it was already opt-in by
construction, not something automatically captured.

### Wall-clock timestamps, monotonic duration

`startedAt` / `endedAt` sent to the API are real timestamps
(`new Date().toISOString()`), what a person looking at a dashboard
actually wants to see. `durationMs` is computed from `performance.now()`
readings taken at the same two moments, not from subtracting the two
`Date`s. Wall-clock time can jump, forward or backward, due to NTP
correction or a system clock adjustment; a monotonic clock cannot. Using
`Date` for duration would occasionally produce a wrong, or even
negative, number for reasons that have nothing to do with how long the
code actually took to run. This is verified directly in
`trace-context.spec.ts` by mocking only `performance.now()` and
confirming the real (unmocked) wall-clock time never leaks into the
result.

### The end call never assumes the start call succeeded

Every finish call (trace or span) sends a complete payload, not a
partial update, name, type, `startedAt`, status, `endedAt`, duration,
input, everything needed to create a correct row from nothing. This
matters because a start call's outcome is not just success-or-failure:
a timeout specifically means we stopped waiting, not that the server
didn't process the request. Treating "we didn't get a confirmed
response" as "the row definitely doesn't exist" would be wrong, and
depending on it would mean a slow-but-successful start could leave the
finish call unable to create or update anything correctly. Since both
calls upsert by the same external id (M4), a self-sufficient finish call
is correct either way: creating the row if the start attempt never
landed, updating it if it did.

This has one real consequence for spans specifically, since
`POST /traces/:traceId/spans` needs the trace's actual server-assigned
id in the URL, not just its external id. If the trace's start call never
confirms a server id, there is no valid URL to report any span against,
so span reporting is skipped entirely for that trace's run. The real
agent code is never affected, only telemetry for that run's spans is
missing. Likewise, a child span only gets a `parentSpanId` if its
parent's start call confirmed a server id; if it didn't, the child is
still reported, just without a parent reference, a flatter tree instead
of lost data. None of this tries to achieve a perfectly reconstructed
tree under failure, only "do not lose data you can still report, and
never crash the agent."

### Safe, bounded error capture, no stack traces for now

`normalizeError` handles three cases: a real `Error` (its `message`,
falling back to `.name`), a thrown string (used directly), and anything
else (a fixed generic message naming only its `typeof`, deliberately
never `JSON.stringify`'d, for the same reason output is not
auto-captured, an arbitrary thrown value could contain anything).
Every result is truncated to a bounded length. **Stack traces are not
captured in M5.** Only the message is sent. A stack can be large, and
can reveal local file paths; this is a deliberate simplification, worth
revisiting if debugging from the dashboard alone, without a stack,
proves insufficient once there's real usage to learn from.

### Warnings can only ever describe the failure kind, never its content

The internal warning logger's own type signature only accepts a fixed
set of safe reasons (`timeout`, `network-error`, `http-error` with a
status code, `invalid-response`). There is no code path by which a call
site could pass through the request body, the response body, a header,
or the API key, even by mistake, since the function simply does not
accept a parameter shaped like that.

### Shared types are wire-format only

`CreateTracePayload` / `CreateSpanPayload` / `TraceRecord` / `SpanRecord`
in `packages/shared-types` describe JSON over HTTP: every timestamp is a
plain ISO 8601 string, since JSON has no native Date type. They do not
import anything from `apps/api`'s generated Prisma client, and
`apps/api`'s `CreateTraceDto` / `CreateSpanDto` now `implements` the
matching payload type. That `implements` is a compile-time shape check
only, catching the API and the SDK's contracts drifting apart; it does
not validate anything at runtime. The `class-validator` decorators
already on those DTOs remain the actual runtime validation for incoming
requests, unchanged.

## Alternatives considered

- **Capture the callback's return value as output automatically.**
  Rejected, see above. This was the original plan going into this
  milestone and was corrected before implementation.
- **Retry a failed request.** Rejected for M5. Safe to add later, since
  the upsert pattern already makes retries idempotent, but not needed
  yet, and fail-open already means a dropped report is just missing data,
  not a crash.
- **A pluggable logger.** Rejected for now. `console.warn` is enough
  until there's a real need to redirect SDK warnings somewhere else.
- **Real ECMAScript modules (`"type": "module"`) for this package.**
  Rejected, at least for now. Jest's default configuration expects
  CommonJS-shaped output from its transformer, and fighting that (Node's
  experimental VM modules flag, ts-jest's ESM mode) for a package with no
  real external consumer yet was not worth it. Matches `apps/api`'s own
  convention already.

## Consequences

- Gain: a wrapper API that adds real value over a bare HTTP client, fail
  open behavior that cannot itself become a source of hangs or crashes,
  and a shared type contract between the API and the SDK that a
  typechecker, not just a person, will catch drifting apart.
- Give up: telemetry (not the agent's actual behavior) can have gaps or
  a flatter-than-real tree under real failures, no stack traces yet, and
  a single dropped, unretried request under transient network issues.
- Later: an imperative API (`client.startTrace()` returning a handle with
  its own `.end()`) is a real possibility once there's an actual need for
  it. The transport (`HttpTransport`) and the state-tracking pieces
  (`MutableRecordState`, `normalizeError`) are already decomposed
  independently of the wrapper's control flow, so that would be an
  additional entry point into the same pieces, not a rewrite.
