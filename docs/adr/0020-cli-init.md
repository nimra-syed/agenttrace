# ADR-0020: `agenttrace init`, SDK onboarding and scaffolding

Status: Accepted

## Context

M13-M15 solved credential handoff (`agenttrace connect`). M16
(ADR-0019) made the SDK and CLI genuinely publishable. Neither solved
the actual gap `docs/architecture/cli-init-design.md` identified: a
developer still had to know to install the SDK, write the client
construction themselves, and figure out `trace()`/`span()` usage from
scratch. This milestone builds `agenttrace init`, composing the
connect flow and smoke trace M13-M15 already built with two new
pieces (dependency installation, scaffold generation), so a developer
ends up with a working, connected SDK setup and a real example to copy
from, not just a credential.

The implementation itself (`commands/init.ts`, `lib/package-manager.ts`,
`lib/scaffold.ts`, `lib/connect-flow.ts` extracted out of
`commands/connect.ts`, `lib/prompt.ts`'s TTY-guarded confirmations) was
built and unit-tested during the same working session as M16's rename,
before M16's own npm-scope collision was discovered. It shipped inside
`@agenttraceai/cli@0.1.1` without having gone through its own dedicated
live, end-to-end verification yet. This ADR covers that verification,
the real bugs it found, and the fixes.

## Decision

### The design, as built

Matches `cli-init-design.md`'s recommendation closely: `init` detects
what's actually missing (the SDK dependency, a working connection,
either scaffold file) and shows one upfront plan built from that real
detected state, not a static list. Scaffold files skip-by-default if
they already exist (`--force` to regenerate). The exact-trace deep
link was deliberately not built (would have required a small SDK
change); `init` links to the project's runs list instead, which is
already sorted newest-first, so the smoke trace lands at the top
regardless.

### A real bug found in live verification, not by any test up to that point

Running the CLI's own advertised next step ("run `node
agenttrace.example.js` to try it now") against a real, freshly
generated project crashed:

```
TypeError: Cannot read properties of undefined (reading 'replace')
    at new HttpTransport (.../dist/index.js:50:36)
```

Plain `node` never loads `.env` on its own; that's a framework
convenience (Next.js, etc.), not Node behavior. The generated
`agenttrace.js` read `process.env.AGENTTRACE_API_KEY`/
`AGENTTRACE_BASE_URL` directly, both `undefined` unless something else
had already loaded `.env`. `apps/reference-agent` already depends on
`dotenv` for exactly this reason; the scaffold generator never did the
same. Fixed by having the generated `agenttrace.ts`/`.js` call
`dotenv.config()` itself before constructing the client, and having
`init` install `dotenv` alongside the SDK whenever either is missing
(`buildInstallCommand` generalized to accept multiple package names, so
both install in one network round-trip, not two).

### A second real bug, found by the new tests written to catch the first one

Writing a real execution test for the generated ESM scaffold (not a
string-content assertion, an actual `node` process running the
generated file) surfaced a second, unrelated bug: the example file's
relative import (`import { agenttrace } from "./agenttrace";`) has no
file extension, which TypeScript's own resolution tolerates but real
Node ESM resolution does not (`ERR_MODULE_NOT_FOUND`). Fixed by adding
the explicit `.js` extension for the ESM case only, matching Node's
actual rule (`require()` alone tries multiple extensions
automatically; `import` does not). Found before any user could hit it,
specifically because the new tests exercise real execution rather than
checking that generated content merely contains an expected substring.

### The SDK itself now fails loud instead of crashing confusingly

`AgentTraceClient`'s constructor now validates `apiKey`/`baseUrl`
before constructing `HttpTransport`, throwing a clear, actionable error
("`apiKey` is required but was empty or missing...") instead of
reaching `.replace()` on `undefined` three calls deep. Both fields are
already required by the type (`AgentTraceClientOptions`), but a caller
building `options` from `process.env` (exactly what the generated
scaffold does) can still end up with `undefined` at runtime despite
what the type claims; this is the actual safety net for that case, not
just belt-and-suspenders. Shipped as `@agenttraceai/sdk@0.1.1`.

### Real execution tests, not just content assertions, for the generated scaffold

`scaffold-runtime.spec.ts` is deliberately heavier than this package's
usual pure-unit tests: it writes the generated content into a temp
directory nested inside `packages/cli` itself (so module resolution
reaches the real, workspace-linked `@agenttraceai/sdk` and `dotenv`,
not a mock), then actually runs a real `tsc --noEmit` against the
TypeScript variant and a real `node` process against both JavaScript
variants (CJS and ESM), with a real `.env` file (not env vars passed
directly to the child process, which would have masked the actual
`dotenv`-loading bug this exists to catch) pointing at a deliberately
unreachable dummy address, exercising the SDK's real fail-open
behavior (ADR-0009) rather than a mocked one. Both real bugs above were
caught by these tests during this same milestone, one of them by the
test written specifically to catch the other.

### Re-verified end to end from clean directories, using the fix

After both fixes, `init` was run again from two brand-new throwaway
directories (a plain JavaScript/CommonJS project and a TypeScript
project), each starting from nothing, against a real backend, with a
real browser approval. Both real smoke traces and, this time, both
real example-file runs succeeded, confirmed directly in the dashboard.
Re-running `init` immediately afterward on both reported "Already set
up" and changed nothing, confirming the idempotency contract.

## Alternatives considered

- **Passing dummy environment variables directly to the test's child
  process instead of writing a real `.env` file.** Rejected: this
  would have made the runtime tests pass even with the original
  `dotenv`-loading bug still present, since the variables would already
  be in `process.env` regardless of whether the generated file loaded
  `.env` itself. The whole point of these tests is to catch that
  exact class of bug, so they have to reproduce the real mechanism.
- **Validating `apiKey`/`baseUrl` inside `HttpTransport` instead of
  `AgentTraceClient`.** Rejected: `HttpTransport` isn't exported from
  `packages/sdk`'s public surface; `AgentTraceClient` is the only real
  entry point a caller has, so that's where a clear error actually
  reaches them.
- **Skipping the dotenv install and just documenting that a project
  needs its own `.env` loading mechanism.** Rejected: the CLI's own
  next-steps text explicitly tells a developer to run the generated
  example directly; documenting around a crash in the CLI's own
  advertised happy path isn't a real fix.

## Consequences

- Gain: `agenttrace init` now actually delivers what it advertises,
  the generated example runs successfully, verified for real, not
  assumed from unit tests that only checked generated content strings.
- Gain: a class of bug (generated code that reads correctly but fails
  the moment someone actually runs it) now has real test coverage,
  not just this one instance of it.
- Gain: any future misconfigured `AgentTraceClient` construction now
  fails immediately and clearly, not three function calls deep with a
  message pointing at the wrong line.
- Give up: `packages/cli@0.1.2` and `packages/sdk@0.1.1` are built,
  tested, and locally verified but not yet published, at the project
  owner's explicit request, pending their own review.
