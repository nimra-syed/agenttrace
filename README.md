# AgentTrace

Observability and evaluation platform for AI agents — records an agent's
LLM calls, tool calls, latency, token usage, cost, and errors as
traces/spans, and presents them in a web dashboard.

Status: early development (M1 — Prisma schema, migrations, Postgres
connected). See
[`CLAUDE.md`](./CLAUDE.md) for architecture and conventions, and
[`docs/adr/`](./docs/adr) for the reasoning behind major decisions.

## Repository structure

```
apps/
  web/               Next.js dashboard
  api/                NestJS backend
  reference-agent/    instrumented example agent (added at M6)
packages/
  sdk/                AgentTrace instrumentation client
  shared-types/        shared Trace/Span/DTO types
docs/
  adr/                  architecture decision records
  learning-journal.md
infra/
  docker/               local Postgres via docker compose
```

## Getting started

```bash
pnpm install
pnpm db:up            # local Postgres (docker compose, host port 5433)
cp apps/api/.env.example apps/api/.env   # already present in this repo's dev setup
pnpm db:migrate       # apply Prisma migrations
pnpm db:seed          # demo org/user/project
pnpm dev:api          # NestJS API — http://localhost:3000 (try GET /health)
pnpm dev:web          # Next.js dashboard — http://localhost:3000 (or next free port)
```

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm db:up / pnpm db:down     # start/stop local Postgres
pnpm db:migrate                # create/apply a Prisma migration
pnpm db:seed                     # seed demo data
pnpm db:studio                     # open Prisma Studio (browse tables in a GUI)
```
