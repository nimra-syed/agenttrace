# ADR-0007: API key design

Status: Accepted

## Context

Sessions (ADR-0005) work for a browser with a logged in person behind it.
Starting with M4, requests will come from code instead, a script or an
agent sending traces to AgentTrace. That kind of caller cannot log in
through a form, so it needs a different way to prove it is allowed to
write to a specific project.

## Decision

A project can have any number of API keys. Each key looks like
`atr_<random>`, generated with `crypto.randomBytes(32)`, the same
approach we already use for session tokens, never `Math.random()`, which
is not safe for anything security related.

Only the SHA-256 hash of the key is stored, reusing the same `hashToken`
function sessions already use, now moved to a shared file
(`apps/api/src/common/hash-token.util.ts`) since it is not specific to
either feature. A short prefix (the first 12 characters, like
`atr_3ssG-ZCW`) is stored separately and shown in key lists, so a user
can tell their keys apart without us ever being able to show the full key
again after creation.

A key can be revoked (`revokedAt` gets set), never hard deleted. This
keeps a record that the key existed and was later turned off, useful for
audit purposes later. Revoking is idempotent: calling revoke on a key
that is already revoked returns success without touching the row again,
so the original `revokedAt` timestamp, the actual moment of revocation,
is never silently overwritten by a later, redundant call.

`lastUsedAt` exists on the schema and is shown in key list responses,
but `ApiKeyGuard` does not write to it on every authenticated request.
Doing so would add a database write to every future ingestion call
(M4), the highest volume path in this whole system, just to track a
field that is only useful for a human occasionally checking "is this key
still in use." Revisit with a throttled or asynchronous update (for
example, only write when the stored value is more than an hour old)
once ingestion exists and the tradeoff actually matters.

Authentication with a key uses a normal `Authorization: Bearer <key>`
header, checked by a new `ApiKeyGuard`. Every failure case, a missing
header, a malformed header, an unknown key, or a revoked key, returns the
exact same response: `401 Invalid API key`. We tested this directly (see
`api-key.guard.spec.ts`), since it would be easy to accidentally leak
which failure case happened through slightly different error messages,
and that difference is useful information to someone trying to guess or
brute force a key.

Managing keys (create, list, revoke) requires two checks together: the
project has to belong to the caller's organization, and, for revoke
specifically, the key being revoked has to actually belong to that
project. Both checks reuse `ProjectsService.findOwnedProject`, which
returns `404 Not Found` instead of `403 Forbidden` for a project that
exists but is not the caller's, consistent with the same reasoning from
M2's authorization work: do not confirm the existence of something the
caller cannot access.

`GET /api-keys/verify` is a temporary, diagnostic endpoint added in this
milestone specifically to prove the guard works end to end with a real
HTTP request, before M4 gives us a real endpoint (trace ingestion) to
test the guard against instead. It is not meant to become permanent API
surface without a deliberate decision. Once M4 exists, we will decide
whether to remove it, gate it behind a development only flag, or keep it
on purpose as a supported "check my key" endpoint for future SDK authors.

## Alternatives considered

- **JWT style API keys (self-verifying, no database lookup).** Rejected,
  for the same reason sessions are not JWTs. A key needs to be revocable
  right away. A self-verifying token stays valid until it expires no
  matter what the database says.
- **Returning `403 Forbidden` for a project in a different org.**
  Rejected. It would tell an attacker "this id is real, you just cannot
  use it," which is more information than they should get.
- **Different error messages per failure case in `ApiKeyGuard`** (for
  example, "missing key" versus "revoked key"). Rejected on purpose, for
  the reason explained above.

## Consequences

- Gain: a key system that follows the exact same hashing pattern as
  sessions, one shared mental model instead of two, and an authorization
  boundary that is unit tested, not just assumed to work.
- Give up: no key expiration yet, keys are valid until manually revoked.
  Common for developer facing API keys (GitHub personal access tokens
  behave the same way by default), acceptable for now.
- Later: `/api-keys/verify` needs a real decision once M4 exists, see
  above. Rate limiting on key usage is still deferred to the later
  hardening milestone, same as login rate limiting from ADR-0005.
