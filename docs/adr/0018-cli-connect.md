# ADR-0018: `@agenttrace/cli` and the real `connect` flow

Status: Accepted

## Context

M13 built the installation-credential backend (curl-verified). M14
built the browser-side approve page and the Connected Applications
panel (verified with a hand-built authorize URL standing in for a CLI
that didn't exist yet). M15 builds that CLI for real: `agenttrace
connect` genuinely opens a browser, runs a real loopback listener,
exchanges a real code for a real credential, writes it into a target
application's `.env`, and sends a real smoke trace, the same role
BeautyLab played for proving the SDK itself.

## Decision

### The first package in this monorepo that actually needs a build

`packages/sdk` and `packages/shared-types` ship raw TypeScript source
(`main` points straight at `./src/index.ts`) and are only ever consumed
by other packages that run through a TypeScript-aware tool (`tsx`,
`ts-jest`, NestJS's own build). `packages/cli` is different: it needs
to run standalone via `npx @agenttrace/cli connect` from inside a
completely separate application, on a machine with no TypeScript
tooling of its own. Bundled with esbuild (`esbuild src/bin.ts --bundle
--platform=node --format=cjs`), not plain `tsc`, so `@agenttrace/sdk`'s
and `@agenttrace/shared-types`'s raw source gets compiled and inlined
directly into `dist/bin.js` at build time, rather than left as a
`require()` a plain `node` process outside this monorepo could never
resolve. `open` (the one genuine external runtime dependency, see
below) is marked `--external`, so it stays a normal npm dependency
resolved the ordinary way, not duplicated into the bundle.

This was found live, not designed in from the start: the first attempt
built with plain `tsc`, and running the compiled output failed
immediately with `SyntaxError: Unexpected identifier` the moment it
tried to `require('@agenttrace/sdk')`, since Node's CommonJS loader
can't parse raw TypeScript. `@agenttrace/sdk`/`@agenttrace/shared-types`
moved from `dependencies` to `devDependencies` accordingly: the
published package doesn't need them at runtime at all once they're
bundled in.

### `agenttrace connect`, the loopback + PKCE flow

Mirrors the design doc's flow exactly: generates a PKCE verifier
(`randomBytes(32).toString('base64url')`) and challenge
(`createHash('sha256').update(verifier).digest('base64url')`, confirmed
against `apps/api/src/installations/pkce.util.ts`'s own algorithm, not
re-derived from the RFC alone) and a `state` value, starts a
`127.0.0.1`-only loopback server, opens the browser to `/cli/authorize`
with those plus a `redirect_uri` and an auto-derived `suggested_name`,
waits for the callback (bounded to 5 minutes), exchanges the code at
`/cli/token`, and writes the result into the target `.env`.

### Confirming the connection actually works, not just that the exchange succeeded

`AgentTraceClient.trace()` is deliberately fail-open (ADR-0009): it
warns and resolves successfully even when the underlying HTTP call
fails, which is exactly correct for instrumenting a real agent (nothing
about AgentTrace should ever break someone else's code) and exactly
wrong for a command whose entire job is reporting whether a connection
works. `connect`, `whoami`, and `test` all call the existing `GET
/api-keys/verify` endpoint first (confirmed, not assumed: `ApiKeyGuard`
already returns the same `apiKeyContext` shape for an
Installation-authenticated request as for an API key, so this endpoint
already works for the new credential type with zero backend changes).
That call's real HTTP status is what gates success or failure
reporting. The SDK's own `.trace()` call still runs afterward in
`connect`, demonstrating the actual SDK integration a real caller would
use, but its own fail-open behavior no longer determines whether the
CLI claims success.

### A real hang, found live, fixed with an explicit exit

The first fully-working live run completed every step correctly
(printed "Connected!" with a real project link) but the process never
returned control to the shell. Isolated by elimination, not guessed:
built a series of increasingly-targeted reproductions (the loopback
server plus `open()` plus several real `fetch` calls, each ruled out
individually) before confirming the SDK's own HTTP transport clears its
timeout in a `finally` block correctly and isn't the cause either. The
remaining, most likely explanation is Node's built-in `fetch` (undici)
keeping an idle keep-alive socket open past the point the CLI's actual
work is finished, ordinary, expected behavior for an HTTP client, not a
leak in this code. The fix: `bin.ts`'s `main()` now calls
`process.exit()` explicitly once a command's real work is done. This
is the correct, standard fix specifically for a CLI (never appropriate
for a long-running server, which should let its own handles manage
their own lifecycle). Confirmed the fix actually closes the gap by
rerunning the exact same live flow afterward and observing the process
exit on its own immediately.

### A real file-corruption bug, caught by its own test before shipping

`removeEnvValues`'s first version didn't strip the trailing empty
string `"KEEP=1\n".split("\n")` produces, so removing a key from a
file that had one left an extra blank line behind. Caught by
`env-file.spec.ts`'s own "is a no-op when the key is not present" test
comparing file contents byte-for-byte, not just checking the key was
gone, before this was ever pointed at a real `.env` file, exactly the
value of testing this piece of filesystem-integrity-sensitive logic
directly rather than trusting it by inspection.

### Two scope decisions, made explicitly before implementation

**`--project <id>` preselection is not implemented.** Making it
actually skip the picker would require the M14 authorize page to read
a new `project_id` query parameter, reaching back into `apps/web`'s
territory, which M14 already closed. The flag is genuinely optional per
the design doc's own wording; a small, well-understood addition
whenever wanted.

**`agenttrace disconnect` only revokes locally.** `DELETE
/projects/:projectId/installations/:installationId` (M13) is
session-authenticated, not Bearer-token-authenticated, so a CLI holding
only its own installation token has no endpoint that lets it revoke
itself server-side. `disconnect` does the real, safe thing it can do
unilaterally (remove the credential from `.env`) and says plainly that
full revocation still needs the dashboard's Connected Applications
panel. Building a self-revoke endpoint would pull this milestone back
into `apps/api`'s territory, which M13 already closed.

### One new runtime dependency: `open@^8`

Pinned to the last major published as CommonJS, avoiding a dynamic
`import()` against an ESM-only package for something not worth being
clever about. Cross-platform "open the default browser" correctness is
exactly the kind of already-solved, boring infrastructure this project
reaches for a library on rather than reinventing (the same reasoning
that already applies to `@nestjs/throttler` over a hand-rolled rate
limiter). Confirmed nothing already in the monorepo provides this
before adding it (every `package.json` and the lockfile checked; the
transitive `open`/`commander`/etc. under `@nestjs/cli` are pinned by
that tool, not something to quietly piggyback on).

No argument-parsing library either: four subcommands and three flags
total is small enough that a hand-rolled `process.argv` dispatch is
simpler than a dependency for it.

## A real credential leak during this milestone's own live verification, and how it was handled

While diagnosing the hang above, a real installation token appeared in
this session's own terminal output from a plain `cat .env` run for
debugging. Caught immediately, not after the fact: the token was never
reused for further testing, and both it and the separately-created
valid connection were revoked from the dashboard once verification
finished, following this project's own stated rule (never continue
using a credential that has appeared in command output, revoke and
replace it instead). Documented here plainly rather than left out of
the record, the same discipline this project applies to every other
real incident (the M11 CI bugs, the M12 quota exhaustion).

## Alternatives considered

- **Shipping `packages/cli` unbundled**, matching `sdk`/`shared-types`.
  Rejected once the actual failure mode was observed live: this package
  is fundamentally different from the other two, it has to run outside
  the monorepo with no TypeScript tooling available at all.
- **Relying on `AgentTraceClient.trace()` alone to report success.**
  Rejected: its fail-open design (correct for instrumenting a real
  agent) is exactly wrong for a command whose job is reporting whether
  the connection itself works.
- **Building a Bearer-token self-revoke endpoint so `disconnect` could
  fully revoke server-side.** Rejected for this milestone: it would
  expand M15 back into `apps/api`'s already-closed scope. A reasonable
  future addition, not built here.
- **A `--project` flag that actually preselects the project on the
  authorize page.** Rejected for the same reason: it needs an
  `apps/web` change M15 isn't scoped to make.

## Consequences

- Gain: a genuinely working, live-verified `agenttrace connect` that
  matches the design doc's nine-step UX exactly, with no raw secret
  ever manually typed or copied by the person running it.
- Gain: the CLI's own success/failure reporting is trustworthy,
  independent of the SDK's own by-design fail-open behavior.
- Gain: a real, reproducible pattern (bundle with esbuild, mark genuine
  runtime dependencies external) for any future package in this
  monorepo that similarly needs to run standalone outside it.
- Give up (accepted, documented, not fixed here): `agenttrace
  disconnect` cannot fully revoke a connection by itself; a person still
  needs the dashboard for that until a self-revoke endpoint exists.
- Give up: `--project` preselection isn't implemented; every `connect`
  run shows the project picker even if the caller already knows which
  project they want.
- Give up: `whoami`/`status` cannot show a project's human-readable
  name, only its id, since nothing exposes that to a non-session-
  authenticated caller today.
