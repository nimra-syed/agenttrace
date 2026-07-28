# AgentTrace

Observability and evaluation platform for AI agents — records an agent's
LLM calls, tool calls, latency, token usage, cost, and errors as
traces/spans, and presents them in a web dashboard.

Status: early development (M4, trace ingestion API done). See
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

## Trying API keys locally

```bash
# using the project id from above
curl -b cookies.txt -X POST localhost:3000/projects/<projectId>/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"name":"local dev"}'
# save the "key" from the response, it is only shown once

curl -H "Authorization: Bearer <key>" localhost:3000/api-keys/verify

curl -b cookies.txt -X DELETE localhost:3000/projects/<projectId>/api-keys/<keyId>
curl -H "Authorization: Bearer <key>" localhost:3000/api-keys/verify   # now fails
```

## Trying trace ingestion locally

```bash
# using a fresh, unrevoked key from above
TRACE_ID=$(curl -s -H "Authorization: Bearer <key>" -X POST localhost:3000/traces \
  -H 'Content-Type: application/json' \
  -d '{"name":"issue-investigation","agentName":"github-agent","startedAt":"2026-07-27T10:00:00.000Z","externalTraceId":"run-1"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

curl -H "Authorization: Bearer <key>" -X POST "localhost:3000/traces/$TRACE_ID/spans" \
  -H 'Content-Type: application/json' \
  -d '{"name":"call-llm","type":"LLM","startedAt":"2026-07-27T10:00:01.000Z","endedAt":"2026-07-27T10:00:03.000Z","durationMs":2000,"promptTokens":120,"completionTokens":40}'

# report the trace finishing, same externalTraceId, updates the same row
curl -H "Authorization: Bearer <key>" -X POST localhost:3000/traces \
  -H 'Content-Type: application/json' \
  -d '{"name":"issue-investigation","agentName":"github-agent","status":"SUCCESS","startedAt":"2026-07-27T10:00:00.000Z","endedAt":"2026-07-27T10:00:04.000Z","durationMs":4000,"externalTraceId":"run-1"}'
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
