# ADR-0004: Prisma (not Drizzle) as the ORM

Status: Accepted

## Context

We need to turn the trace/span schema (ADR-0003) into real Postgres tables
with a migration history, and query it from NestJS with type safety, while
this is still an early learning project where a smoother on-ramp is worth
something.

## Decision

Prisma, with `prisma migrate dev` for versioned migrations and Prisma
Client for typed queries. Hand-written raw SQL is still used for the
performance-sensitive trace-list query once we build it (see ADR-0002),
so Prisma isn't the only way we touch the database — just the default.

## Alternatives considered

- **Drizzle.** A thinner layer closer to raw SQL, arguably better for
  building SQL intuition since its query builder mirrors SQL directly.
  Rejected for the primary tool for practical reasons discovered while
  building M1: Prisma Studio gives an actual GUI to inspect data while
  learning schema design, and its migration diffing/generation is more
  mature. Drizzle remains a reasonable choice we'd reconsider if Prisma's
  abstraction ever gets in the way of a query we need to hand-tune.

## Consequences (including what M1 actually surfaced)

- Gain: typed queries generated directly from the schema; a real migration
  history in `prisma/migrations/`; Prisma Studio for inspecting data.
- Give up / learned during implementation: this version of Prisma (7.x)
  turned out to have real complexity we hadn't anticipated:
  - Configuration moved out of `schema.prisma` into `prisma.config.ts` —
    the datasource URL is now a runtime/config concern, not part of the
    committed schema file.
  - Prisma Client now requires an explicit **driver adapter**
    (`@prisma/adapter-pg`, wrapping the standard `pg` library) instead of
    silently managing its own connection — we construct
    `new PrismaPg({ connectionString })` ourselves and pass it in.
  - The generated client ships as TypeScript source with an ESM-only
    default (`import.meta.url`), which broke under `ts-node`'s CommonJS
    mode; we set `moduleFormat = "cjs"` in the generator block and use
    `tsx` (not `ts-node`) to run standalone scripts like `prisma/seed.ts`.
  - None of this is a reason to avoid Prisma — it's a reason to actually
    read a new major version's changelog before assuming old muscle
    memory still applies, which is its own real lesson.
- Later: if trace-analytics queries eventually need PostgreSQL features
  Prisma's query builder doesn't express well, we already write raw SQL by
  hand for those paths rather than fighting the ORM.
