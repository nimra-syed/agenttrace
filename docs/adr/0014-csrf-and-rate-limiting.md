# ADR-0014: CSRF protection and login/signup rate limiting

Status: Accepted

## Context

ADR-0005 flagged two gaps as deliberate, documented debt, not oversights:
no CSRF protection (relying on `SameSite=Lax` as a baseline) and no
login rate limiting. Both were explicitly noted as mattering more "once
there is a real frontend calling these endpoints from the browser,"
which now exists (M7).

## Decision

### Login and signup rate limiting

`@nestjs/throttler` (NestJS's first-party rate-limiting module), not
hand-rolled: unlike sessions (ADR-0005's deliberate choice to hand-roll
and learn the mechanics), rate limiting isn't the concept being taught
here, so an audited standard library is the safer choice.

Applied only to `POST /auth/login` and `POST /auth/signup`
(`@UseGuards(AuthThrottlerGuard)` + `@Throttle()` directly on those two
handlers), not globally. `ThrottlerGuard` counts **every** request that
reaches the route, not just failed attempts: a real user logging in six
times in sixty seconds gets `429` on the sixth exactly the same as six
wrong-password attempts would. There is no global default limit and no
`@SkipThrottle()` sprinkled elsewhere: nothing else in the API,
including trace/span ingestion, is throttled by this change. A generous
global backstop was considered and rejected specifically because it
would need to exempt high-frequency ingestion routes to avoid breaking
a busy agent's traffic, and that scope wasn't part of what this
milestone set out to fix.

Update, from M12: this is no longer accurate as written.
`ThrottlerModule.forRoot()` now registers a second named throttler
(`'evaluate'`, ADR-0016's cost-containment limit), and `@SkipThrottle()`
now does appear on both `signup`/`login` and the evaluate route, each
opting out of the other's config. See ADR-0016 for why this became
necessary (`ThrottlerGuard` applies every registered named throttler to
any route it guards, not just the one referenced in that route's own
`@Throttle()`) and for the general rule going forward: adding a new
named throttler anywhere in `AppModule` requires auditing every other
throttled route for a matching `@SkipThrottle()`, not just adding the
new route.

#### Keyed on email, not IP

Verified live before deciding this, not assumed: a debug endpoint was
added temporarily to `/health` and hit four ways (direct to the API,
and through the Next.js proxy, each with and without a spoofed
`X-Forwarded-For` header). Result: `X-Forwarded-For` **is** preserved
through the Next.js rewrite, but passed through completely unmodified,
not appended-to the way a real reverse proxy (nginx, a cloud load
balancer) would. There is currently no trustworthy hop to configure
Express's `trust proxy` against — enabling it today would mean trusting
a header any caller can set to anything, which would look like real
client-IP filtering while being trivially bypassable (rotate the
header, bypass the limit entirely). `trust proxy` is deliberately left
at its safe default (disabled), documented directly in `main.ts` so a
future reader doesn't "helpfully" enable it without re-reading this.

Instead, `AuthThrottlerGuard` (extending the library's `ThrottlerGuard`,
overriding `getTracker`) keys on the request body's `email` field,
falling back to `req.ip` only when no usable email is present (a
malformed request, which can't target a specific account through
`AuthService`'s lookup anyway). This protects the thing that actually
matters here — a specific account being brute-forced — without relying
on a network-layer signal that isn't currently trustworthy. Verified
live: spoofing `X-Forwarded-For` does not help bypass the limit, since
the key never uses it.

The email is trimmed but **deliberately not lowercased**. `AuthService`'s
own lookup (`where: { email: dto.email }` against a plain `String
@unique` column, no `citext`, no `@Transform` anywhere in
`SignupDto`/`LoginDto`) is case-sensitive — confirmed by reading it
directly, not assumed. Lowercasing in the tracker would bucket together
two request strings that `findUnique()` treats as two different
accounts, an inconsistency with what the guard is meant to key on.
Malformed or missing email values (non-string, `null`, whitespace-only,
absent) fall back to `req.ip` without throwing; if `req.ip` is itself
ever unavailable, falls back further to a fixed string, so `getTracker`
never resolves to `undefined`.

The `429` response is generic: `{"statusCode":429,"message":"ThrottlerException:
Too Many Requests"}`, confirmed live. No custom `errorMessage` was
configured, so this is the library's own default; it does not echo the
request's email, IP, or any other identifying detail in the body or in
the rate-limit headers it sets (`Retry-After-auth`, limit/remaining/reset
counts only).

#### Known, accepted limitations

- **Process-local storage.** `@nestjs/throttler`'s default storage
  keeps counts in the process's own memory. If `apps/api` ever runs as
  more than one instance, each instance enforces the limit
  independently — 3 instances effectively allow 15 requests/60s, not 5.
  Fixing this needs a shared store (a Redis-backed `ThrottlerStorage`
  implementation); deferred until horizontal scaling is an actual,
  demonstrated need, matching this project's existing pattern for
  deferring distributed infrastructure.
- **Does not prevent distributed credential stuffing.** Per-email
  keying protects one specific account from being brute-forced, but an
  attacker trying one or two passwords each against a large list of
  different email addresses gets a fresh 5-request budget per email —
  the limit was never designed to catch that pattern, and doesn't.
- **Signup throttling is bypassable with different email addresses.**
  The same per-email keying means someone spamming account creation
  with a new email on every request is not meaningfully slowed down;
  each new email starts its own fresh bucket.

Both are accepted as known debt for this milestone, not fixed here. A
future pass at either would likely need a coarser signal (e.g. IP-based
limiting once a real, trustworthy reverse-proxy hop exists, or a
CAPTCHA-style challenge) rather than a fix within the current
email-keyed design.

### CSRF protection: signed, session-bound token

Not a naive double-submit (cookie value literally equals header value):
that pattern only proves two requests came from the same browser
context, not that the *server* ever issued the value — if an attacker
can write any cookie into the victim's browser under the app's origin
by some means other than reading it, naive double-submit is defeated.

Instead: `csrfToken = base64url(HMAC-SHA256(CSRF_SECRET, sessionId))`,
a value that could only have been produced by someone holding
`CSRF_SECRET`. **Validation never reads the request's cookie at all.**
`CsrfGuard` recomputes the HMAC server-side from `request.sessionId`
(attached by `SessionGuard`, which runs first) and compares it against
the `X-CSRF-Token` header using a constant-time comparison
(`crypto.timingSafeEqual`, length-checked first since it throws on a
mismatch rather than returning false). The cookie exists purely so
frontend JS has something to read and echo — it plays no role in the
actual trust decision.

The HMAC input is `session.id` — the session row's own database
primary key — not the raw session token. Only the token's *hash* is
ever stored (ADR-0005); the server cannot re-derive the raw token on a
later request even if it wanted to, so deriving from it would only work
once, at issuance, and `GET /auth/csrf` (recovering a lost CSRF cookie
for an *existing* session) would be impossible. `session.id` is stable
for the session's lifetime, already loaded by `SessionGuard` on every
request, and isn't itself a sensitive bearer credential.

`CSRF_SECRET` is validated at process startup (`main.ts`, before
`app.listen()`) and again defensively inside `computeCsrfToken()`
itself: required, must be at least 64 hex characters (32 random bytes),
rejected if it matches a short list of known placeholder values.
Verified live: missing, placeholder, and too-short values each crash
the process with a clear message before it accepts any traffic; a
valid one starts cleanly. This checks length and format, a reasonable
proxy for "looks like a generated secret" — it cannot prove true
randomness after the fact (64 repeated characters would pass the
length/format check); the actual entropy guarantee comes from how the
value is generated (`crypto.randomBytes(32).toString('hex')`,
documented in `.env.example`), not from the validation function.

Cookie attributes (`agenttrace_csrf`, set at login/signup/bootstrap,
cleared at logout): `httpOnly: false` (the one deliberate difference
from the session cookie — frontend JS must be able to read it),
`secure: isProduction`, `sameSite: 'lax'`, `path: '/'`,
`maxAge: SESSION_DURATION_MS` (same lifetime as the session it's bound
to).

**Rotation**: stable for the session's lifetime, not per-request. Since
the token is a pure function of `(secret, sessionId)`, a new session
(fresh login) automatically produces a new token — rotation is a
consequence of session rotation, with no separate expiry bookkeeping.
Per-request rotation is a stricter, older pattern that adds real
complexity (the frontend must track and update a moving token) for
limited benefit here, given the token is already cryptographically
bound and unguessable without the server secret. Logout clears both
cookies and deletes the session row; even a replayed token has no
active session left to authenticate against.

**Exemption is by authentication mechanism, not by `@Public()`**:
`CsrfGuard` enforces only when `request.user` is set (a session
actually authenticated this request) **and** `request.apiKeyContext` is
not set — checked explicitly, not inferred from `@Public()`, since that
decorator also covers genuinely anonymous or API-key routes for an
unrelated reason (skipping `SessionGuard`), not "skip CSRF." This means:

- Truly public routes and API-key routes are skipped because no session
  authenticated them, not because someone remembered to mark them
  `@Public()` for a different reason.
- `login`/`signup` are skipped because there's no session yet at the
  point they run.
- `logout` is skipped for the same reason: it's `@Public()` specifically
  so `SessionGuard` never runs for it (ADR-0012's redirect-loop fix
  depends on logout working even with a stale/invalid cookie). A
  forced-logout CSRF is a minor nuisance, not a real compromise.
- Non-mutating methods (`GET`/`HEAD`/`OPTIONS`) are always skipped.

`GET /auth/csrf`, session-authenticated, lets an existing session (one
created before this feature existed, or one whose CSRF cookie was
separately lost) recover a valid cookie without a full logout/login
cycle.

## Alternatives considered

- **`csurf`** (the classic Express CSRF middleware). Rejected: it's
  deprecated and no longer recommended; there's no current first-party
  NestJS equivalent to reach for instead.
- **Naive double-submit cookie** (cookie value equals header value,
  compared directly). Rejected in favor of a signed, session-bound
  token — see above for why a naive comparison doesn't actually prove
  the server issued the value.
- **A generous global rate limit with per-route exemptions.** Rejected
  in favor of applying the guard only where it's needed (login, signup)
  — avoids needing to remember to exempt every current and future
  high-frequency route.
- **IP-based throttling**, trusting `X-Forwarded-For` as-is. Rejected
  after live verification showed it would be trivially spoofable given
  this project's current proxy topology.

## Consequences

- Gain: both gaps ADR-0005 explicitly deferred are closed, with the
  CSRF design stronger than the originally-sketched naive double-submit
  (server-validated and session-bound, not just "two cookies that
  happen to match").
- Gain: the throttle's tracking key was verified to actually match how
  authentication identifies an account (case-sensitive, untrimmed),
  rather than introducing a subtly different notion of "same account."
- Give up: rate limiting only protects a single account from being
  brute-forced one credential at a time; it does not defend against
  credential stuffing across many accounts or signup spam across many
  emails (see Known limitations above) — accepted as this milestone's
  scope, not a gap to close now.
- Give up: without a real reverse proxy in front of this stack, there
  is currently no trustworthy per-client-IP signal available anywhere
  in the API, not just for rate limiting. Revisit once one exists.
