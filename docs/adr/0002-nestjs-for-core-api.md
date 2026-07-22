# ADR-0002: NestJS (not FastAPI) for the core API

Status: Accepted

## Context

The core API owns auth, organizations/projects, API keys, and trace
ingestion. It needs to be built by one engineer who already knows
TypeScript/Node well, is simultaneously learning Docker, Postgres, Redis,
and background jobs, and wants the backend itself to teach structured,
production-style architecture (not just "a working server").

## Decision

NestJS, in TypeScript, as the sole backend for the MVP. A FastAPI service
is planned later, but scoped narrowly to an async LLM-as-judge evaluation
worker (see Later Production Features) — a separate service communicating
over a queue, not a second copy of the core API.

## Alternatives considered

- **FastAPI for the whole backend.** Rejected for the core API: it would
  introduce a second language into the critical path while Docker,
  Postgres design, Redis, and queues are already new. FastAPI is
  excellent for async I/O and has first-class tooling for LLM/data work —
  which is exactly why it's the right fit for the evaluation worker later,
  where those strengths actually matter, rather than for CRUD + auth +
  ingestion endpoints.
- **Express/Fastify directly (no framework).** Rejected: would require
  hand-building conventions for module boundaries, dependency injection,
  and cross-cutting concerns (auth guards, validation, logging
  interceptors) that Nest already provides as first-class, well-documented
  patterns. Since a goal of this project is learning structured backend
  architecture, reinventing a weaker version of Nest's conventions is
  pure cost with no learning upside Nest doesn't already provide.

## Consequences

- Gain: one language across `web`/`api`/`sdk`/`shared-types`; Nest's
  guards/interceptors/pipes map directly onto MVP requirements
  (authorization, rate limiting, request validation) instead of being
  hand-rolled; DI and module boundaries are a transferable pattern used
  broadly in industry backend frameworks (Spring, Angular, Nest itself).
- Give up: Nest has more ceremony (decorators, modules, providers) than a
  minimal Express app — more to learn up front, though it's exactly the
  structured-architecture learning this project is optimizing for.
- Later: introducing FastAPI for the evaluation worker becomes a genuine
  polyglot-services lesson (service boundaries, queue-based communication)
  rather than an arbitrary language switch.
