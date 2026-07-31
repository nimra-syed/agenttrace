# ADR-0017: Installation credentials (CLI-connect backend)

Status: Accepted

## Context

Onboarding a new application onto AgentTrace meant manually creating a
project API key in the dashboard and pasting it into a `.env` file. That
worked for one person connecting one app, which is exactly how BeautyLab
was connected. It doesn't scale to a team, a research lab, a university
course, or an open-source project: either everyone shares one project
key (no attribution, no way to revoke one person without revoking
everyone) or an admin manually provisions and hands out a key per
person, which doesn't scale operationally and turns every handoff into
a leak surface.

`docs/architecture/cli-onboarding-design.md` designs the fix: a
browser-based, self-service flow (`agenttrace connect`) where a signed-in
person approves a new, individually-revocable credential for a specific
project, without ever typing or copying a secret by hand. That design
was split into three milestones. This ADR covers M13 only: the backend
half, schema, the authorize/approve/exchange endpoints, list/revoke, and
generalized ingestion auth. No dashboard UI (M14) and no real CLI (M15)
exist yet; everything here was verified with curl.

## Decision

### Two credential types, kept separate on purpose

`Installation` is new, distinct from the existing `ApiKey`. `ApiKey`
answers "which system is this credential for" (impersonal,
admin-provisioned, right for CI and production agents, where there's no
human present to click "approve" in a browser). `Installation` answers
"which human connected this" (personal, self-service, created via the
browser flow below). Both authenticate ingestion the same way (a Bearer
token, same guard), but they're separate tables with separate lifecycle
and attribution fields, not one table trying to serve both purposes.

### The raw secret is generated at exchange time, not approval time

This is a real deviation from the design doc's illustrative schema
sketch, decided during implementation, not before. The design doc shows
`Installation.tokenHash` as non-nullable, which would require generating
the raw secret at browser-approval time and persisting it somewhere
(even briefly) so the later token-exchange step could hand it back to
the CLI. That conflicts with this project's existing rule, applied
without exception to every other credential (`Session`, `ApiKey`): a raw
secret is never stored anywhere, only its hash.

Instead, `Installation.tokenHash` is nullable and starts `null`. The row
is created and visible the moment a person approves the connection in
the browser (this is what a future dashboard, M14, would show as
"Pending"), but nothing has actually authenticated with it yet, since a
Bearer lookup by hash can never match a `null` column. The raw secret is
only generated inside `InstallationsService.exchangeToken`, when the CLI
completes the second half of the flow, closer to how a real OAuth
authorization-code grant works: a code is minted at authorize time, a
token is minted at exchange time.

### The flow: authorization code plus PKCE, not the secret itself

`POST /cli/authorize` (session-authenticated, CSRF-protected, same as
every other mutating dashboard action) checks project ownership
(`ProjectsService.findOwnedProject`, the same check every other
project-scoped route already uses), creates the `Installation` row, and
creates a `CliAuthorizationCode`: a short-lived (60 second), single-use,
hashed-at-rest code bound to the PKCE `code_challenge` the caller
supplied. Returns the raw code once.

`POST /cli/token` (public, no session, this is the CLI calling directly,
not a browser) takes that code plus the PKCE `code_verifier`, recomputes
the challenge from it (`computeCodeChallenge`, SHA-256 then base64url,
RFC 7636's S256 method) and compares it against what was stored,
constant-time (`codeChallengesMatch`, the same discipline
`csrfTokensMatch` already established, ADR-0014). On success, inside a
`prisma.$transaction`, the code is atomically claimed
(`updateMany` scoped to `usedAt: null`, checking the affected row count
to close the race window between two concurrent exchange attempts for
the same code), a real secret is generated, hashed, and written to the
previously-`null` `Installation.tokenHash`. The raw secret is returned
exactly once, the same "shown once at creation" guarantee `ApiKey`
already makes, just deferred to this exchange step instead.

Every exchange failure (unknown code, expired, already used, PKCE
mismatch, lost the atomic-claim race) returns the same generic message.
Same don't-distinguish-failure-reasons discipline as `ApiKeyGuard`'s own
uniform 401, applied here too.

### Generalized ingestion auth, not a second guard

`ApiKeyGuard` (`apps/api/src/api-keys/api-key.guard.ts`) now tries an
`ApiKey` lookup first, and falls through to an `Installation` lookup if
that misses. Both paths reject with the exact same generic
`'Invalid API key'` message, extending the existing uniform-error-message
rule to cover the new credential type rather than introducing a second,
differently-worded failure mode. A row whose `tokenHash` is still
`null` (approved but never exchanged) can never match here: `null` never
equals the hash of any real submitted token, so no special-casing was
needed to exclude pending rows from ever authenticating anything.

`ApiKeyContext` (the object every ingestion route reads) grew two
optional fields, `apiKeyId` and `installationId`, exactly one of which
is set depending on which table matched. Every existing consumer
(`TracesController`, `SpansController`) only ever read `projectId`, so
widening these two fields didn't change any existing call site's
behavior.

### Trace provenance: a new nullable column, added now on purpose

`Trace.installationId` (nullable, set only on the create branch of
ingestion, never on update, and only when the request authenticated via
an `Installation`) is new schema surface added in this same migration,
even though nothing in M13 reads it back out yet. The reasoning is
practical, not aesthetic: this is the column a future "last active,
reporting as `skincare-agent`" detail in the M14 Connected Applications
panel would need, and it's nearly free to add in this migration but
cannot be backfilled for traces ingested before it existed. Provenance
means "who created this record," not "who last touched it," so an
update to an existing trace (matched by `externalTraceId`) never
overwrites the `installationId` set at creation.

### A third named throttler, with `@SkipThrottle()` applied everywhere upfront

`POST /cli/token` is public and unauthenticated, so it gets its own
named throttler (`'cli-token'`), keyed on a hash of the submitted code
(`CliTokenThrottlerGuard`), not IP, for the same reason
`AuthThrottlerGuard`/`EvaluationThrottlerGuard` already avoid IP-keying
(ADR-0014: this project's proxy topology doesn't add a trustworthy
`X-Forwarded-For` hop). Codes are already high-entropy, hashed, and
single-use, so this throttle is defense-in-depth against abuse, not the
primary security control; PKCE and the code's own properties are.

M12 (ADR-0016) found, live, that `ThrottlerGuard` applies every named
throttler registered centrally to any route it guards, not just the one
a route's own `@Throttle()` references, meaning a new named throttler
silently also applies to every other already-throttled route unless
explicitly skipped. That lesson was applied proactively here, not
rediscovered: `/cli/token` skips `auth` and `evaluate`, and
`AuthController`'s `signup`/`login` and `EvaluationsController`'s
`evaluate` were each updated to skip `cli-token`. A regression test
(extending `throttler-scoping.integration.spec.ts` to all three named
throttlers, not just the original two) proves each is actually isolated
to its own route, not just intended to be.

## Alternatives considered

- **Merging `Installation` into the existing `ApiKey` table** (an
  optional `createdByUserId` column on `ApiKey` instead of a new
  table). Rejected: the two answer genuinely different questions
  (impersonal/service vs personal/self-service), and keeping them
  separate means each can grow its own fields later without polluting
  the other, which the design doc already reasoned through before this
  milestone started.
- **Generating the raw secret at browser-approval time**, matching the
  design doc's original schema sketch. Rejected during implementation:
  it would mean persisting a raw secret somewhere, even briefly, which
  this project has never done for any other credential. See "The raw
  secret is generated at exchange time" above.
- **A true OAuth 2.0 Device Authorization Grant (RFC 8628)** instead of
  a code-plus-PKCE exchange. Already rejected at the design-doc stage
  for the primary scenario (a developer with a local browser); this
  milestone doesn't revisit that, it only implements the backend half of
  the loopback-style flow the design doc chose.
- **IP-based throttling for `/cli/token`.** Rejected for the same
  reason `AuthThrottlerGuard` already rejected it: no trustworthy
  network-layer signal exists in this project's current topology.

## Consequences

- Gain: a person can be individually connected and individually revoked
  without an admin manually provisioning anything, and without a raw
  secret ever being persisted anywhere before it's actually needed.
- Gain: the cumulative-named-throttler class of bug (ADR-0016) didn't
  recur here, specifically because it was designed against upfront
  instead of found live a second time.
- Gain: `Trace.installationId` exists now, before any UI needs it,
  avoiding a backfill problem for every trace ingested between M13 and
  whichever milestone first reads the column back out.
- Give up (accepted, not fixed in this milestone): approving a
  connection in the browser and then never completing the CLI exchange
  leaves a permanently-`Pending` `Installation` row (and its unused,
  eventually-expired `CliAuthorizationCode`) with no automated cleanup.
  These are harmless (a `null`-`tokenHash` row can never authenticate
  anything), just not swept up. A person can revoke them manually from
  the dashboard once M14 exists; an automated sweep is a reasonable
  future addition, not built here, matching this project's general
  preference for deferring cleanup infrastructure until it's a
  demonstrated need rather than a hypothetical one.
- Give up: no dashboard UI or real CLI exist yet. This milestone is only
  verifiable by someone willing to run curl and read Postgres directly,
  same as `ApiKey`'s own M3 was before M10 built its UI.
