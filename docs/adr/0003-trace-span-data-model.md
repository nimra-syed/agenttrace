# ADR-0003: Trace/span data model and indexing strategy

Status: Accepted

## Context

AgentTrace needs a schema that can record an agent run (a "trace") made of
ordered steps (LLM calls, tool calls — "spans"), scoped to a project, with
enough metadata to drive the MVP dashboard: filtering by project/status/
agent/date, showing a per-run waterfall, and surfacing cost/tokens/latency/
errors. It also needs to support idempotent ingestion (MVP requirement) and
multi-tenant boundaries (org → project) from day one, since retrofitting
tenancy onto an existing schema is expensive.

## Decision

See `apps/api/prisma/schema.prisma` for the full schema. Key choices:

- **UUID primary keys** (`@default(uuid())`) on every table, not
  auto-increment integers — safe to expose in URLs/API responses without
  leaking row counts or enabling ID-guessing.
- **`Span.parentSpanId` self-reference** instead of a separate join table —
  the same shape OpenTelemetry uses for trace/span trees, so adopting real
  OTel later is additive, not a rewrite.
- **`idempotencyKey` is nullable with `@@unique([projectId, idempotencyKey])`**
  — Postgres treats each `NULL` as distinct under a unique index, so
  idempotency is opt-in per ingestion call rather than mandatory.
- **`ApiKey.keyHash` is globally unique**, not scoped to project — key
  lookup has to resolve *to* a project, so it can't be scoped by the thing
  it's used to find.
- **`Decimal(10,6)` for all cost fields**, never `Float` — money-like
  values need exact fixed-point arithmetic; floating point rounding error
  compounds across thousands of spans.
- **Two indexes on `Trace`**: `(projectId, startedAt DESC)` for the
  dashboard's default list view, and `(projectId, status)` for status
  filtering — chosen for the specific query patterns the MVP dashboard
  requires, not speculatively.
- **All foreign keys default to `ON DELETE RESTRICT`** (Prisma's default).
  Deliberately kept, including for `Span → Trace`: we have no deletion
  feature yet, and RESTRICT forces an explicit, deliberate cleanup step
  later instead of silent cascading data loss. Revisit when we build
  retention policies / project deletion.

## Alternatives considered

- **Auto-increment integer IDs.** Rejected: leaks sequence information,
  and UUIDs are the norm for anything exposed externally.
- **A generic `attributes` key-value table instead of typed columns.**
  Rejected for MVP: typed columns (`promptTokens`, `costUsd`, etc.) let
  Postgres index and aggregate them directly; a fully generic
  attribute-bag defers that cost to query time, which matters for the
  dashboard's filter/sort/aggregate needs. `metadata: Json` still exists
  on both `Trace` and `Span` for anything genuinely unstructured.
- **Cascading deletes by default.** Rejected for now — see RESTRICT
  reasoning above.

## Consequences

- Gain: the schema already matches the shape of the ingestion API and
  dashboard queries the MVP needs, and it's structurally compatible with
  adopting OpenTelemetry's trace/span model later without a rewrite.
- Give up: typed columns mean adding a genuinely new piece of per-span
  metadata later requires a migration, not just a new JSON key. Acceptable
  trade for query performance and type safety on the fields we know we need.
- Later: retention policies and project/org deletion will require
  revisiting the RESTRICT default deliberately, likely with an explicit
  soft-delete or archival step rather than a blanket CASCADE.
