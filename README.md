# AgentTrace

Observability and evaluation platform for AI agents — records an agent's
LLM calls, tool calls, latency, token usage, cost, and errors as
traces/spans, and presents them in a web dashboard.

Status: early development (M2, auth, sessions, and org/project creation
done). See
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
pnpm dev:api          # NestJS API, http://localhost:3000 (try GET /health)
pnpm dev:web          # Next.js dashboard, http://localhost:3000 (or next free port)
```

## Trying auth locally

```bash
curl -c cookies.txt -X POST localhost:3000/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a long password","name":"Your Name","orgName":"Your Org"}'

curl -b cookies.txt localhost:3000/auth/me

curl -b cookies.txt -X POST localhost:3000/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Agent"}'

curl -b cookies.txt localhost:3000/projects
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
