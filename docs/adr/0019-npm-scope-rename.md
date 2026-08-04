# ADR-0019: Renaming the SDK and CLI to the @agenttraceai npm scope

Status: Accepted

## Context

M15 (ADR-0018) built `@agenttrace/cli` on the assumption that the
`@agenttrace` npm scope belonged to this project. It doesn't: it's
owned by an unrelated organization. This was found live, not caught by
inspection, while starting M17's (at the time still called M16) own
live verification of `agenttrace init`'s dependency-install step. A
real `npm install @agenttrace/sdk` against a throwaway project
succeeded, but the installed `package.json` turned out to belong to a
completely different project (repository `AdelElo13/agenttrace`, a
different API surface entirely). Checking further, the obvious
unscoped fallbacks were no better: `agenttrace-sdk` and `agenttrace-cli`
are both already real, published, unrelated packages under yet other
GitHub accounts. `init`'s automatic install step, as designed, would
have silently installed a stranger's package believing it to be this
project's own SDK, and the generated scaffold file's `@agenttrace/sdk`
import would have resolved to it.

This also surfaced two prerequisites for real external publishing that
M15 hadn't needed yet, since nothing was actually being published:
`packages/sdk` depends on `packages/shared-types` via the `workspace:*`
protocol, which only resolves inside this pnpm workspace, and
`packages/sdk` ships raw TypeScript source with no build step, fine for
in-monorepo consumers running through `tsx`/`ts-jest`/the CLI's own
esbuild bundle, but not fine for an external developer importing it
directly with no special tooling.

## Decision

### The new scope

`@agenttraceai`, an npm organization the project owner created and
verified they control, confirmed live against the registry before this
work started: no package currently exists at `@agenttraceai/sdk` or
`@agenttraceai/cli`. Three packages renamed for consistency:
`@agenttrace/sdk` to `@agenttraceai/sdk`, `@agenttrace/cli` to
`@agenttraceai/cli`, and `@agenttrace/shared-types` to
`@agenttraceai/shared-types` (the third one purely for internal
consistency: it's workspace-only, never published, and renaming it
costs nothing but avoids leaving the monorepo on two different scopes
for no reason). The CLI's bin/command name stays `agenttrace`: package
scope and the installed binary name are independent, and there's no
reason to change the product-facing command just because the package
name changed underneath it.

### `packages/sdk` gets a real build for the first time

Mirrors the reasoning M15 already established for `packages/cli`
(ADR-0018), one package later than expected: `esbuild` bundles
`src/index.ts` into a single `dist/index.js` (CJS, no external runtime
dependencies at all, confirmed by reading every source file directly:
every import is either a relative path or a Node built-in). `main`/
`types` now point at `dist/` instead of raw `src/index.ts`.

### Shared types are bundled into the SDK's declaration output, not published separately

`packages/sdk`'s only use of `packages/shared-types` is `import type`
(confirmed by reading `http.ts` and `trace-context.ts` directly), so the
runtime bundle never needed shared-types resolvable at all; type-only
imports are erased entirely during compilation. The declaration output
is the one place this actually mattered: left alone, `tsc`'s emitted
`.d.ts` would still reference `@agenttraceai/shared-types` by import,
which would break for an external consumer unless that package were
also published. Instead, `dts-bundle-generator` (a new devDependency,
narrowly scoped to exactly this problem, the same "reach for an
established tool rather than reinvent" reasoning already applied to
`@nestjs/throttler` and `open`) produces a single, self-contained
`dist/index.d.ts` with `shared-types`'s definitions inlined directly.
Verified by reading the generated output: `SpanType` and everything
built on it appear as real, local type declarations, with zero
remaining external import. This means `packages/shared-types` itself
never needs to be published; it stays workspace-only, exactly as it
already was.

### Every functional reference renamed, historical docs left alone

Every real call site (~15 files: both package.json names, the CLI's
three commands that import `AgentTraceClient`, `init`'s
`SDK_PACKAGE_NAME` constant, the generated scaffold content in
`scaffold.ts`, both READMEs, `apps/reference-agent`'s dependency and
import, and every `apps/api`/`apps/web` file importing
`shared-types`) was updated and re-verified: a full `pnpm typecheck`
across all seven workspace projects, `apps/api`'s and the SDK's and
CLI's full test suites, and a full `pnpm build` all pass clean after
the rename.

`CLAUDE.md` was updated throughout, since it documents current reality.
`docs/learning-journal.md`'s M15 entry and ADR-0018 were deliberately
left unchanged: they're the historical record of what M15 actually
built and named at the time, and this project's own convention is to
document a correction with a new entry, not rewrite history to pretend
the old name was never real.
`docs/architecture/cli-init-design.md` (the M17 design doc, not yet
implemented) was updated to the new name, since it describes work that
hasn't shipped yet and will use the new name once it does.
`docs/architecture/cli-onboarding-design.md` (the M13-M15 design doc,
already fully implemented) was left alone for the same historical-record
reason as ADR-0018.

### Published for real: @agenttraceai/sdk@0.1.0, @agenttraceai/cli@0.1.1

Both packages were made publish-ready (`private` removed,
`publishConfig.access: "public"` set, a `files` field limiting the
published tarball to `dist`/`LICENSE`), and a `--dry-run` publish was
run for both to show their exact contents before anything real
happened. The actual `npm publish` was deliberately held back at that
point, at the project owner's explicit request, until the package
contents had been reviewed.

The real publish itself needed a browser-based one-time-password step:
`npm whoami` succeeding, and even a freshly-completed `npm login`
session, are not the same thing as the account's own 2FA publish
authority, confirmed live when the first `npm publish` attempt for
`@agenttraceai/sdk` returned a `403` requiring 2FA. That OTP step was
completed by the project owner directly in their own browser, never
attempted by the assistant, consistent with this project's standing
rule about never handling credentials or authentication challenges on
someone else's behalf. `@agenttraceai/sdk@0.1.0` published first, and
was verified live (registry manifest, then a real `npm install` into a
completely clean external directory constructing a real
`AgentTraceClient`) before `@agenttraceai/cli` was published, exactly
matching the order and gating the project owner specified.

### A real bug found during the CLI's own publish verification, unrelated to the rename

The first `@agenttraceai/cli@0.1.0` publish went through, but
`bin.ts` had never treated `--help`/`-h` as a recognized flag: it fell
through to the same branch as an unrecognized command, which happened
to still print the correct usage text but set `process.exitCode = 1`
instead of `0`. Found and fixed the same day, verified against a real
packed tarball installed into a clean directory before publishing,
then again against the real, live registry package after publishing:
an exported, pure `usageExitCode(command)` decides `0` for no command/
`--help`/`-h` and `1` for anything else unrecognized, with 4 new
focused tests. `bin.ts`'s top-level self-invocation was guarded with
`require.main === module` specifically so this function could be
imported by a test without triggering a real CLI run or the explicit
`process.exit()` at the bottom of the file. Shipped as
`@agenttraceai/cli@0.1.1`.

### A publish warning that could not be reproduced, and was deliberately not chased

Both the `0.1.0` and `0.1.1` publish attempts printed
`"bin[agenttrace]" script name dist/bin.js was invalid and removed` as
an `npm warn`. Checked directly rather than assumed either way: the
actual registry manifest for both versions (`npm view
@agenttraceai/cli@<version> bin --json`) shows the correct
`{ "agenttrace": "dist/bin.js" }`, and a real `npm install` from the
live registry into a clean directory correctly creates the
`node_modules/.bin/agenttrace` symlink both times. Since the warning
appears even on a publish attempt that failed before any upload
completed (the `0.1.1` `EOTP` failure), it is a local, npm-CLI-side
message decoupled from what actually ends up on the registry, not
evidence of a real defect. Documented here plainly rather than quietly
dropped, since a warning that reliably fires but never seems to
reflect reality is worth a future engineer knowing about, without
spending more time chasing a cause that direct, repeated verification
against the real registry never substantiated.

### License: MIT

Neither package (nor the repository as a whole) declared a license
before this pass; npm's default for an unlicensed package is "all
rights reserved," almost certainly not the intent for something meant
to be publicly installed. Flagged rather than defaulted silently, since
it's a real choice for the project owner to make, not a technical
detail. The project owner chose MIT. A root `LICENSE` file was added,
copied into both `packages/sdk` and `packages/cli` (npm only packages
files that exist inside the publishing package's own directory, a root
monorepo `LICENSE` alone would not have been included in either
tarball), and both packages' `package.json` gained a `license: "MIT"`
field plus a `repository` field pointing at the real repository
(`github.com/nimra-syed/agenttrace`, confirmed against the actual git
remote, not a placeholder).

## Alternatives considered

- **A scope tied to the project owner's personal npm username**
  instead of a new organization. Rejected by the project owner's own
  choice: a project-branded org scope keeps the product identity
  separate from a personal account.
- **An unscoped name with a disambiguating suffix** (e.g.
  `agenttrace-observability-sdk`). Would have sidestepped scope-
  ownership uncertainty entirely, but the org route was chosen instead
  once the project owner confirmed they could actually create and
  verify `@agenttraceai`.
- **Publishing `packages/shared-types` as its own package**, keeping
  the three-package structure exactly mirrored between the workspace
  and the registry. Rejected: it's a second package to version and
  publish for a dependency that's purely type-only at runtime; bundling
  its types into `sdk`'s own declaration output gets the same external
  result (a fully self-contained SDK) with one published package
  instead of two.
- **Leaving `packages/sdk` as raw, unbundled TypeScript** and hoping
  external consumers bring their own transpilation. Rejected: the same
  reasoning M15 already established for why `packages/cli` needed a
  real build applies here, just discovered one package later than
  expected, since nothing had actually tried to publish `sdk` before now.

## Consequences

- Gain: a real, verified, collision-free npm scope the project owner
  actually controls, confirmed live against the registry rather than
  assumed.
- Gain: `packages/sdk` is genuinely publishable for the first time,
  with a self-contained declaration file and zero runtime dependencies,
  not just a renamed version of something that still wouldn't have
  worked for an external consumer.
- Gain: the cumulative blast radius of this rename was fully re-verified
  (typecheck, tests, and build across every workspace project), not
  assumed safe from the rename being "just a string replace."
- Gain: both packages are real, live, and installable by anyone today,
  verified end to end from completely clean external directories
  against the actual registry, not just local dry runs.
- Gain: a real `--help`/`-h` exit-code bug was found and fixed the same
  day it shipped, with tests that would have caught it, before it had a
  chance to become a silently-relied-upon quirk.
- Give up: `agenttrace init`'s own dedicated live, end-to-end
  verification against the newly-published package (the acceptance
  criteria in `docs/architecture/cli-init-design.md`) is still M17's
  remaining scope; this milestone verified the publish itself, not
  `init`'s own feature-level behavior against it.
