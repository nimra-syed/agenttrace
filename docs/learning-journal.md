# Learning Journal

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
