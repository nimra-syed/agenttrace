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

## Repository conventions

- pnpm workspaces monorepo; no Turborepo/Nx until build times actually
  justify it.
- TypeScript everywhere except a future FastAPI evaluation worker (Python),
  introduced only when we build LLM-as-judge evaluation.
- Shared types live in `packages/shared-types`, consumed via
  `workspace:*` — do not duplicate DTO shapes between `apps/web` and
  `apps/api`.
- One ADR per significant architectural decision, written at the milestone
  where the decision is implemented (`docs/adr/NNNN-title.md`).
- `docs/learning-journal.md` updated after every milestone.

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
```

Local Postgres (once `pnpm db:up` is running):
`postgresql://agenttrace:agenttrace_dev_password@localhost:5433/agenttrace`

(Port 5433, not the default 5432 — a native PostgreSQL install already owns
5432 on this machine; our Docker Postgres is remapped to avoid conflicting
with it.)

## Testing expectations

Unit tests (Jest, both apps), API integration tests (NestJS + Postgres),
Playwright end-to-end tests once the dashboard has real flows to test.
Full integration/e2e test infrastructure (a real test database in CI) is
still planned for M11, but security-sensitive logic gets unit tests as
soon as it exists, not deferred until M11. `AuthService` (signup/login)
already has unit tests as of M2, using a mocked `PrismaService`, no test
database needed for these.

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

## Current milestone

M10 complete: an API key management UI (create, list, revoke), the
first frontend for `ApiKeysController` (M3). No new ADR: unlike M7-M9,
this milestone applied existing patterns (the Date-to-ISO-string mapper
convention, session-authenticated CRUD, CSRF-protected mutations) to a
new surface rather than making a new architectural decision — judged
deliberately, not skipped. M9 (CSRF protection and login/signup rate
limiting, ADR-0014) and M8 (trace detail view with a span waterfall,
ADR-0013) are also complete. All three verified with live manual
testing, not just unit tests — see each milestone's learning journal
entry for the specific live checks run.

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
- No Playwright/e2e test infrastructure yet (deferred to M11, per plan).
  M7's frontend is covered by unit tests on the backend endpoint and a
  manual browser checklist (`docs/testing/m7-manual-browser-checklist.md`),
  not automated UI tests. M8, M9, and M10's frontend changes were each
  verified with live manual browser testing but have no checklist
  document of their own yet.
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
