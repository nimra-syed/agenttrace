# Learning Journal

## M5 — TypeScript SDK (2026-07-28)

### What I built

- `AgentTraceClient`, a small SDK wrapping the ingestion API from M4.
  `client.trace(info, fn)` and `trace.span(info, fn)` wrap a callback,
  measuring timing and reporting to AgentTrace automatically.
- Fail-open behavior: any failure in AgentTrace's own reporting (network
  error, timeout, bad response) is caught and logged as a sanitized
  warning, never thrown, so a problem with AgentTrace can never break or
  hang the agent using it.
- Real content in `packages/shared-types` for the first time since it
  was scaffolded in M0: wire-format request/response types, with
  `apps/api`'s DTOs now `implements`-checked against them at compile
  time.

### What I learned

- "Never break the caller's code" and "never hang the caller's code" are
  two different guarantees, and I only had the first one until it was
  pointed out. Fail-open on errors is not enough on its own if a slow
  response can still delay real work; a bounded timeout is what actually
  makes fail-open true in practice, not just in the happy path.
- A callback's return value looks like an obviously convenient thing to
  auto-capture as "the output," and that convenience is exactly the
  problem: it means application code choosing what to return silently
  decides what gets sent to a third system, with no chance to think about
  whether that value is safe to send.
- Wall-clock time and monotonic time solve different problems and are
  not interchangeable. `Date` answers "what time did this happen," useful
  for a dashboard. `performance.now()` answers "how much time elapsed,"
  and unlike `Date`, is guaranteed not to jump due to a clock
  adjustment. Using the wrong one for duration is a subtle, intermittent
  bug, not something that fails in an obvious way most of the time.
- A network timeout is genuinely ambiguous: it means "we stopped
  waiting," not "the server didn't process the request." Code that
  assumes a timeout means failure, and skips anything that depended on
  success, can end up in a worse state than code that treats the
  outcome as unknown and stays self-sufficient regardless. This is why
  the finish call for a trace or span was designed to never depend on
  whether the start call actually succeeded.
- `implements` in TypeScript is a compile-time shape check, nothing
  about it runs when a real HTTP request comes in. It is still valuable:
  it turns "the API and the SDK's types silently drifted apart" from a
  bug someone has to notice into a build failure the moment it happens.

### Decisions made

- ADR-0009: the wrapper API shape, fail-open with a bounded timeout, no
  automatic output capture, wall-clock vs. monotonic timestamps, the
  finish-call-is-self-sufficient design, bounded error capture with
  stack traces excluded, and sanitized warning logging.

### Problems encountered and how we resolved them

- Jest failed to parse the SDK's test files at all
  (`Cannot use import statement outside a module`) once
  `packages/sdk/package.json` had `"type": "module"` set. Fixed by
  removing it, matching `apps/api`'s existing convention of relying on
  `tsconfig`'s `NodeNext` module resolution without also declaring the
  package as real ESM, which Jest's default CommonJS-oriented transform
  does not handle well. Also hit a stale Jest cache while debugging this,
  `jest --clearCache` was necessary after the fix before it actually took
  effect, worth remembering before assuming a fix didn't work.
- A test that mocked the global `Date` constructor
  (`jest.spyOn(global, 'Date')`) to simulate a wall-clock jump produced
  objects missing their prototype methods (`toISOString` was not a
  function). Native constructors are known to be fragile to mock this
  way. Replaced with a simpler test that only mocks `performance.now()`
  and lets real, unmocked wall-clock time pass, which proves the same
  property (duration comes from the monotonic clock) without needing to
  fight a native constructor mock at all.

### Interview questions I should be able to answer

- Why does "fail open" require a timeout, not just a try/catch around
  the network call?
- Why should an SDK never automatically send a wrapped function's return
  value to a third-party system?
- What is the actual difference between wall-clock time and monotonic
  time, and why does duration specifically need the monotonic one?
- Why is a network timeout an ambiguous outcome, and how did that shape
  the design of the "finish" call?
- What does `implements` actually check in TypeScript, and what does it
  not check?

### Common mistakes engineers make here

- Adding a try/catch around a network call and calling it "fail open,"
  without a timeout, so a hanging request still blocks or delays the
  caller even though it will eventually resolve to a caught error.
- Auto-capturing a function's return value for logging or telemetry
  without considering that the function's caller never opted into that
  data leaving the process.
- Using `Date.now()` (or two `Date` objects) to measure elapsed time
  instead of a monotonic clock, which works almost all the time and
  fails intermittently in a way that's hard to reproduce.
- Assuming a network timeout means the request definitely failed
  server-side, when it only means the client gave up waiting.

### How this milestone improves my resume

"Designed a fail-open TypeScript SDK (bounded timeouts, explicit opt-in
output capture, monotonic duration measurement, and a self-sufficient
upsert-based reporting protocol) for instrumenting third-party
application code without risking that code's correctness or
availability" is a specific, real claim about building a library other
people's code depends on, a different skill than building an API only
your own frontend calls.

## M4 — Trace ingestion API (2026-07-27)

### What I built

- `POST /traces` and `POST /traces/:traceId/spans`, the first endpoints
  meant to be called by code (an agent's own instrumentation) instead of
  a person testing the API by hand.
- Both act as an upsert: a client supplied `externalTraceId` /
  `externalSpanId` decides whether a request creates a new row or
  updates an existing one, so an agent can report a trace as started,
  then report the same trace again later as finished.
- A `Span.parentSpanId` check requiring the referenced parent span to
  already exist and belong to the same trace, plus a check preventing a
  span from being its own parent.
- Renamed `Trace.idempotencyKey` to `Trace.externalTraceId`, and added
  `Span.externalSpanId`, after realizing the old name described the
  wrong concept.
- Finished the `ApiKey.lastUsedAt` work deferred from M3: it now updates
  after a key successfully authenticates, throttled to once per hour.

### What I learned

- A name can be technically functional but still wrong, in a way that
  would eventually cause a real bug. `idempotencyKey` worked, the
  unique-constraint-plus-upsert mechanism was already correct, but the
  name itself invited the wrong usage: standard idempotency-key advice
  says to generate a fresh key per request, which would have silently
  broken the exact "report now, update later" pattern the field existed
  to support. Renaming it to `externalTraceId` fixed nothing about the
  code, only the name, and that was the actual fix.
- Prisma treats `undefined` and `null` differently on purpose in
  `create`/`update` data: `undefined` means "do not mention this
  column," `null` means "write an actual NULL." This is exactly the
  tool needed for "an omitted field on an update should not overwrite
  existing data," as long as application code does not accidentally
  apply a default (like `status ?? RUNNING`) to a field before it
  reaches Prisma, which would turn an intentionally-omitted field into
  an explicit overwrite.
- Nullable JSON columns are a genuine Prisma special case: a plain `null`
  is ambiguous between "no value" and "the JSON value `null`," so Prisma
  has a distinct `Prisma.DbNull` sentinel for "actually clear this
  column," different from passing `null` directly.
- An atomic database operation (`upsert()`) and an informational read
  used only for validation are not the same kind of "read before write."
  The race a retried request could cause is specifically about the
  create-or-update *decision*, which stays inside the single atomic
  call; a read done purely to check something like self-parenting
  doesn't reintroduce that race, since it never decides how the write
  itself resolves.
- A constraint can be worth documenting as a real limitation rather than
  silently working around: parent-first ingestion (a span's parent must
  already exist) is simple and correct for a synchronous agent, but
  would break for any future out-of-order or batched ingestion. Writing
  that down now means it won't need to be rediscovered later.

### Decisions made

- ADR-0008: upsert-based ingestion, undefined vs null update semantics,
  the externalTraceId/externalSpanId rename, parent-first ingestion as a
  documented limitation, semantic validation rules, and the lastUsedAt
  update timing.

### Problems encountered and how we resolved them

- `prisma migrate dev` refused to run at all in this non-interactive
  terminal, even with `--create-only`, since it always wants to be able
  to prompt. Worked around with `expect` to drive the interactive
  confirmation prompt for `--create-only` (generating the migration file
  without applying it), reviewed the generated SQL, then applied it
  non-interactively with `prisma migrate deploy`, which is meant for
  exactly that.
- A broken `NODE_OPTIONS` environment variable (pointing at a missing
  harness file, unrelated to this project) made every `node`/`pnpm`
  command fail outright partway through this session. Worked around
  per-command with `NODE_OPTIONS=""`, documented in `CLAUDE.md` so it
  isn't mistaken for a project problem next time.
- TypeScript rejected passing `unknown`-typed DTO fields directly into
  Prisma's JSON columns, correctly, since Prisma's JSON input type is
  more specific than `unknown`. Fixed with a small `toJsonInput` helper
  that also handles the `Prisma.DbNull` case from above.

### Interview questions I should be able to answer

- Why does this ingestion API use upsert instead of separate start/end
  endpoints for a trace or span?
- What is the actual difference between `undefined` and `null` in a
  Prisma update call, and why does that distinction matter for a
  "report now, update later" API?
- Why was `idempotencyKey` the wrong name for a field whose mechanism
  was already correct?
- What does "parent-first ingestion" mean, and what would break it?
- Why doesn't a validation-only read before an `upsert()` call
  reintroduce the race that the atomic upsert is meant to prevent?

### Common mistakes engineers make here

- Applying a default value (`?? someDefault`) to a field on both the
  create and update paths of an upsert, which silently overwrites
  existing data with a default on every update where the client didn't
  resend that field.
- Naming a field after the mechanism it happens to use (idempotency)
  instead of the concept it actually represents (a stable client
  identity), which invites correct-sounding advice for the wrong
  concept.
- Treating `null` and an omitted field as the same thing when building
  update payloads, when they need to mean different things: clear this,
  versus leave it alone.
- Assuming any read before a write reintroduces a race condition,
  instead of checking specifically whether that read is used to decide
  the write's outcome.

### How this milestone improves my resume

"Designed an idempotent trace/span ingestion API (atomic upsert
semantics, undefined-vs-null update handling, parent-first referential
validation) that supports both one-shot and progressive reporting from
client SDKs" is a specific, real claim about API design for a system
that receives data from external clients, not just CRUD over your own
frontend.

## M3 — API keys, create and revoke (2026-07-24)

### What I built

- Endpoints for a signed in user to create, list, and revoke API keys for
  a project.
- A new `ApiKeyGuard`, separate from the session guard from M2, that
  reads an `Authorization: Bearer <key>` header and resolves it to a
  project instead of a person.
- A temporary `GET /api-keys/verify` endpoint to prove the guard works
  with a real HTTP request, since there was no other API-key-protected
  endpoint yet to test it against.
- Moved the `hashToken` helper out of the auth folder into a shared
  common folder, since both sessions and API keys need it now, not just
  auth.

### What I learned

- A session answers "which person," an API key answers "which project."
  They needed two different guards, not one guard trying to handle both
  cases, since what gets attached to the request afterward
  (`request.user` versus `request.apiKeyContext`) is a genuinely
  different shape.
- Giving every failure case the same error message is a real security
  choice, not just tidiness. If "missing key," "unknown key," and
  "revoked key" each had their own message, an attacker probing an
  endpoint could learn something from which message came back. I wrote a
  test specifically checking that all rejection cases produce the exact
  same message, not just that they all return 401.
- An authorization check can have more than one part. Revoking a key
  needed two separate checks: does this project belong to my
  organization, and does this key belong to this project. Skipping
  either one on its own would open a real gap, even though each check
  looks like it is doing the same kind of thing.
- Returning `404` instead of `403` for a project you cannot access, a
  pattern from M2, applies here too. It came up again naturally instead
  of needing to be reinvented, which was a good sign that the pattern
  actually generalizes.
- A guard can be applied per route with `@UseGuards(...)` instead of
  globally. `SessionGuard` from M2 is global because most routes are for
  a logged in person. `ApiKeyGuard` is not global, because only a few
  routes are meant to be called by a script holding a key.

### Decisions made

- ADR-0007: API key format, hashed storage, one generic 401 for every
  failure case, and `/api-keys/verify` marked explicitly as temporary.

### Problems encountered and how we resolved them

- No schema or tooling problems this milestone. The `ApiKey` table
  already existed from M1's schema, and the hashing and guard patterns
  from M2 carried over directly, so most of this was applying an
  established pattern rather than solving something new.
- The pre-commit review did catch two real issues in the first version
  of the code, both worth remembering:
  - I had `ApiKeyGuard` update `lastUsedAt` on every successful
    authentication. It worked, but it meant every future ingestion
    request (M4, the busiest path in the whole system) would carry an
    extra database write just to track a field that is only useful
    occasionally. Removed for now, revisit with a throttled or async
    update once ingestion exists.
  - `revoke()` did not check whether a key was already revoked. Calling
    it twice would silently overwrite the original `revokedAt`
    timestamp with a new one, which quietly defeats the audit reasoning
    for soft-deleting instead of hard-deleting in the first place. Fixed
    by making revoke idempotent: if already revoked, return success
    without touching the row.
  - Neither issue would have failed a test or a build. Both were only
    caught by specifically asking "what happens on every request" and
    "what happens if this is called twice," not by anything automated.

### Interview questions I should be able to answer

- Why does an API key need a different guard than a session, instead of
  reusing the same one?
- Why is giving every auth failure the same error message a security
  decision and not just a style choice?
- What are the two separate checks involved in revoking an API key, and
  what would go wrong if only one of them existed?
- Why store a short prefix of an API key separately from its hash?
- Why mark `/api-keys/verify` as temporary instead of just building it
  and moving on?
- Why does writing `lastUsedAt` on every authenticated request matter
  more for an ingestion endpoint than for a login endpoint?
- What goes wrong if an action like "revoke" is not idempotent, and how
  would you notice, since it would not show up as a failing test?

### Common mistakes engineers make here

- Giving different error messages for different auth failure reasons,
  which leaks information to whoever is probing the endpoint.
- Checking that a project belongs to the right organization, but
  forgetting to also check that the specific resource being modified
  (an API key here) actually belongs to that project.
- Adding a write to a hot path (a field update on every authenticated
  request) without asking how often that path will actually run once a
  real client is calling it many times a second.
- Writing an action like "revoke" or "delete" as if it will only ever be
  called once, so a retried or duplicate call silently does something
  slightly wrong (like overwriting a timestamp) instead of safely doing
  nothing.
- Building a debug or test endpoint and never revisiting whether it
  should still exist once the real endpoint it was standing in for
  finally gets built.

### How this milestone improves my resume

"Designed and implemented an API key system (hashed storage, prefix
based identification, a dedicated auth guard, and a tested single-message
failure response) as a second authentication path alongside session
based login" shows the ability to support more than one kind of client
(browser and machine) in the same system, a common real world need.

## M2 — Auth, sessions, and org/project creation (2026-07-23)

### What I built

- Signup and login with email and password, using bcrypt to hash
  passwords.
- A `Session` table and a session cookie system. When you log in, the
  server makes a random token, stores only its hash in the database, and
  sends the raw token to the browser as an httpOnly cookie.
- A `SessionGuard` that checks this cookie on every request, applied
  globally, with a `@Public()` decorator for the few routes that should
  skip it (signup, login, health check).
- Endpoints to create and list projects, scoped to the signed in user's
  organization.
- Unit tests for the signup and login logic, using a mocked database so
  no test database was needed yet.

### What I learned

- The difference between authentication (who are you) and authorization
  (what are you allowed to do). This milestone builds authentication and
  a very simple form of authorization (are you a member of this
  organization).
- Why hashing a session token before storing it matters, not just
  hashing passwords. If the database ever leaked, an attacker with only
  the hashes still could not log in as anyone, since they do not have the
  original random tokens.
- httpOnly cookies keep a token away from client side JavaScript. This
  matters because it means an XSS bug somewhere else in a future
  frontend could not just read the cookie and steal a session.
- Why a login should give the exact same error for "wrong password" and
  "no such user." If the errors were different, an attacker could use
  login attempts to figure out which emails have accounts, one at a time.
- Nest's guards can be applied globally, and turned off per route with a
  decorator, instead of being added one at a time to every protected
  route. This means new routes are protected by default, which is safer,
  since it is easy to forget to add a guard to a new route but much
  harder to forget to remove `@Public()` from a route that should not
  have it.
- Database transactions matter for signup, since it creates three rows
  (organization, user, membership) that all need to succeed together or
  not at all. If the membership creation failed after the user was
  already created, we would have a user with no organization, stuck.

### Decisions made

- ADR-0005: session based auth with hashed tokens, no Passport, guard
  defaults to deny.
- ADR-0006: create an organization automatically at signup, one
  organization per user for now.

### Problems encountered and how we resolved them

- The same `.js` extension import problem from M1 showed up again, this
  time in Jest. `ts-jest` could not resolve `../../generated/prisma/client.js`
  because only the `.ts` file exists on disk. Fixed by adding a
  `moduleNameMapper` rule to the Jest config that strips `.js` from
  relative imports before Jest tries to resolve them. This is a known,
  documented workaround for `ts-jest` plus `nodenext` style TypeScript
  projects, not something specific to our setup.
- Once the session guard was registered globally, the existing `/` and
  `/health` routes from M0 and M1 started requiring a login too, since
  they were not marked public. Had to explicitly add `@Public()` to both.
  A good reminder that a global guard change can quietly break existing
  routes if you are not careful to check all of them.

### Interview questions I should be able to answer

- What is the actual difference between a session and a JWT, and when
  would you pick one over the other?
- Why hash a session token before storing it, if the cookie is already
  httpOnly?
- Why does a login endpoint give the same error for a wrong password and
  an email that does not exist?
- What is a database transaction protecting against in the signup flow,
  specifically?
- Why register an auth guard globally instead of adding it to each
  protected route one at a time?

### Common mistakes engineers make here

- Giving different error messages for "wrong password" versus "no such
  account," which leaks which emails are registered.
- Storing a raw, usable session token in the database instead of a hash
  of it.
- Adding a new protected route and forgetting to add the auth check to
  it, because the project relies on each route remembering to add its
  own guard instead of defaulting to protected.
- Skipping a database transaction on a multi step signup, leaving room
  for a user to end up half created if one step fails.

### How this milestone improves my resume

"Built a session based authentication system from scratch (hashed
tokens, httpOnly cookies, a globally applied guard with explicit public
route opt outs) and a multi tenant project creation flow with tested
authorization boundaries" is a real, specific line. It shows an
understanding of how login actually works, not just "used a login
library."

## M1 — Prisma schema, migrations, and a live Postgres connection (2026-07-22)

### What I built

- The full trace/span data model (`Organization`, `User`, `Membership`,
  `Project`, `ApiKey`, `Trace`, `Span`) as `apps/api/prisma/schema.prisma`,
  applied to local Postgres via a real, versioned migration.
- A seed script creating a demo org/user/project, runnable idempotently
  via `pnpm db:seed`.
- `PrismaService`/`PrismaModule` in NestJS, managing the Prisma connection
  through Nest's own module lifecycle, plus a `GET /health` endpoint that
  proves the API can actually reach Postgres (`SELECT 1` through Prisma).

### What I learned

- **Migrations vs. `db push`**: `prisma migrate dev` generates a
  versioned, plain-SQL file and records it as applied in a
  `_prisma_migrations` table — every environment replays the same ordered
  SQL to reach the same state. `db push` just diffs and mutates, with no
  history; fine for throwaway prototypes, wrong for anything with real
  data or more than one environment.
- **Postgres enforces enums and foreign keys at the database layer**, not
  just in application code — `CREATE TYPE ... AS ENUM` means an invalid
  status value is rejected by Postgres itself, and a foreign key means you
  literally cannot insert a `Trace` row pointing at a `Project` that
  doesn't exist, regardless of what the application code does.
- **`ON DELETE RESTRICT` vs `CASCADE`** is a real design decision, not a
  default to ignore — RESTRICT (Prisma's default) protects against
  accidental data loss by refusing a delete while dependents exist; we
  kept it everywhere, including `Span → Trace`, since we have no deletion
  feature yet and don't want silent cascading deletes as a side effect of
  something else.
- **`DECIMAL`, not `FLOAT`, for money-like values** — floating point
  rounding error compounds; fixed-point decimal is the standard choice for
  anything resembling currency.
- **Prisma 7 changed enough conventions that old habits actively broke
  things**: the datasource URL moved out of `schema.prisma` into
  `prisma.config.ts`; `PrismaClient` now requires an explicit driver
  adapter (`@prisma/adapter-pg`, wrapping the standard `pg` driver)
  instead of managing its own connection; and the generated client
  defaults to an ESM-only shape (`import.meta.url`) that breaks under
  `ts-node`'s CommonJS mode. Fixed by setting `moduleFormat = "cjs"` in
  the generator block and running standalone scripts with `tsx` instead
  of `ts-node`. Lesson: a major-version bump is a reason to actually check
  what changed, not assume prior experience still applies verbatim.
- **`prisma init` isn't harmless scaffolding** — this version bundled
  duplicate "AI assistant skill" doc packs for three different tools into
  the repo unprompted. Worth actually looking at what a scaffolding
  command generates rather than trusting it by default.
- **NestJS module lifecycle hooks** (`OnModuleInit`, `OnModuleDestroy`)
  are how you tie an external resource's connection lifecycle (Prisma's
  connection pool here) to the application's own startup/shutdown,
  instead of managing it as a bare global.

### Decisions made

- ADR-0003: trace/span data model, ID/index/type choices, RESTRICT as the
  default delete behavior.
- ADR-0004: Prisma over Drizzle, including the real Prisma-7-specific
  friction encountered while implementing it.

### Problems encountered and how we resolved them

- `ts-node prisma/seed.ts` failed with `Cannot find module
  '../generated/prisma/client.js'` — the generated client is `.ts` source
  using `.js`-extension internal imports (TypeScript's `nodenext`
  convention), which plain CommonJS `require` can't resolve. Fixed by
  switching the seed runner to `tsx` and setting the generator's
  `moduleFormat` to `"cjs"` to drop the ESM-only `import.meta.url` usage
  entirely.
- Port 5432 conflict (already documented from M0) meant `.env` had to
  point at `localhost:5433`, not the Postgres default.

### Interview questions I should be able to answer

- What's the actual difference between `prisma migrate dev` and
  `prisma db push`, and why does it matter which one you use against a
  database with real data in it?
- Why store cost as `Decimal` instead of `Float`?
- What does `ON DELETE RESTRICT` protect against, and when would you
  choose `CASCADE` instead?
- Why does an ORM's generated client need to know about your database
  driver at all (driver adapters) — what problem does that solve compared
  to the ORM managing its own connection internally?
- Why is `Span.parentSpanId` a self-reference instead of a separate join
  table, and how does that map to OpenTelemetry's model?

### Common mistakes engineers make here

- Using `db push` against a database that already has real data, losing
  migration history and making rollback/audit impossible.
- Defaulting to `CASCADE` everywhere "to keep things simple," which turns
  one accidental delete into a much bigger accidental delete.
- Blindly trusting a scaffolding tool's output (`prisma init` here)
  without checking what it actually generated.
- Assuming a major-version upgrade of a dependency preserves all prior
  behavior — checking the changelog would have caught the driver-adapter
  and ESM changes before hitting the errors directly.

### How this milestone improves my resume

"Designed a multi-tenant Postgres schema (orgs/projects/API keys/traces/
spans) with versioned Prisma migrations, idempotency-safe unique
constraints, and NestJS-managed connection lifecycle" is a legitimate,
specific resume line — it names real decisions (idempotency, tenancy,
migrations) instead of just "used Postgres."

## M0 — Repo scaffolding (2026-07-21)

### What I built

- A pnpm-workspace monorepo (`apps/web`, `apps/api`, `packages/shared-types`,
  `packages/sdk`) with a shared `tsconfig.base.json`.
- Next.js (App Router, TS, Tailwind) app and a NestJS app, both installing,
  linting, typechecking, and building cleanly.
- `infra/docker/docker-compose.yml` for local Postgres.
- A GitHub Actions CI skeleton (install → lint → typecheck → build).
- `CLAUDE.md`, ADR process (`docs/adr/`), and this learning journal.

### What I learned

- **Corepack** is the officially bundled way to get a pinned package-manager
  version (`pnpm`) without a separate global install — Node ships it, you
  just `corepack enable`.
- **pnpm workspaces** turn a set of folders into linked local packages via
  the `workspace:*` protocol — no publishing to npm needed for one package
  to `import` another inside the same repo.
- **pnpm 10+ blocks native postinstall/build scripts by default**
  (supply-chain-attack mitigation — a malicious package can't silently run
  arbitrary code on `install` anymore). You explicitly allow the ones you
  trust in `pnpm-workspace.yaml` (`allowBuilds`). We allowed `sharp`
  (native image resizing for `next/image`) and `unrs-resolver` (native
  resolver used by ESLint's import plugin) — both extremely widely-used
  packages, not something we're taking on blind trust.
- **A nested `pnpm-workspace.yaml`** (created by `create-next-app`'s
  template) would have made `apps/web` its own separate workspace root
  instead of a member of ours — workspace files only belong at the
  monorepo root. Had to catch and remove it.
- **CI lint must never run with `--fix`.** Nest's default generated `lint`
  script includes `--fix`, which is fine for a local pre-commit habit but
  wrong in CI: CI should *fail* on violations, not silently rewrite files
  and pass. Split into `lint` (check-only, used in CI) and `lint:fix`
  (local convenience).
- **Port conflicts are a normal part of local dev with Docker.** This
  machine already runs a native PostgreSQL 15 install bound to 5432
  (unrelated to this project). Rather than touching an existing system
  service, we remapped our container's *host* port to 5433, leaving the
  *container's internal* port at 5432 — the mapping (`5433:5432`) only
  affects how you reach it from the host, not how Postgres itself is
  configured inside the container.
- **`nest start --watch` spawns a child process that outlives a naive
  `pkill -f` on the parent's command line** — killing dev servers
  cleanly sometimes means killing whatever's bound to the port
  (`lsof -ti:PORT | xargs kill`), not just the command you launched.

### Decisions made

- ADR-0001: pnpm workspaces, no Turborepo/Nx yet.
- ADR-0002: NestJS for the core API; FastAPI deferred to a future,
  narrowly-scoped evaluation worker.

### Problems encountered and how we resolved them

- `create-next-app` and `nest new` running concurrently raced on creating
  `apps/`, and the Next.js scaffold failed with a permissions error.
  Resolved by re-running it alone once `apps/` existed.
- Docker Compose failed to bind port 5432 because of the pre-existing
  native Postgres install. Resolved by remapping the host port to 5433
  (see above).

### Interview questions I should be able to answer

- Why does this project use a monorepo instead of separate repositories,
  and what would make you switch to Turborepo/Nx?
- What is `workspace:*` doing, mechanically, when one package "depends on"
  another in the same repo?
- Why did you choose NestJS over FastAPI for the core API, and where does
  Python still fit in this system?
- What's the difference between blocking native install scripts by default
  (pnpm 10+) and the older behavior — what's the actual attack this
  defends against?
- Why does a `docker-compose.yml` port mapping look like `"5433:5432"`,
  and which side is "the outside world" vs. "inside the container"?

### Common mistakes engineers make here

- Running `--fix` in CI lint steps, which turns a should-fail check into a
  silent auto-correction (and can mask real issues, or even fail
  unexpectedly if the CI runner's filesystem is read-only).
- Committing a monorepo without deciding the workspace boundary up front,
  leading to nested/conflicting workspace files from scaffolding tools.
- Killing Docker port conflicts by stopping or uninstalling whatever else
  is using the port, instead of just remapping your own container.

### How this milestone improves my resume

Not itself a resume bullet on its own (it's scaffolding), but it's the
foundation the real bullets (ingestion API design, dashboard, deployment)
will sit on — and "structured a TypeScript monorepo with shared types
across frontend/backend/SDK, enforced via CI" is a legitimate, small,
factual line if needed.
