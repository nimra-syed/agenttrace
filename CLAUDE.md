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

Data model: `Organization` → `Membership` (role) → `User`; `Organization` →
`Project` → `Trace` → `Span` (self-referencing `parentSpanId` tree, same
shape as OpenTelemetry trace/span). Schema lives at
`apps/api/prisma/schema.prisma`; see ADR-0003 for field/index reasoning
and ADR-0004 for why Prisma (not Drizzle). Prisma Client is generated to
`apps/api/generated/prisma` (gitignored, regenerate with
`pnpm --filter api prisma:generate`) and constructed with an explicit
`@prisma/adapter-pg` driver adapter — see `apps/api/src/prisma/prisma.service.ts`.

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
Introduced starting M11; individual milestones may add narrow tests earlier
where they're cheap (e.g., auth guard unit tests at M3).

## Security rules

- No secrets committed. `.env` is gitignored; `.env.example` documents
  required variables without values.
- API keys are stored hashed, never in plaintext; shown once at creation.
- Passwords hashed with bcrypt, never logged.
- Authorization checks (project/org scoping) are tested explicitly, not
  just covered incidentally by happy-path tests.

## Current milestone

M1 complete. Next: M2 — auth (signup/login, sessions) and org/project
creation, built on top of the `User`/`Organization`/`Membership` tables
from M1.

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
