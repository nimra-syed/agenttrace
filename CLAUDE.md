# CLAUDE.md

## Project purpose

AgentTrace is an observability and evaluation platform for AI agents: it
records an agent's LLM calls, tool calls, latency, token usage, cost, and
errors as traces/spans, and presents them in a web dashboard. Built as a
portfolio project that is also a genuinely production-quality system —
optimizing equally for engineering skill growth, production quality, and
interview readiness. Not optimized for community adoption.

## Architecture overview

Modular monolith in a pnpm-workspace monorepo. Distributed infrastructure
(queues, Kafka, ClickHouse, Kubernetes, Temporal) is deferred until there is
a concrete, demonstrated need — see `docs/adr/` for the reasoning behind
every major choice.

```
apps/
  web/               Next.js (App Router, TS, Tailwind) dashboard
  api/                NestJS backend — auth, orgs/projects, API keys, ingestion
  reference-agent/    instrumented example AI agent (added at M6)
packages/
  sdk/                AgentTrace instrumentation client
  shared-types/        Trace/Span/DTO types shared across web, api, sdk
docs/
  architecture/        diagrams, written architecture docs
  adr/                  architecture decision records
  learning-journal.md
infra/
  docker/               docker-compose.yml (local Postgres, later Redis)
```

Data model: an `Organization` has `Membership` rows (with a role) linking
it to `User`s, and has `Project`s, which have `Trace`s, which have `Span`s
(self-referencing `parentSpanId` tree, same shape as OpenTelemetry
trace/span). Schema lives at `apps/api/prisma/schema.prisma`, see
ADR-0003 for field/index reasoning and ADR-0004 for why Prisma (not
Drizzle). Prisma Client is generated to `apps/api/generated/prisma`
(gitignored, regenerate with `pnpm --filter api prisma:generate`) and
constructed with an explicit `@prisma/adapter-pg` driver adapter, see
`apps/api/src/prisma/prisma.service.ts`.

Auth is a hand-rolled, database-backed session system (not JWT, not
Passport), see ADR-0005. A `SessionGuard` is registered globally, so every
new route is protected by default unless marked with `@Public()`. Each
user has exactly one organization for now, created automatically at
signup, see ADR-0006.

Non-browser clients (scripts, agents, SDKs) authenticate with an API key
instead of a session, see ADR-0007. `hashToken` (used by both sessions
and API keys) lives in `apps/api/src/common/hash-token.util.ts`, shared
on purpose since it is not specific to either feature. `ApiKeyGuard` is
applied per route with `@UseGuards(ApiKeyGuard)`, alongside `@Public()`
to skip the session guard, it is not global like `SessionGuard`, since
most routes are for a logged in person, not a key holder.

Trace and span ingestion (`POST /traces`, `POST /traces/:traceId/spans`)
lives in `apps/api/src/traces/` (one module for both, they are one
bounded concept, see ADR-0008). Both are upserts keyed by a client
supplied `externalTraceId` / `externalSpanId`, not the old
`idempotencyKey` name from M1, see ADR-0008 for why that rename mattered.
An omitted field on an update leaves the existing value untouched; an
explicit `null` clears it, this relies on real Prisma behavior
(`undefined` vs `null` in `create`/`update` data), not something we
built ourselves. `parentSpanId` requires parent-first ingestion (the
parent must already exist), a real limitation, see ADR-0008.

`packages/sdk` (`AgentTraceClient`) wraps the ingestion API for
non-browser callers, see ADR-0009. `client.trace(info, fn)` and
`trace.span(info, fn)` measure timing and manage the external-id upsert
pattern automatically; a wrapped function's return value is never sent
as output automatically (`setOutput` is explicit, on purpose). Every
outbound call fails open (a bounded, `AbortController`-based timeout,
warnings that can only ever describe the failure kind, never its
content) so a problem with AgentTrace itself can never break or hang the
agent being instrumented. `packages/shared-types` now has real content
(`CreateTracePayload`, `CreateSpanPayload`, `TraceRecord`, `SpanRecord`),
wire-format types with ISO string timestamps, and `apps/api`'s DTOs
`implements` them as a compile-time (not runtime) drift check.

`apps/reference-agent` is a GitHub issue investigator (fetch issue,
fetch README, ask Gemini for a root cause/resolution), instrumented with
the SDK, see ADR-0010. GitHub access is unauthenticated, read-only REST
calls only, no personal access token. Never run in CI (a real, paid,
network-dependent LLM call on every push would be a recurring cost and a
flaky build). `GEMINI_MODEL` is configurable, defaulting to
`gemini-3-flash-preview` in `llm.ts`, picked after live testing showed
`gemini-2.5-flash` and `gemini-2.5-flash-lite` return `404` for new API
keys and `gemini-2.0-flash-001` returns a hard `0` free-tier quota, not
from documentation alone. Confirmed working end to end (`SUCCESS` and
`ERROR` traces both verified directly in Postgres, see ADR-0010).
`pricing.ts` deliberately has no price table entry for
`gemini-3-flash-preview` (no verified pricing yet), so `costUsd` is
`undefined` for it rather than guessed.

`GET /projects/:projectId/traces` (`ProjectTracesController`) lists
traces for the dashboard, session-authenticated, separate from the
API-key-authenticated `TracesController`, see ADR-0011. Cursor
pagination orders by `(startedAt DESC, id DESC)`, both fields, not
`startedAt` alone, since ties on `startedAt` are possible and need a
deterministic tiebreaker. Every trace/span endpoint (ingestion and
listing) maps its Prisma row through `toTraceRecord` /
`toSpanRecord` before returning it, never a raw Prisma row: Prisma's
`Decimal` (`totalCostUsd`, `costUsd`) serializes to a JSON *string* by
default, confirmed live, not the `number` `TraceRecord`/`SpanRecord`
promise.

`apps/web` has its first real functionality as of M7: login/signup
pages, a project list, and the runs dashboard, see ADR-0012.
`next.config.ts` rewrites `/api/:path*` to the API so the browser sees
one origin, avoiding CORS and `SameSite` cookie problems. `proxy.ts`
(Next.js 16's renamed `middleware.ts`) does a cookie-presence check
only, a convenience redirect; the real authentication check is the
API's 401, handled centrally in `apps/web/src/lib/api.ts`. `POST
/auth/logout` is `@Public()`, deliberately: it is called by the
frontend's 401 handler before redirecting to `/login`, specifically to
clear a stale cookie, so it must work even when the session it is
clearing is already invalid.

`GET /projects/:projectId/traces/:traceId` (M8) returns a trace plus
its spans as a **flat**, chronologically-ordered array
(`startedAt ASC, id ASC`), not a pre-built tree, see ADR-0013.
`apps/web`'s trace detail page (`SpanWaterfall`) builds the parent/child
tree client-side in two passes (every span becomes a node before any
linking happens), so a child appearing before its parent never matters,
and a span whose parent is missing, self-referential, or would close a
cycle becomes a root instead of being dropped or causing infinite
recursion. Bar widths in the waterfall are sized from an effective-end
calculation (`trace.endedAt ?? max span endedAt ?? max span startedAt
?? trace.startedAt`), never wall-clock `now`. `totalTokens`/`totalCostUsd`
are always displayed as the trace reported them, never re-summed from
spans.

CSRF protection and login/signup rate limiting were added at M9, see
ADR-0014. The CSRF token is `HMAC-SHA256(CSRF_SECRET, session.id)`,
delivered via a non-httpOnly `agenttrace_csrf` cookie the frontend
reads and echoes back as an `X-CSRF-Token` header; `CsrfGuard` never
reads the request's own cookie, it recomputes the expected value
server-side and compares with `crypto.timingSafeEqual`. Enforcement is
keyed on whether `SessionGuard` actually authenticated the request
(`request.user` set, `request.apiKeyContext` unset), not on `@Public()`
— the two decorators solve different problems and happen to overlap
today, not by definition. `GET /auth/csrf` (session-authenticated) lets
an existing session recover a lost CSRF cookie without a full
logout/login cycle; `apps/web/src/lib/api.ts`'s `ensureCsrfToken()` is a
singleton promise every mutating call awaits first, so a mutation can
never run before a token exists regardless of component call order.
`AuthThrottlerGuard` (applied only to `POST /auth/login` and
`POST /auth/signup`, not globally) keys on the request's `email`, not
IP — confirmed live that this project's Next.js proxy does not add a
trustworthy `X-Forwarded-For` hop, so IP-based keying would have been
trivially spoofable. The email key is trimmed but **not** lowercased:
`AuthService`'s own lookup is case-sensitive (confirmed by reading it
and by a live login test), and folding case in the throttle key would
bucket together requests that authentication treats as different
accounts.

M10 adds a frontend for API key management
(`/projects/:projectId/settings`), the first UI for `ApiKeysController`
(M3) — until now it was only ever exercised via curl or a raw browser
`fetch`. `ApiKeyRecord`/`CreateApiKeyPayload`/`CreateApiKeyResponse`
(`packages/shared-types`) and a `toApiKeyRecord` mapper bring API keys
in line with every other endpoint's Date-to-ISO-string wire contract,
the same gap M7 already closed for traces/spans. The raw key is shown
exactly once, right after creation, dismissed by an explicit "Done"
click, matching the backend's actual guarantee that it's never
retrievable again — there is no "view again" affordance, because there
couldn't correctly be one. Revoking a key uses an inline
confirm/cancel, not a native `confirm()` dialog, both for UX and
because a native dialog blocks the page (including this project's own
browser-automation testing tools) until manually dismissed.

M11 adds Playwright end-to-end tests (`apps/web/e2e/`) and CI's first
real database, see ADR-0015. Test setup (signing up a user, creating a
project and API key) goes through Playwright's request API, not the
UI and not `packages/sdk` — specifically `context.request`, not the
plain `request` fixture, since `BrowserContext.request` shares its
cookie jar with any `page` opened from the same context, so the
session/CSRF cookies `POST /auth/signup` sets land exactly where a
later `page.goto()` will read them, no manual `Set-Cookie` parsing.
These setup calls go through the Next.js proxy (`localhost:3001/api/...`),
not the API directly, since the cookies are scoped to whichever origin
issues them. Trace/span ingestion in the one seeded e2e flow hits the
API directly (`localhost:3000`, no proxy), the opposite choice, and
deliberately so: API-key auth uses a header, not cookies, and hitting
the API directly is the more faithful representation of how a real
script or the SDK actually calls it. `workers: 1` in
`playwright.config.ts` is deliberate, not a default left alone: every
test's data is independent, but all tests share one running `apps/api`
process and one Postgres instance, including state (the throttler's
in-memory store, ADR-0014) not yet verified safe under concurrency.

M12 adds the evaluation platform's first slice: a way to ask an LLM to
score a recorded trace. Built as a separate, stateless Python/FastAPI
service (`apps/eval-worker`), not folded into `apps/api`, since the
evaluation engine is a distinct responsibility likely to grow
independently (Python-native evaluation libraries, its own scaling
characteristics), see ADR-0016. `apps/api`'s `EvaluationsModule` owns
authorization and persistence and calls the worker over one internal
endpoint (`POST /evaluate`), authenticated with a shared secret
(`EVAL_WORKER_SECRET`, distinct from `CSRF_SECRET` and API keys) sent as
`X-Internal-Secret` and checked with a constant-time comparison on both
sides. `buildEvaluationSnapshot()` bounds what evidence the judge ever
sees (`MAX_SPANS = 20`, per-field and total character caps, truncation
counted and reported, never re-parsed as JSON), and the rubric is worded
so the judge scores only the evidence it's given. Every `EvalResult` row
is append-only (re-evaluating a trace never overwrites an old score) and
stores the exact bounded snapshot plus an `evaluatorVersion`, so a
historical score's provenance never depends on the rubric or prompt
logic's current content. `EvaluationThrottlerGuard` keys the
cost-containment rate limit on `(userId, projectId)`, registered as a
second named throttler (`'evaluate'`) alongside `'auth'` in the same
central `ThrottlerModule.forRoot()` call, a real bug surfaced here:
`ThrottlerGuard` applies every named throttler to any route it guards,
not just the one a route's own `@Throttle()` references, so both routes
needed an explicit `@SkipThrottle()` for the other's name. See ADR-0016.
Every failure the worker call can hit (timeout, unreachable, a real
provider error, a malformed response, an internal-secret mismatch) maps
to a distinct, sanitized HTTP status (504, 503, 503, 502, 500) rather
than one undifferentiated 500, and no raw exception message, provider
response, or evidence content is ever included in a thrown message on
either side. `apps/web`'s trace detail page gets an `EvaluationPanel`
(an Evaluate button disabled while pending, friendly per-status error
copy, and the append-only history newest-first), deliberately narrow:
no configurable rubric, model selection, auto-evaluation, deletion,
comparison, or raw evaluation-input display yet.

M13 adds `Installation`, a second credential type alongside `ApiKey`,
built for the self-service `agenttrace connect` flow the design doc at
`docs/architecture/cli-onboarding-design.md` laid out, see ADR-0017.
Where `ApiKey` is impersonal and admin-provisioned, `Installation` is
personal and self-service: a signed-in person approves it in the
browser, and the CLI exchanges it for a real credential without anyone
ever typing or copying a secret by hand. `Installation.tokenHash` is
nullable and stays `null` until `POST /cli/token` actually exchanges a
code for it, a deliberate deviation from the design doc's own schema
sketch, so a raw secret is never persisted even briefly, matching the
same rule every other credential in this project already follows.
`POST /cli/authorize` (session-authenticated) mints a short-lived,
single-use, hashed `CliAuthorizationCode` bound to a PKCE
`code_challenge`; `POST /cli/token` (public) recomputes the challenge
from the caller's `code_verifier`, compares it constant-time, and
atomically claims the code inside a `prisma.$transaction` before
generating and hashing the real secret. `ApiKeyGuard` was extended in
place, not duplicated, to also check the `Installation` table, and
returns the exact same generic `401 Invalid API key` for either
credential type's failure. `Trace.installationId` (nullable, set only
on create) was added in this same migration even though nothing reads
it back yet, since it can't be backfilled for traces ingested before it
existed. A third named throttler (`'cli-token'`, keyed on a hash of the
submitted code, not IP) was added with `@SkipThrottle()` applied to
every other route upfront, the cumulative-named-throttler lesson from
M12 (ADR-0016) applied proactively instead of rediscovered.

M14 builds the dashboard half of the same flow: the `/cli/authorize`
approve page and a `ConnectedApplicationsPanel` on the project settings
page, see ADR-0017 and the design doc. The UI calls the credential
"Connected Applications," the model and code stay named `Installation`,
the same naming split `ApiKeysPanel` already established for `ApiKey`.
`isSafeLoopbackRedirect()` validates the CLI-supplied `redirect_uri` by
parsing it with `new URL()` and checking `protocol`, `hostname`, `port`,
`username`, and `password` as separate fields, never with
`startsWith()`, which a userinfo trick
(`http://localhost:1234@evil.example.com/callback`) can bypass since
everything before the `@` is credentials, not host. The approve action
re-checks this validation a second time before building the redirect,
defense-in-depth on top of the render-time gate. The callback URL is
built with `new URL(redirectUri)` and `.searchParams.set(...)`, never
string concatenation, so existing query params on the caller-supplied
`redirect_uri` survive. Connection status (Pending/Connected/Revoked) is
derived client-side from the already-exposed `lastUsedAt`/`revokedAt`
fields, no new backend field needed.

M15 builds the actual `@agenttrace/cli` package (`agenttrace connect`,
`whoami`/`status`, `disconnect`, `test`), the first package in this
monorepo that needs a real build step, see ADR-0018. `packages/sdk` and
`packages/shared-types` ship raw TypeScript, fine for in-monorepo
consumers running through `tsx`/`ts-jest`, but a plain `node
dist/bin.js` process outside the monorepo can't `require()` raw `.ts`,
confirmed live when a first, plain-`tsc` build failed immediately with
`SyntaxError: Unexpected identifier`. Fixed by bundling with esbuild
(`--bundle --platform=node --format=cjs`), which inlines
`@agenttrace/sdk`/`@agenttrace/shared-types` directly into
`dist/bin.js`; both packages moved from `dependencies` to
`devDependencies` since the published CLI doesn't need them at runtime
once bundled. `connect` generates a PKCE verifier/challenge and `state`,
starts a `127.0.0.1`-only loopback server, opens the browser to
`/cli/authorize`, waits for the callback, exchanges the code at
`/cli/token`, and writes `AGENTTRACE_API_KEY`/`AGENTTRACE_BASE_URL` into
the target app's `.env` (prompting before overwriting existing values,
unless `--force`). `AgentTraceClient.trace()`'s fail-open design
(ADR-0009), correct for instrumenting a real agent, is exactly wrong for
a command whose job is reporting whether a connection works, so
`connect`/`whoami`/`test` all gate success on a real call to the
existing `GET /api-keys/verify` endpoint first, confirmed to already
work for Installation credentials with zero backend changes, then still
call `.trace()` afterward as a real SDK-usage demonstration. `bin.ts`
calls `process.exit()` explicitly once a command's work is done, fixing
a real hang traced (by elimination, not guessed) to Node's built-in
fetch leaving an idle keep-alive socket open past the CLI's actual
work.

## Repository conventions

- pnpm workspaces monorepo; no Turborepo/Nx until build times actually
  justify it.
- TypeScript everywhere except `apps/eval-worker` (Python/FastAPI), the
  LLM-as-judge evaluation worker introduced at M12, see ADR-0016.
- Shared types live in `packages/shared-types`, consumed via
  `workspace:*` — do not duplicate DTO shapes between `apps/web` and
  `apps/api`.
- One ADR per significant architectural decision, written at the milestone
  where the decision is implemented (`docs/adr/NNNN-title.md`).
- `docs/learning-journal.md` updated after every milestone.
- `packages/cli` (M15) is the first package in the monorepo that ships a
  real build output instead of raw TypeScript: it's bundled with esbuild
  so it can run standalone (`node dist/bin.js`) outside the monorepo,
  with no TypeScript tooling of its own available. See ADR-0018.

## Commands

```bash
pnpm install            # install all workspace deps
pnpm dev:web             # run the Next.js app (apps/web)
pnpm dev:api              # run the NestJS app (apps/api)
pnpm lint                 # lint all packages
pnpm typecheck             # typecheck all packages
pnpm build                  # build all packages
pnpm db:up                   # start local Postgres via docker compose
pnpm db:down                   # stop local Postgres
pnpm db:migrate                # run/create a Prisma migration (apps/api)
pnpm db:seed                     # seed demo org/user/project (apps/api)
pnpm db:studio                     # open Prisma Studio GUI (apps/api)
pnpm --filter web test:e2e           # run Playwright e2e tests (apps/api and apps/web must already be running)
```

The first time you run e2e tests locally, install the browser once:
`pnpm --filter web exec playwright install --with-deps chromium`.

`apps/eval-worker` (Python/FastAPI) is not part of the pnpm workspace
and has its own setup, run, test, and lint commands, documented in
`apps/eval-worker/README.md`.

`packages/cli` has its own build (`pnpm --filter @agenttrace/cli
build`, esbuild bundling `dist/bin.js` plus a `tsc --emitDeclarationOnly`
pass for types) and test (`pnpm --filter @agenttrace/cli test`) commands,
documented in `packages/cli/README.md`. Running the CLI itself against a
real target application, once built: `node packages/cli/dist/bin.js
connect` from that application's own directory.

Local Postgres (once `pnpm db:up` is running):
`postgresql://agenttrace:agenttrace_dev_password@localhost:5433/agenttrace`

(Port 5433, not the default 5432 — a native PostgreSQL install already owns
5432 on this machine; our Docker Postgres is remapped to avoid conflicting
with it.)

## Testing expectations

Unit tests (Jest, both apps) for backend logic — security-sensitive
logic gets these as soon as it exists, never deferred. `AuthService`
(signup/login) already has unit tests as of M2, using a mocked
`PrismaService`, no test database needed for these.

Playwright end-to-end tests (`apps/web/e2e/`, M11, ADR-0015) cover the
backbone flows: auth, project creation, API-key management, and one
trace ingested through the real public API end to end. CI now has a
real, isolated, disposable Postgres (a `services:` container, fresh
per job run) to run these against — the same database this milestone
set up as a shared prerequisite, not something only the e2e suite
benefits from. Locally, e2e tests expect `pnpm db:up` / `dev:api` /
`dev:web` already running; they don't manage server lifecycle
themselves.

Still open, not part of M11: a NestJS-level API integration test suite
(`apps/api/test/*.e2e-spec.ts`, Jest + `supertest`, no browser) is a
different test category `nest new` scaffolded back at M0 and nothing
has built out since — it would use the same CI database M11 just
introduced, but building it out was explicitly kept out of this
milestone's scope.

`apps/eval-worker`'s own test suite (`apps/eval-worker/tests/`, pytest)
never makes a real Gemini call, same reasoning as `apps/reference-agent`
(ADR-0010): `app.judge.evaluate` is mocked in every test. A dedicated
integration test (`apps/api/src/evaluations/throttler-scoping.integration.spec.ts`)
boots a real Nest app to prove the exact named-throttler threshold for
both `'auth'` and `'evaluate'`, specifically so this doesn't need
re-verifying with real, paid, rate-limited live traffic every time.
`apps/web/e2e/evaluation-panel.spec.ts` (M12) is the same story on the
frontend: every case mocks the evaluate/evaluations routes via
Playwright's `page.route()`, since a real evaluation is a real, paid LLM
call that shouldn't run on every push. Both a real successful evaluation
and several real provider failures were verified by hand in a live
browser instead, see ADR-0016.

`throttler-scoping.integration.spec.ts` (M13) was extended to cover all
three named throttlers (`'auth'`, `'evaluate'`, `'cli-token'`), proving
each is actually isolated to its own route rather than just intended to
be, the same regression-test pattern M12 introduced. `api-key.guard.spec.ts`
was extended with `Installation`-credential test cases alongside its
existing `ApiKey` ones. M14's `cli-authorize.spec.ts` and
`connected-applications-panel.spec.ts` are real, not-mocked Playwright
tests (a real backend, a real throwaway loopback listener standing in
for the not-yet-built CLI, a real approve-and-redirect flow), a
deliberate departure from M12's mocked frontend tests since this
milestone's own logic (redirect-uri validation, the PKCE exchange) is
exactly the kind of security-sensitive logic this project's testing
philosophy says shouldn't be mocked away. M15's `packages/cli` has
colocated Jest unit tests for every pure-logic module (`pkce.spec.ts`,
`label.spec.ts`, `env-file.spec.ts`, including a dedicated
line-ending-preservation suite for the CRLF fix); nothing spins up a
real browser or loopback server in the test suite, that's what M15's
live, manual CLI run against a throwaway directory was for instead.

## Security rules

- No secrets committed. `.env` is gitignored; `.env.example` documents
  required variables without values.
- API keys are stored hashed, never in plaintext; shown once at creation.
- Passwords hashed with bcrypt, never logged.
- Session tokens are hashed (SHA-256) before being stored, same as API
  keys. The raw token only ever lives in the browser's httpOnly cookie.
- Login failures for a wrong password and for an unknown email return the
  exact same error, so a login attempt never reveals whether an email is
  registered.
- Authorization checks (project/org scoping) are tested explicitly, not
  just covered incidentally by happy-path tests.
- CSRF protection and login/signup rate limiting were closed at M9
  (both had been noted as deliberate, deferred gaps in ADR-0005). See
  ADR-0014. `CSRF_SECRET` is validated at process startup (required, at
  least 32 random bytes, not a known placeholder) — the API refuses to
  start otherwise, rather than surfacing a confusing error on first
  login.
- The login/signup rate limit does not defend against distributed
  credential stuffing (many different accounts, one or two guesses
  each) or signup spam (a new email per request) — both explicitly
  accepted as known debt for M9, not fixed. See ADR-0014.
- `@nestjs/throttler`'s default storage is process-local. If `apps/api`
  ever runs as more than one instance, each instance enforces the login
  rate limit independently, effectively multiplying the real limit by
  the instance count. Deferred until horizontal scaling is an actual
  need, same as other distributed-infrastructure decisions in this
  project.
- `main.ts` deliberately does not call `app.set('trust proxy', ...)`.
  Confirmed live: the Next.js frontend's rewrite-based proxy does not
  add its own `X-Forwarded-For` hop, it relays whatever the client sent
  unmodified. Enabling `trust proxy` today would mean trusting a fully
  attacker-controlled header. Revisit only once a real reverse proxy
  that overwrites (not appends to) that header sits in front of this
  stack.
- `ApiKeyGuard` returns the exact same `401 Invalid API key` for a
  missing header, a malformed header, an unknown key, and a revoked key.
  This is tested directly (`api-key.guard.spec.ts`), do not change one of
  these messages without changing all of them.
- Random tokens (sessions and API keys) always use `crypto.randomBytes`,
  never `Math.random()`.
- Ingestion writes always go through Prisma's atomic `upsert()`, never a
  find-then-create/update flow in application code, so concurrent
  retries with the same `externalTraceId`/`externalSpanId` cannot create
  duplicate rows.
- `lastUsedAt` on an API key updates after successful authentication, not
  after the request that follows also succeeds, and is throttled to at
  most once per hour per key. See ADR-0008.
- The SDK never auto-captures a wrapped function's return value as
  output, and never `JSON.stringify`s an arbitrary thrown value for
  error reporting, both for the same reason: application data can
  contain secrets, private data, circular references, or be very large.
  See ADR-0009.
- The SDK's error capture excludes stack traces for now, only the
  message is sent. See ADR-0009 for the tradeoff.
- Locally-generated dev credentials (API keys, session tokens) should
  never appear in command output/echo, even for local-only testing.
  When one accidentally does, revoke it and generate a replacement
  rather than continuing to use it. Write secrets to files directly
  (e.g. via a script that never prints them) instead of echoing them to
  a terminal first.
- Internal service-to-service calls (`apps/api` to `apps/eval-worker`)
  authenticate with a distinct shared secret (`EVAL_WORKER_SECRET`, not
  `CSRF_SECRET`, not an API key), sent as `X-Internal-Secret` and
  checked with a constant-time comparison on both sides
  (`crypto.timingSafeEqual` in Node, `hmac.compare_digest` in Python).
  See ADR-0016.
- `EVAL_WORKER_SECRET` (both services) and `GEMINI_API_KEY`
  (`apps/eval-worker`) are validated at process startup, same fail-fast
  discipline as `CSRF_SECRET`. See ADR-0016.
- Every evaluation-worker failure (timeout, unreachable, a provider
  error, a malformed response, an internal-secret mismatch) maps to a
  distinct, sanitized HTTP status; no thrown message on either side ever
  includes a raw exception message, provider response body, or evidence
  content, since trace/span input/output can contain secrets or private
  data. See ADR-0016.
- `ThrottlerGuard` applies every named throttler registered in
  `ThrottlerModule.forRoot()` to any route it guards, not just the one
  referenced in that route's own `@Throttle()`. Adding a new named
  throttler anywhere requires an explicit `@SkipThrottle()` on every
  other already-throttled route, or it silently also becomes subject to
  the new limit. Found live at M12 (the `'evaluate'` throttler was
  silently also checked against `'auth'`'s lower limit, and vice versa);
  see ADR-0016 and `throttler-scoping.integration.spec.ts`.
- `ApiKeyGuard` now checks both `ApiKey` and `Installation` credential
  tables and returns the exact same generic `401 Invalid API key` for
  every failure mode of either, the same uniform-error-message rule
  extended to a second credential type instead of a differently-worded
  second failure mode. See ADR-0017.
- `Installation.tokenHash` is nullable and stays `null` from
  browser-approval until the CLI actually completes the token exchange,
  so a raw secret is never persisted anywhere, even briefly, matching
  the same rule this project applies to `Session` and `ApiKey`. A `null`
  `tokenHash` can never match a submitted Bearer token, so a pending,
  never-exchanged `Installation` can never authenticate anything. See
  ADR-0017.
- `POST /cli/token`'s authorization-code exchange verifies a PKCE
  `code_challenge`/`code_verifier` pair with a constant-time comparison
  (`codeChallengesMatch`) and atomically claims the code inside a
  `prisma.$transaction` (`updateMany` scoped to `usedAt: null`,
  checking the affected row count), closing the race window between two
  concurrent exchange attempts for the same code. See ADR-0017.
- `redirect_uri` supplied by the CLI to `/cli/authorize` is validated
  with `new URL()`, checking `protocol`, `hostname`, `port`, `username`,
  and `password` as separate fields, never with `startsWith()`. A
  `startsWith("http://127.0.0.1:")` check is bypassable with a userinfo
  trick (`http://localhost:1234@evil.example.com/callback`, where
  everything before the `@` is credentials, not host). The approve
  action re-checks this validation a second time before redirecting, in
  addition to the render-time gate. Found and specified during M14's
  plan review, not found live; see ADR-0017 and
  `apps/web/src/app/cli/authorize/page.tsx`.
- The M15 credential-hygiene incident (a real installation token
  appeared in terminal output from a debugging `cat .env` run) was
  handled per the existing rule above: the token was never reused, both
  it and a second valid connection were revoked from the dashboard once
  verification finished. See ADR-0018.

## Current milestone

M15 complete: `@agenttrace/cli`, the real `agenttrace connect` flow, and
the last of the three milestones (M13/M14/M15) that built self-service
CLI onboarding end to end (`docs/architecture/cli-onboarding-design.md`,
ADR-0017, ADR-0018). `connect` genuinely opens a browser, runs a real
loopback listener on `127.0.0.1`, exchanges a real authorization code
plus PKCE verifier for a real credential at `/cli/token`, writes
`AGENTTRACE_API_KEY`/`AGENTTRACE_BASE_URL` into a target application's
`.env` (prompting before overwriting existing values unless `--force`),
and sends a real SDK smoke trace. `packages/cli` is the first package in
this monorepo that needs a real build (esbuild bundling, since a plain
`node dist/bin.js` process outside the monorepo can't `require()`
`packages/sdk`/`packages/shared-types`'s raw TypeScript, found live when
a first plain-`tsc` attempt failed immediately). Verified against a
real, separate throwaway application directory, not just unit tests:
`connect`, `whoami`, `test`, and `disconnect` were each run for real
against a live backend, with a real browser approval in the loop and
real cleanup afterward (including revoking a connection exposed once,
by accident, in debugging terminal output, disclosed and remediated the
same turn per this project's own credential-hygiene rule). Two real bugs
were found and fixed during this milestone: a process hang traced by
elimination to Node's built-in fetch keeping an idle socket open past
the CLI's actual work (fixed with an explicit `process.exit()`), and a
CRLF line-ending bug in the hand-rolled `.env` editor found during
review and closed with 8 new tests before shipping, not left as debt.

M14 (Connected Applications dashboard UI, the `/cli/authorize` approve
page) and M13 (the `Installation` credential backend: schema, PKCE
authorization-code exchange, generalized `ApiKeyGuard`,
`Trace.installationId` provenance) are also complete, both part of the
same three-milestone CLI-connect arc as M15. The `redirect_uri`
validation on the M14 approve page was corrected during plan review,
before implementation, from a bypassable `startsWith()` check to full
`new URL()` field validation. M12 (LLM-as-judge evaluation, ADR-0016),
M11 (Playwright end-to-end tests and CI's first real database,
ADR-0015), M10 (API key management UI), and M9 (CSRF protection and
login/signup rate limiting, ADR-0014) are also complete.

## Known technical debt

- Local Docker Postgres runs on host port 5433, not 5432, because this
  machine has a pre-existing native PostgreSQL 15 install bound to 5432.
  Not a problem for this project, but anyone cloning this repo on a clean
  machine could safely change it back to 5432 if they want.
- This project uses Prisma 7, which changed several conventions from
  older Prisma versions — don't assume older tutorials/muscle memory
  apply. Specifically: the datasource URL lives in `prisma.config.ts`, not
  `schema.prisma`; `PrismaClient` requires an explicit driver adapter
  (`@prisma/adapter-pg`); the generator is set to `moduleFormat = "cjs"`
  to avoid an ESM-only (`import.meta.url`) default that breaks under
  CommonJS tooling; and standalone scripts against the generated client
  (e.g. `prisma/seed.ts`) run via `tsx`, not `ts-node`, because `ts-node`'s
  CommonJS mode can't resolve the `.js`-extension imports the generated
  client uses internally. See ADR-0004 for the full story.
- Jest hits the same `.js`-extension resolution problem as `ts-node` did.
  Fixed with a `moduleNameMapper` entry in `apps/api/package.json`'s jest
  config that strips `.js` from relative imports before resolving them.
- `GET /api-keys/verify` was decided at M4: kept permanently as a
  supported "check my credentials" endpoint, not removed now that real
  ingestion endpoints exist. See ADR-0007 and ADR-0008.
- Ingestion requires parent-first ordering: a span's `parentSpanId` must
  reference an already-created span. Out-of-order or batched ingestion
  is not supported. See ADR-0008.
- `Span.parentSpanId` is still a plain string column, not a real foreign
  key (from M1). `parentSpanId` referential integrity is enforced in
  application code (`SpansService`), not by the database.
- If a shell session has a broken `NODE_OPTIONS` (pointing at a missing
  harness preload file), every `node`/`pnpm` command fails with
  `MODULE_NOT_FOUND`. Not a project issue, work around per-command with
  `NODE_OPTIONS="" <command>`.
- `prisma migrate dev` refuses to run in a non-interactive terminal at
  all, even with `--create-only`. Workaround: `prisma migrate dev
  --create-only` under `expect` (auto-answering the confirmation prompt)
  to generate the migration file, inspect it, then apply it
  non-interactively with `prisma migrate deploy`.
- `packages/sdk` and `packages/shared-types` do not set
  `"type": "module"` in `package.json`, even though `tsconfig.base.json`
  uses `"module": "NodeNext"`. Jest's default configuration expects
  CommonJS-shaped output from its transformer; a real ESM package type
  conflicts with that. Matches `apps/api`'s own convention. If a stale
  Jest cache is suspected after a config change like this, `pnpm exec
  jest --clearCache` before concluding something is actually broken.
- `packages/sdk` has no ESLint configuration yet, only `apps/api` and
  `apps/web` do (inherited from their scaffolding tools). Strict
  TypeScript and Prettier formatting catch a lot in the meantime; add
  ESLint here if the package grows enough to want it.
- `gemini-3-flash-preview` (the reference agent's default model) has no
  verified price in `pricing.ts`, since it's a preview model with no
  publicly confirmed rate at the time this was written. `costUsd` will
  be `undefined` for it until real pricing is checked and added. Also,
  as a preview model, it could change behavior or be deprecated with
  less notice than a stable release; if `GEMINI_MODEL` starts failing,
  check current model availability the same way M6 did (a direct REST
  call against `generativelanguage.googleapis.com`), not by assuming
  the old model name still works.
- Gemini API keys (as of M6) may return `404 "no longer available to
  new users"` for some models, or a real `429` with `limit: 0` (not a
  transient rate limit) on others, depending on the key's project and
  billing status. A `0` limit does not resolve by waiting; it means no
  free-tier allocation at all for that model on that project.
- M11's Playwright suite covers auth, project creation, API-key
  management, and one trace-ingestion smoke flow, not the filters,
  pagination, waterfall positioning, malformed-tree handling, or
  payload-detail collapsing that M7/M8's manual checklists already
  verified once. Each is a reasonably-scoped follow-up on its own, not
  folded into the milestone that stood up e2e infrastructure for the
  first time. M7's frontend still has a manual checklist
  (`docs/testing/m7-manual-browser-checklist.md`); M8, M9, and M10's
  frontend changes were each verified with live manual testing but have
  no checklist document of their own.
- No automated e2e test-data cleanup yet. Local Playwright runs against
  the persistent dev database leave clearly-tagged rows
  (`@e2e.agenttrace.test` emails, `E2E ...`-prefixed names) that a
  person can spot and remove by hand; CI doesn't need this, since its
  Postgres is destroyed at the end of every job run. See ADR-0015.
- Playwright runs with `workers: 1`, not parallelized, since all tests
  share one running `apps/api` process and one Postgres instance,
  including state (the M9 rate-limiter's in-memory store) not yet
  verified safe under concurrency. Revisiting this is a reasonable
  future step once the suite is larger and that's been explicitly
  checked, not a permanent constraint. See ADR-0015.
- `apps/api/test/*.e2e-spec.ts` (NestJS's own Jest-based API
  integration test stub, scaffolded by `nest new` at M0) remains
  untouched. It's a different test category from Playwright and would
  use the same CI database M11 introduced, but building it out was
  explicitly kept out of this milestone's scope.
- CI's `actions/checkout@v4`, `actions/setup-node@v4`, and
  `pnpm/action-setup@v4` target a Node.js version GitHub has begun
  deprecating (runs are currently force-upgraded to Node 24
  automatically, so this isn't failing anything yet). Worth a version
  bump at some point; not urgent enough to block M11 on it.
- The span waterfall (M8) caps rendering depth at 50 levels; a real
  trace nested deeper than that would show a count of hidden spans
  rather than rendering them. Not expected in practice, a safety margin
  against malformed data, not a real limitation for any trace this
  project actually produces.
- ADR-0013 (trace detail view, M8) was written retroactively during
  M9's documentation pass, not at the milestone where the decision was
  implemented, which is this project's own stated convention. The
  ADR/learning-journal/CLAUDE.md-milestone-marker gap was caught, not
  silently left; the backfilled ADR notes this explicitly.
- M12's evaluation UI (`EvaluationPanel`) deliberately has no
  configurable rubric, model selection, auto-evaluation trigger,
  deletion, comparison across evaluations, or raw `evaluationInput`
  display. Each is a reasonable, scoped follow-up, not part of this
  milestone. See ADR-0016.
- The paid-call-success/DB-write-failure window in
  `EvaluationsService.evaluate` (a successful Gemini call whose result
  then fails to persist) is accepted debt with no automatic recovery: no
  queue or outbox, a person just re-clicks Evaluate. See ADR-0016.
- `apps/eval-worker`'s `except genai_errors.APIError` handler
  (`app/main.py`) does not log the underlying exception before
  converting it to a sanitized 503. Confirmed live during M12's frontend
  smoke test: several real `429 RESOURCE_EXHAUSTED` responses left no
  diagnostic detail in the eval-worker's own log, only the generic
  access-log line. Fine for what the browser sees, but makes real
  operator debugging harder than it needs to be; worth a server-side-only
  log line (never included in the HTTP response) in a future pass.
- Gemini's free-tier quota (`generate_content_free_tier_requests`,
  confirmed live at a limit of 20) is easy to exhaust during active
  development, since `apps/eval-worker` and `apps/reference-agent`
  currently share one API key (ADR-0010's original choice). A dedicated
  key per service, or simply expecting to wait out the quota window
  during heavy manual testing, are the two easy mitigations; neither is
  implemented yet.
- Approving a connection in the browser and then never completing the
  CLI token exchange leaves a permanently-`Pending` `Installation` row
  (and its unused, eventually-expired `CliAuthorizationCode`) with no
  automated cleanup. Harmless (a `null`-`tokenHash` row can never
  authenticate anything), just not swept up; a person can revoke it
  manually from the Connected Applications panel. See ADR-0017.
- `--project <id>` CLI preselection isn't implemented: making it
  actually skip the project picker would require the M14 authorize page
  to read a new `project_id` query param, an `apps/web` change M15
  wasn't scoped to make. Every `connect` run shows the picker even if
  the caller already knows which project they want. See ADR-0018.
- `agenttrace disconnect` only revokes the credential locally (removes
  it from `.env`); there is no Bearer-token self-revoke endpoint, so a
  full server-side revocation still needs the dashboard's Connected
  Applications panel. Building one would pull CLI scope back into
  `apps/api`'s territory, which M13 already closed. See ADR-0018.
- `agenttrace whoami`/`status` can show a project's id but not its
  human-readable name, since nothing exposes that to a
  non-session-authenticated caller today.
- M14's Playwright suite covers the approve-and-redirect flow and the
  Connected Applications panel's Pending/Connected/Revoked lifecycle,
  not every edge case (e.g. concurrent approvals of the same
  authorization code). A reasonable, scoped follow-up, not part of this
  milestone.
