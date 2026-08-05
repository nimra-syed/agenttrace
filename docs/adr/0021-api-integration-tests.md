# ADR-0021: NestJS API integration test suite

Status: Accepted

## Context

`apps/api/test/*.e2e-spec.ts` was the `nest new` scaffold from M0,
untouched ever since, flagged as open debt at every milestone since
M11. Unit tests (`*.spec.ts`) mock `PrismaService` and exercise one
class at a time. Playwright (`apps/web/e2e/`) exercises the whole
stack through a real browser. Neither proves the real `AppModule`,
global guards, CSRF middleware, session cookies, and a real Postgres
actually work together at the HTTP layer without a browser in the
loop. This milestone builds that: a real `supertest`-driven suite
against the real `AppModule`, wired into CI.

This followed directly from fixing CI (`475505c`): that work surfaced
that CI had been silently broken since M12/M16, specifically because
nothing in this project checked real CI status as part of its own
verification discipline. A real integration suite is a concrete way to
close part of that same gap for the routes it covers.

## Decision

### Real `AppModule`, real Postgres, no browser

`Test.createTestingModule({ imports: [AppModule] }).compile()`,
manually replicating the two things `main.ts`'s `bootstrap()` does
that `TestingModule` doesn't inherit automatically:
`app.use(cookieParser())` and the global `ValidationPipe`. Every test
runs against the same dev Postgres `pnpm db:up` already starts
locally, and the `e2e` job's disposable Postgres in CI, reading the
same `.env`/job-level env vars `apps/api` already needs to boot at
all.

### Scope: the same backbone flows, plus explicit authorization checks

Auth (signup, login, logout, `/auth/me`, `/auth/csrf`), projects
(create/list, plus an explicit cross-org test), API keys (create,
list, revoke, `ApiKeyGuard`'s uniform-401 across all four failure
modes via real requests), trace/span ingestion (create, upsert via
`externalTraceId`, cross-project rejection), and CSRF (the real
`GET /auth/csrf` round trip, never `computeCsrfToken()` imported
directly, which would couple the test to an implementation detail
instead of the actual public contract). Evaluations, the
installations/CLI-auth PKCE flow, and throttle-limit-exhaustion beyond
`throttler-scoping.integration.spec.ts` are explicitly out of scope for
this first slice, not silently dropped.

### Two real problems found getting a real Prisma client to run inside Jest for the first time

Nothing in this project had ever booted a real, connected
`PrismaService` inside a Jest process before (unit tests mock it away
entirely). Two structural issues surfaced immediately:

**Prisma 7's driver-adapter query compiler uses a dynamic `import()`
Jest's default CJS transform can't execute** (`A dynamic import
callback was invoked without --experimental-vm-modules`). Fixed by
adding `NODE_OPTIONS=--experimental-vm-modules` to the `test:e2e`
script itself, not a one-off flag someone has to remember. This is
specific to constructing a real `PrismaClient` with `@prisma/adapter-pg`
inside Jest; nothing else in this project does that.

**Jest's `globalTeardown` bypasses Jest's own configured resolver.**
The original design used a single `globalTeardown` script for cleanup.
It failed with `Cannot find module '.../generated/prisma/client.js'`
every time, even though the exact same import resolves fine inside a
normal spec file. Root cause: Prisma 7's `prisma-client` generator
outputs raw `.ts` (not `.js`), and this project's `moduleNameMapper`
(stripping the `.js` suffix so Jest's resolver retries with `.ts`) only
applies to Jest's own normal module-loading path -- `globalTeardown`
loads its script through a separate mechanism
(`requireOrImportModule`) that calls plain Node `require` directly,
bypassing that resolver and the mapping it provides entirely. Fixed by
moving cleanup out of `globalTeardown` into a plain exported function
(`test/support/cleanup.ts`) that every spec file's own `afterAll`
calls using that file's already-connected `PrismaService`
(`app.get(PrismaService)`) -- a normal import, resolved the normal
way, no special-casing needed. Combined with `--runInBand` (below),
this means each file sweeps its own tagged data as it finishes rather
than everything accumulating for one deferred, and structurally
broken, cleanup at the very end.

### Tagged data, real automated cleanup, defended against ever touching anything else

Every user is tagged (`@api-integration.agenttrace.test`, distinct
from Playwright's own `@e2e.agenttrace.test`). `cleanupTaggedTestData`
deletes only rows reachable from tagged users, in child-before-parent
order matching the real schema, and only deletes an `Organization` if
every membership on it belongs to a tagged user -- defensive, not just
optimistic, in case a future feature ever lets a real user join a test
org. Verified directly against the real dev database, not assumed:
after a full suite run, zero tagged rows remained, and Playwright's
own `@e2e.agenttrace.test` rows (confirmed by inspecting the 10 most
recent users) were completely untouched.

### Serial execution for the first version

`--runInBand`, both locally and in CI. Unlike Playwright (all tests hit
one already-running, shared `apps/api` process), each Jest worker here
boots its own in-process `INestApplication`, so the in-memory
throttler state is naturally isolated per file already. The only
shared resource across parallel workers would be Postgres itself.
Running serially for this first version is a deliberate, conservative
choice while that isolation is unproven, not a permanent constraint --
parallelizing is a reasonable thing to revisit once this suite has a
track record, matching the same caution ADR-0015 already applied to
Playwright's own `workers: 1`.

### CI placement, proven before finalizing

Added to the existing `e2e` job right after `Apply database
migrations`, before `Install Playwright browsers`/`Build api and
web`. Verified directly, not assumed, given this is the same class of
bug that just broke CI at M16: cleared `packages/sdk`'s and
`packages/cli`'s `dist/` and ran `apps/api`'s existing test suite and
typecheck with neither present -- both passed clean, confirming
`apps/api` depends on neither package's build output (only
`@agenttraceai/shared-types`, which ships raw source).

## Alternatives considered

- **A dedicated CI job with its own Postgres container**, mirroring
  `e2e`'s own structure. Rejected: ADR-0015's own stated intent was for
  the CI database it introduced to be reused by future suites, not
  something only Playwright benefits from; a second container is
  unnecessary infrastructure for what a single early step in the
  existing job already provides.
- **Passing dummy environment variables directly to a child process**
  instead of writing real cookies/tokens through the real HTTP
  responses. Not applicable here in the way it mattered for M17's
  scaffold tests, but the same principle held throughout: every
  credential/token this suite uses comes from a real response, never a
  shortcut that could pass even if the real contract broke.
- **Keeping `globalTeardown`** and working around the resolver issue
  with an explicit `.ts` extension or a raw `ts-node` require. Rejected
  after directly testing both: the generated client's own internal
  imports use the same `.js`-suffixed-but-actually-`.ts` pattern
  recursively, so anything bypassing Jest's resolver breaks on the
  *next* file down, not just the top-level one. Working with Jest's
  resolver (per-file `afterAll`) instead of around it was the only
  approach that didn't just move the same problem one level deeper.

## Consequences

- Gain: a real, verified integration suite proving the actual
  `AppModule` -- guards, CSRF, sessions, Prisma, a real Postgres --
  works together, not just that each class works in isolation.
- Gain: the first real `PrismaClient` connection inside this project's
  own Jest tests, and the two structural problems that surfaced from
  that are now documented and fixed, not landmines for the next person
  who tries this.
- Gain: this suite is wired into CI, at a point early enough in the
  `e2e` job to fail fast before spending time on browser install and
  full builds.
- Give up: evaluations, the installations/CLI-auth flow, and
  throttle-limit-exhaustion beyond the existing scoping test remain
  uncovered by this suite, documented as reasonable, explicitly scoped
  follow-ups, not silently dropped.
- Give up: this suite runs serially (`--runInBand`) for now, a
  deliberate, conservative choice pending a longer track record, not a
  permanent one.
