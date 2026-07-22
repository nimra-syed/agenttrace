# ADR-0001: Monorepo with pnpm workspaces (no Turborepo/Nx yet)

Status: Accepted

## Context

AgentTrace has three deployable apps (`web`, `api`, `reference-agent`) and
two shared libraries (`shared-types`, `sdk`). The frontend and backend need
to share TypeScript types (trace/span DTOs) without duplicating them by
hand, and the reference agent needs to depend on the SDK the same way an
external consumer would.

## Decision

Single git repository, single pnpm workspace (`pnpm-workspace.yaml` at the
root listing `apps/*` and `packages/*`). Internal packages are consumed via
the `workspace:*` protocol, which pnpm resolves to a local symlink — no
publishing to npm required during development.

## Alternatives considered

- **Separate repositories per app.** Rejected: would require publishing
  `shared-types`/`sdk` to a registry (or git submodules) just to share a
  type across two apps we're building together. Real overhead for no
  benefit at this stage — there is exactly one team (me) and one release
  cadence.
- **Turborepo or Nx on top of pnpm workspaces.** Rejected for now: these
  add remote build caching and task orchestration, which matter once a
  monorepo has enough packages/apps that full rebuilds are slow. With
  three apps and two thin packages, `pnpm -r build` is fast enough. We can
  add Turborepo later without restructuring anything — it layers on top of
  the existing workspace, it doesn't replace it.

## Consequences

- Gain: one `pnpm install`, one lockfile, atomic commits across
  frontend/backend/SDK changes, real type sharing.
- Give up: nothing significant yet. The main risk of monorepos — build
  times ballooning — doesn't apply at this scale.
- Later: if `pnpm -r build`/`pnpm -r test` becomes slow enough to be
  annoying, Turborepo is the addition, not a rewrite.
