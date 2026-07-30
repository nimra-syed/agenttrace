# ADR-0015: Playwright end-to-end testing

Status: Accepted

## Context

`CLAUDE.md` has said since M7 that Playwright e2e tests and a real test
database in CI are "planned for M11," a placeholder that finally gets
filled in. Everything up to now has been verified by hand: unit tests
for backend logic, manual browser passes (recorded as checklists or
learning-journal entries) for every frontend milestone since M7. That's
worked, but it doesn't scale, and it means every regression check is a
person re-clicking through the app.

## Decision

### Scope: four specs, deliberately narrow

- `auth.spec.ts`: signup lands on `/projects`; logout lands on
  `/login`; a direct navigation to a protected page while signed out
  redirects to `/login`.
- `projects.spec.ts`: create a project through the real UI, confirm it
  appears in the list, navigate into its runs page.
- `api-keys.spec.ts`: create a key, confirm the one-time reveal, confirm
  it shows in the list, revoke it, confirm the status updates.
- `trace-smoke.spec.ts`: sign up, create a project and an API key (via
  requests, not the UI — see below), ingest one trace and a couple of
  spans through the real public ingestion API, then use the actual
  browser to confirm the trace appears on the runs page and its detail
  page renders the trace name and span names.

Deliberately not in this pass: filters, pagination, waterfall bar
positioning, malformed-tree handling, or payload-detail collapsing —
all already covered by manual testing at M7/M8, and each is its own
reasonably-scoped follow-up once this first slice is stable, not
something to fold into the milestone that's also standing up CI
infrastructure for the first time.

### Setup via API requests, not the UI, not the SDK, not direct DB writes

`api-keys.spec.ts` and `trace-smoke.spec.ts` both need a signed-in user
with a project before their actual subject (the API-keys UI; trace
ingestion) can be tested. Re-driving the signup and project-creation
**UI** in every file that needs a logged-in user would be slower and
would make those specs fail for reasons unrelated to what they
actually test — `auth.spec.ts` and `projects.spec.ts` already cover
that surface directly.

A shared helper (`e2e/fixtures/api-setup.ts`) signs up and creates a
project via `POST /auth/signup` / `POST /projects`, using Playwright's
request API, not a database insert and not `packages/sdk`. This
specifically exercises the same public HTTP boundary a real client
would use (matching the explicit instruction not to couple the e2e
suite to SDK behavior — the SDK gets its own unit tests, ADR-0009, and
shouldn't also be a hidden dependency of the browser test suite), while
staying fast and decoupled from unrelated UI flows already covered
elsewhere.

**Mechanism, not just convenience**: the helper uses
`context.request`, not the plain global `request` fixture.
`BrowserContext.request` shares its cookie jar with any `page` later
opened from that same context, so `Set-Cookie` responses from
`/auth/signup` land directly where a subsequent `page.goto()` will read
them — no manual `Set-Cookie` header parsing, which Playwright's
`APIResponse.headers()` doesn't reliably expose as separate entries
even when the server sends the session and CSRF cookies as two
distinct headers.

These setup calls go through the Next.js proxy
(`http://localhost:3001/api/...`, `E2E_WEB_BASE_URL`), not the API
directly. Session and CSRF cookies are scoped to whichever origin
issues them; hitting port 3000 directly would scope them to
`localhost:3000`, and the browser would never send them once `page`
navigates to `localhost:3001` — a real bug this ADR is deciding against
in advance, not one that was hit and patched.

For any further session-authenticated mutation in the helper (creating
a project, creating an API key), the CSRF cookie is read back out of
the context and attached as `X-CSRF-Token`, mirroring exactly what
`apps/web/src/lib/api.ts` does at runtime (ADR-0014).

### Trace/span ingestion hits the API directly, not the proxy

Unlike the setup calls, `trace-smoke.spec.ts`'s ingestion requests
(`POST /traces`, `POST /traces/:id/spans`) target the API's own origin
(`http://localhost:3000`, `E2E_API_BASE_URL`) using the plain global
`request` fixture, not `context.request`. API-key auth uses an
`Authorization` header, not cookies, so there's no origin-scoping
concern — and hitting the API directly is the more faithful
representation of "the public ingestion boundary": a real agent or
script (ADR-0007) never goes through the dashboard's frontend at all.

### Unique data, no automated cleanup, independent tests

`e2e/fixtures/unique.ts` suffixes every generated email/name with
`Date.now()` plus a short random string, so concurrent or repeated runs
never collide and no test depends on another test's data or on
execution order. Playwright's default per-test browser context already
isolates cookies/storage between tests; this isolates the *backend*
data each test creates.

No automated teardown in this pass — a real gap, accepted rather than
built around right now. In CI this doesn't matter (a fresh Postgres is
destroyed at the end of every job run, see below). For local runs
against the persistent dev database, generated emails/names carry an
obvious tag (`@e2e.agenttrace.test`, `E2E Org ...`) specifically so
they're easy for a person to identify and clean up by hand.

### CI: a new, isolated job, not folded into the existing one

A new `e2e` job in `.github/workflows/ci.yml`, separate from the
existing `lint-and-typecheck` job, which stays fast and doesn't need a
database at all.

- **Database isolation**: a `services:` Postgres container
  (`postgres:16-alpine`, matching local dev's image), fresh per job run
  and destroyed when it ends — no shared volume with local dev, no
  shared state between CI runs. Migrations applied with
  `prisma migrate deploy` (non-interactive, apply-only), not
  `migrate dev` (which, per existing known debt, refuses to run
  non-interactively at all).
- **Fixed, committed CI-only credentials** (database password,
  `CSRF_SECRET`): not a secrets-hygiene exception, the same reasoning
  `docker-compose.yml`'s dev Postgres password already documents —
  these protect nothing real, since the database is destroyed at the
  end of the job. `CSRF_SECRET` still has to pass the same startup
  validation (ADR-0014) as any real value, so it's a genuine 64-hex-char
  value, just not a secret one.
- **Browser installation**: `playwright install --with-deps chromium`
  — chromium only, not all three engines, staying narrow; trivial to
  extend later if cross-browser coverage is ever actually needed.
- **Explicit ports**: `apps/web` must be started with `-p 3001`
  explicitly. `next start` (production mode, unlike `next dev`) does
  not auto-fall-back to a free port if the requested one is taken — run
  without an explicit port, it would try to bind 3000, collide with the
  API, and fail outright.
- **Bounded health polling**: both `apps/api`'s `/health` and
  `apps/web` are polled with a capped retry count before tests run,
  not an unbounded loop and not skipped — a service that never comes up
  fails the job with a clear message, not a confusing Playwright
  connection-refused error partway through the first test.
- **Server-log capture**: both services' stdout/stderr redirected to
  log files, uploaded as CI artifacts on every run (`if: always()`), so
  a failing e2e run can be debugged from the CI output alone.
- **Cleanup**: background service PIDs are captured at start and killed
  in an `if: always()` step, regardless of whether the tests passed.
- **One worker**: `workers: 1` in `playwright.config.ts`, not
  parallelized yet. Every test's *data* is independent (unique
  users/projects), but all tests share one running `apps/api` process
  and one Postgres instance, including state I haven't specifically
  verified is safe under concurrency — the in-memory rate-limiter store
  from M9 (ADR-0014) is the clearest example, but not necessarily the
  only one. Serial execution is the conservative default until
  concurrent-worker safety is explicitly checked, not assumed.
- **Failure artifacts**: `trace: 'on-first-retry'`,
  `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'` —
  Playwright's own recommended CI defaults — plus the HTML report
  uploaded as an artifact, so a red run is debuggable without needing
  to reproduce it locally first.

### Out of scope: NestJS's own Jest e2e stub

`apps/api/test/app.e2e-spec.ts` (scaffolded by `nest new` at M0,
untouched since) is a different category entirely: API-level HTTP
integration tests run through Jest and `supertest`, no browser
involved. `CLAUDE.md`'s testing-expectations section bundles this
together with Playwright under one "needs a real CI database"
placeholder, but this milestone is scoped to Playwright specifically,
per direct instruction. The CI database this ADR sets up would be a
reasonable foundation for that separate test category later; building
it out is not part of this milestone.

## Alternatives considered

- **Manual `Set-Cookie` parsing** instead of `context.request`.
  Rejected: fragile (Playwright doesn't reliably expose multiple
  `Set-Cookie` headers as distinct entries) and unnecessary, since
  `BrowserContext.request` already does the right thing by
  construction.
- **Driving every spec's setup through the UI**, including
  `api-keys.spec.ts` and `trace-smoke.spec.ts`. Rejected: slower, and
  couples specs whose actual subject is something else (the API-keys
  UI; ingestion) to the correctness of signup/project-creation forms
  already independently covered.
- **Seeding trace/span test data via `packages/sdk` or a direct Prisma
  insert.** Rejected per explicit instruction: the SDK has its own unit
  tests and shouldn't be a hidden e2e dependency, and a DB insert
  wouldn't exercise the ingestion API boundary at all, which is the
  actual thing `trace-smoke.spec.ts` is meant to prove works.
- **Full parallel workers from the start.** Rejected for now — see the
  "one worker" reasoning above. Revisiting this is a natural, low-risk
  follow-up once the suite is stable and shared-state concerns are
  explicitly checked, not a permanent constraint.
- **Building the NestJS API-integration Jest e2e suite in the same
  milestone.** Rejected: a different test category with its own scope;
  folding it in here would work against the explicit instruction to
  keep this milestone narrow.

## Consequences

- Gain: an automated first slice covering the backbone flows (auth,
  projects, API keys, and one real trace ingested through the actual
  public API and rendered by the actual dashboard), replacing what was
  previously re-verified by hand every milestone.
- Gain: CI now has a real, isolated, disposable Postgres — the
  prerequisite the rest of the testing pyramid (deeper Playwright
  coverage, eventually the NestJS API-integration suite) needs, not
  just something this milestone alone benefits from.
- Give up: no automated test-data cleanup yet; local runs against the
  dev database will accumulate clearly-tagged e2e test rows over time,
  a known, accepted gap, not a silent one.
- Give up: single-worker CI execution is slower per-run than parallel
  would be. Acceptable for a first slice of four specs; worth
  revisiting once the suite is larger and shared-state safety under
  concurrency has actually been checked.
- Later: the NestJS Jest e2e stub, filters/pagination/waterfall
  Playwright coverage, and CI parallelization are all natural next
  steps that this milestone deliberately did not take on.
