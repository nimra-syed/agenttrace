# Learning Journal

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
