# CLI `init`: SDK onboarding and scaffolding, design document

Status: Draft, pre-implementation. Same convention as the M13-M15
onboarding doc: this covers a milestone that hasn't started yet, and an
ADR gets written once it's actually built, not before.

## 1. Problem statement

M13-M15 solved credential handoff: `agenttrace connect` gets a real,
individually-revocable credential into a target app's `.env` with zero
manually-typed or copy-pasted secrets. What it doesn't solve is
everything after that: a developer still has to know to install
`@agenttraceai/sdk`, write the `AgentTraceClient` construction themselves,
remember the exact env var names, and figure out `trace()`/`span()`
usage from scratch. `connect` proves the credential works (it sends its
own smoke trace), but it doesn't leave the developer with anything to
build on. The goal for this milestone: `npx @agenttraceai/cli init` should
leave a developer with a working, connected SDK setup and a real example
to copy from, not just a credential.

## 2. Scope check: what this milestone is and isn't

Worth being precise about this before designing anything, since the
listed responsibilities in the original prompt could expand into
something much bigger than any prior milestone if taken literally:

- This is **not** a new authentication mechanism. Every credential-
  handling piece (PKCE, the loopback server, the token exchange,
  `.env` writing) already exists from M15 and gets reused, not rebuilt.
- This is **not** framework-aware code generation. `init` never inspects
  a project's actual application files to decide where to inject
  anything. It generates new, standalone files a developer chooses to
  use, and nothing else.
- This is **not** a general project scaffolder (no `package.json`
  creation, no build tooling setup). If a project has no `package.json`
  at all, `init` should say so and stop, not decide project metadata on
  someone else's behalf.
- This **is** a composition milestone: most of the value here comes
  from sequencing and packaging existing pieces (the connect flow, the
  smoke trace) with two genuinely new pieces (dependency installation,
  scaffold file generation) around them.

## 3. Overall architecture

### Extracting the reusable core of `connect`

`commands/connect.ts` today does seven things in one function: check for
an existing connection, derive a label, run PKCE/loopback/browser/
callback/exchange, verify the connection, write `.env`, send a smoke
trace, print a confirmation. `init` needs the middle part (label
derivation through the token exchange and verification) but wants to
sequence what happens before and after it differently. Recommendation:
extract that middle section into `lib/connect-flow.ts`, exporting one
function (illustrative signature):

```ts
export async function runConnectFlow(options: {
  label: string;
  dashboardUrl: string;
  apiUrl: string;
}): Promise<{ token: string; installationId: string; projectId: string }>
```

`commands/connect.ts` becomes a thin wrapper: check/prompt on `.env`
overwrite, derive the label, call `runConnectFlow`, write `.env`, send
the smoke trace, print the confirmation. `commands/init.ts` calls the
same `runConnectFlow`, but only when there isn't already a working
connection to reuse, and sequences its own dependency-install and
scaffold-generation steps around it. Two commands, one implementation of
the actual OAuth-shaped exchange, matching the existing project rule
that `hashToken` is shared for the same reason (not specific to one
feature).

### New pieces

- `lib/package-manager.ts`: detects which package manager a project
  uses (lockfile presence) and whether `@agenttraceai/sdk` is already a
  declared dependency, and can construct (not necessarily run without
  confirmation) the right install command.
- `lib/scaffold.ts`: detects the project's language (TypeScript vs
  JavaScript) and module system (ESM vs CommonJS), and generates the
  content for `agenttrace.ts`/`.js` and `agenttrace.example.ts`/`.js`.
- `commands/init.ts`: orchestrates all of it.

None of this touches `apps/api`, the dashboard, or `packages/sdk`
itself. It's additive, the same shape M13-M15's design doc used for its
own "none of this touches X" framing.

## 4. Command design

```
agenttrace init [--env-file <path>] [--name <label>] [--yes] [--force]
                [--dashboard-url <url>] [--api-url <url>]
```

- `--yes`: skips the upfront plan confirmation (section 6), for
  non-interactive/CI use. Does not skip the `.env`-overwrite prompt;
  that's what `--force` is for, matching `connect`'s existing meaning
  for that flag exactly, not a new one.
- `--force`: same meaning as in `connect` today (skip the `.env`
  overwrite confirmation). Does not force-overwrite scaffold files;
  see section 9 for why those use a different default.
- Every other flag matches `connect`'s existing meaning. No `--project`
  flag, same deferral reasoning as M15.

## 5. Step-by-step flow

1. Check for `package.json` in `process.cwd()`. Missing: print a clear
   message ("Run `npm init` first, then re-run `agenttrace init`.") and
   stop. `init` never creates one. This is a stricter precondition than
   `connect` needs today: `deriveLabel` already tolerates a missing
   `package.json` gracefully (falling back to the directory name), which
   is fine for `connect` since it never needs to write a dependency
   declaration anywhere. `init` does, so it needs a real `package.json`
   to exist before it can do anything.
2. Detect current state: is `@agenttraceai/sdk` already a declared
   dependency? Does `envFile` already have a working connection (same
   check `connect` already does, plus an actual `verifyConnection` call
   so a stale or revoked credential doesn't count as "already
   connected")? Do `agenttrace.ts`/`.example.ts` (or their `.js`
   equivalents) already exist?
3. Build a plan from what's actually missing, and print it (section 6).
   If nothing is missing, print "Already set up" with a short status
   line (project, connection label) and exit; this makes `init` a safe,
   fast no-op on a project that's already fully configured, effectively
   subsuming what a bare `whoami` would tell you.
4. On confirmation: install the SDK dependency if missing (section 7),
   run `runConnectFlow` if there's no existing working connection,
   write `.env` (reusing `connect`'s existing overwrite-check if a
   stale, non-working entry is there), generate whichever scaffold
   files don't already exist (section 9), send one smoke trace, print
   next steps and offer to open the dashboard (section 10).

## 6. The confirmation UX

One upfront summary, built from the actual detected state, not a static
list. If the SDK is already installed and a connection already works,
those lines don't appear at all; showing a step `init` isn't actually
going to take would be its own small trust problem the first time
someone notices the mismatch. Example, partially-set-up case:

```
AgentTrace will:
  Generate agenttrace.ts
  Generate agenttrace.example.ts
  Send a smoke trace

@agenttraceai/sdk is already installed.
Already connected to project "BeautyLab".

Continue? (Y/n)
```

Fully-fresh-project case matches the example in the request exactly.
After this single confirmation, no further prompts happen except the
`.env`-overwrite case inherited from `connect` (only relevant if
`envFile` has a stale, non-verifying entry, an edge case, not the common
path), and the final open-the-dashboard offer (section 10). This
directly answers the one open question from the original ask: prompting
per-action would mean up to four separate y/N prompts in the
fresh-project case, which is worse than the "review once" model already
used for the confirmation step itself.

### A real gap, found on review: non-interactive runs can hang today

`connect`'s existing `.env`-overwrite prompt has no guard against
running with no interactive terminal attached. If `.env` already has a
connection and someone runs `connect` in a script without `--force`,
`rl.question()` waits on stdin forever, since nothing ever answers it.
This is real, already-shipped behavior in M15, not something `init`
introduces, but `init` makes it more likely to matter: it adds two more
prompts (the upfront plan, the final open-dashboard offer in section
10), tripling the number of places a CI or scripted run could hang
instead of failing loudly.

Fixed as part of this milestone, since `init` touches the same prompt
code path anyway: every prompt (the upfront confirmation, the inherited
`.env`-overwrite check, the final open-dashboard offer) first checks
`process.stdin.isTTY`. If it's not a real interactive terminal and the
relevant skip flag (`--yes` for the plan, `--force` for `.env`) wasn't
passed, `init` (and `connect`, for the prompt it already has) fails
immediately with a clear message ("Not running in an interactive
terminal; pass --yes to confirm non-interactively.") instead of
hanging. The final open-dashboard offer defaults to "don't open" under
`--yes` or a non-TTY stdin either way, since auto-opening a browser
during a CI run would be actively wrong, not just unnecessary.

## 7. Package manager detection and dependency installation

Detected from lockfile presence in `process.cwd()` (not walking up
parent directories, a deliberate, documented scope limit matching
`label.ts`'s own cwd-only precedent): `pnpm-lock.yaml` -> pnpm,
`yarn.lock` -> yarn, `package-lock.json` -> npm, none found -> npm
(npm's own default when nothing else is present). "Already installed"
is checked by reading `package.json`'s own `dependencies`/
`devDependencies` directly, not by checking `node_modules` (which can be
stale, hoisted from somewhere unrelated in a monorepo, or simply
missing after a fresh clone even though the declaration is correct).

The install command is shown as part of the upfront plan (section 6),
never run silently. This is a real side effect (network access,
potential postinstall scripts) and gets the same "show exactly what
will happen, then one confirmation" treatment as everything else, not a
separate prompt of its own, per the revised confirmation UX above.

**If the install command fails** (network error, registry unreachable,
nonzero exit), `init` stops the whole flow right there and surfaces the
package manager's own error output directly, rather than continuing on
to the connect step as though the dependency were actually present.
Silently pressing on after a failed install would leave a project in a
worse state than before `init` ran (a `.env` and scaffold files
referencing a package that was never actually installed).

**If a later step fails** (most likely: the browser approval step
timing out or being abandoned), the dependency installation from an
earlier, successful step is left in place. This is deliberate, not an
oversight: an installed-but-unused dependency is harmless, and
re-running `init` afterward will detect it's already declared, skip
reinstalling, and simply retry whichever step actually failed. No
rollback or transactional all-or-nothing behavior is needed given the
skip-what's-already-done idempotency rules in section 9.

Known, accepted limitation: this only handles a single-package-root
project. A pnpm/yarn workspace where `init` is run from a sub-package
directory should work fine (the install command runs from `cwd`, the
same directory the lockfile detection already read), but `init` doesn't
attempt anything workspace-root-aware beyond that. Worth revisiting only
if it's an actual reported problem, not preemptively.

## 8. Scaffold file generation

Two files, illustrative content:

Both files are written at the project root, next to `.env`, never
guessed into a `src/` or other conventional source directory. This
matches section 2's "never infer project structure" principle: a
root-level file is the one location `init` can place something without
having to guess how a given project organizes its own source.

**`agenttrace.ts`** (or `.js`, see below): constructs and exports one
configured `AgentTraceClient`, reading the two env vars `connect`
already writes. Nothing else. This is the one file a real project would
actually import from.

```ts
import { AgentTraceClient } from "@agenttraceai/sdk";

export const agenttrace = new AgentTraceClient({
  apiKey: process.env.AGENTTRACE_API_KEY!,
  baseUrl: process.env.AGENTTRACE_BASE_URL,
});
```

**`agenttrace.example.ts`** (or `.js`): a standalone, runnable example
showing `trace()`/`span()` usage, explicitly a copy-from reference, not
something imported by the generated `agenttrace.ts` itself or anything
else. Its own file, clearly named, so it's obvious it's disposable.

**Language and module-system detection**: TypeScript if a `tsconfig.json`
exists in `cwd`, else JavaScript. Module system from `package.json`'s
own `"type"` field: `"module"` means real ESM `import`/`export`
syntax in the generated `.js` file, anything else (including absent)
means CommonJS `require`/`module.exports`. This is the same TS/ESM/CJS
duality already documented as real, live tech debt for `packages/sdk`
itself (`CLAUDE.md`'s Known Technical Debt section); detecting it
correctly here matters for the exact same reason it already mattered
there; getting it wrong would hand a brand-new developer a file that
doesn't run.

## 9. Idempotency rules

- **Re-running `init` on an already-fully-set-up project**: a fast
  no-op that reports current status and changes nothing (step 3 above).
- **Scaffold files use skip-by-default, not overwrite-by-default.** If
  `agenttrace.ts` already exists, `init` leaves it alone and prints one
  line noting it was skipped; it does not prompt to overwrite. This is
  a deliberate difference from `.env`'s overwrite-and-ask pattern:
  `.env` might hold a *stale but still meaningful* credential worth
  asking about, but an existing scaffold file, by definition, means
  `init` (or a person) already made whatever choice was in it, and
  silently regenerating it on every run risks clobbering something a
  developer has since edited and started relying on. `--force` can
  still force-regenerate both scaffold files explicitly, for someone
  who genuinely wants a clean reset.
- **Dependency installation**: skipped entirely if already declared,
  never re-run "just in case," matching the same reasoning.
- **Connection reuse**: an existing `.env` entry is trusted only if it
  actually verifies (a real `verifyConnection` call, not just
  "the keys are present"), so a revoked or corrupted credential doesn't
  silently count as "already connected" and get skipped.

## 10. Ending the flow: the smoke trace and the dashboard link

`init` sends one real smoke trace, using an `AgentTraceClient`
constructed directly inside `init.ts`, the exact same way `connect.ts`
does today, not by dynamically loading the scaffold file `init` just
generated. Requiring or importing a freshly-written TypeScript file at
runtime would need a transpiler the CLI has no other reason to carry;
constructing the client directly (`init.ts` already has the SDK in
scope, same as `connect.ts`) avoids that entirely and keeps the smoke
trace's own reliability independent of whether the generated file even
parses correctly.

The original ask included "offer to open the dashboard to the latest
trace." Checked directly before designing around it, not assumed: the
trace detail page (`GET /projects/:projectId/traces/:traceId`, M8) is
keyed on the trace's **internal** database id, but the SDK's public
`client.trace()` method returns only whatever the wrapped callback
returns (`Promise<T>`), never the created trace's server-side id. The
id does exist inside the SDK's own HTTP layer (`trace-context.ts`
captures it internally as `traceServerId`), it just isn't exposed
through the public API today. Getting a deep link to that *exact* trace
would need a small, deliberate SDK addition (surfacing the created
trace's id back through `trace()` or the `TraceContext` object), which
is a real, if small, change to `packages/sdk`'s public surface, not
something achievable by the CLI alone.

**Recommendation: don't make that SDK change for this milestone.** Link
to the project's runs list instead (`${dashboardUrl}/projects/${projectId}/runs`),
exactly what `connect` already does. Since that list is already sorted
newest-first (`startedAt DESC, id DESC`, per M7/CLAUDE.md), the smoke
trace `init` just sent will be the first thing the developer sees
without any deep link at all. This gets the actual goal (developer
opens the dashboard, immediately sees something real) with zero SDK
changes, deferring the exact-trace deep link as a documented future
enhancement rather than pulling an SDK change into a CLI-only milestone.

After printing the link, `init` asks one final y/N ("Open the dashboard
now?") and calls the same `open()` dependency `connect` already uses if
confirmed. This is the one prompt that happens after the main
confirmation, since it's a low-stakes, easily-reversible action (opening
a browser tab) rather than something with a lasting side effect.

## 11. What this explicitly does not do

- Never edits an existing application file. Only ever writes new files
  that didn't exist before, or (with `--force`) regenerates its own
  previously-generated scaffold files.
- Never claims a scaffold file is actually wired into the developer's
  running application. `init` can verify the credential works and the
  files exist; it cannot and does not try to verify that a developer has
  imported and used them anywhere, which would require static analysis
  of arbitrary application code.
- Never creates a `package.json`, chooses a package manager the project
  hasn't already signaled a preference for (via a lockfile), or runs any
  build/dev command.
- Never installs a dependency, writes `.env`, or overwrites a scaffold
  file without the relevant confirmation.

## 12. SDK and backend implications

None required for the scope recommended above (section 10). If the
exact-trace deep link is ever wanted badly enough to justify it, the
smallest version would be exposing the created trace's id through
`TraceContext` (already computed internally, just not surfaced), a
narrow, backward-compatible addition, not a redesign.

## 13. Alternatives considered

- **Prompting separately before each side-effecting action** (install,
  connect, each file, the smoke trace). Rejected per the direction
  agreed on: one upfront plan and one confirmation reads better and is
  just as honest, provided the plan is generated from real detected
  state rather than shown unconditionally.
- **Overwriting scaffold files by default, matching `.env`'s pattern.**
  Rejected: a scaffold file, unlike `.env`, is something a developer is
  expected to open and start editing; regenerating it silently on a
  second `init` run risks real, silent data loss of someone's own
  changes. Skip-by-default with an explicit `--force` for a clean reset
  is the safer default.
- **Making the exact-trace deep link work by adding the small SDK
  change now.** Rejected for this milestone: it's a reasonable future
  addition, but pulling an SDK-surface change into what's otherwise a
  CLI-only milestone blurs the scope boundary this project has kept
  clean across M13 (backend-only), M14 (dashboard-only), and M15
  (CLI-only). The runs-list link achieves the same practical goal today.
- **Walking up parent directories to find the "real" project root**
  (for lockfile detection, `package.json` discovery) instead of only
  checking `cwd`. Rejected for now: adds real complexity (which
  directory is authoritative in a monorepo?) for a case not yet known to
  be a real problem; `cwd`-only matches `label.ts`'s already-shipped
  precedent.

## 14. Recommendation and acceptance criteria

Build `agenttrace init` as described: a composition of the extracted
connect-flow core plus two new pieces (package-manager detection/
install, scaffold generation), one dynamically-built upfront
confirmation, skip-by-default scaffold idempotency, and a runs-list
dashboard link rather than an SDK change for the exact-trace deep link.

**Acceptance criteria**: run against two real, separate throwaway
projects (one plain JavaScript/CommonJS, one TypeScript), each starting
from nothing (`package.json` only, no `@agenttraceai/sdk`, no `.env`).
`init` installs the dependency, connects for real (same browser-approval
flow as `connect`), generates the two scaffold files in the correct
language/module format for each project, sends a real smoke trace
visible in the dashboard, and offers to open it. Re-running `init`
immediately afterward on either project reports "already set up" and
changes nothing. Colocated unit tests for `package-manager.ts` (lockfile
detection, already-declared-dependency detection) and `scaffold.ts`
(language/module-system detection, content generation for all four
combinations), plus tests confirming `runConnectFlow`'s extraction
didn't change `connect`'s own existing behavior. Also verify the
non-TTY guard directly: running `init` (and `connect`) with stdin
piped from `/dev/null` and no `--yes`/`--force` fails fast with the
clear message, rather than hanging, for every prompt each command has.

## 15. Future extensibility (not yet scoped into this milestone)

- The small SDK addition to surface a created trace's server-side id,
  enabling an exact-trace deep link instead of the runs-list link.
- Framework-aware *example* content (tailoring `agenttrace.example.ts`'s
  sample code based on detected dependencies like `express`/`next`),
  never touching real application files, an extension of the same
  no-code-mod principle, not a departure from it.
- Walking up parent directories for monorepo-root-aware detection, if a
  real project structure ever makes the `cwd`-only assumption a genuine
  problem.
- A `--dry-run` flag printing the plan without executing any of it,
  useful both for cautious developers and for inspecting behavior in CI
  before trusting `--yes`.
