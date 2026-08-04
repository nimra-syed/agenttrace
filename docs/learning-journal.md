# Learning Journal

## M17 — Making `agenttrace init` actually work (2026-08-04)

### What I built

- Live, end-to-end verification of `agenttrace init` (implemented
  earlier in the same working session as M16, but never run for real
  against a fresh project until this milestone), against two brand-new
  throwaway directories, one plain JavaScript/CommonJS, one TypeScript.
- Two real fixes found during that verification: the generated
  `agenttrace.ts`/`.js` now loads `.env` itself via `dotenv` before
  constructing the client, and `init` installs `dotenv` alongside the
  SDK; the generated ESM example's relative import now has the
  explicit `.js` extension real Node ESM resolution requires.
- A new constructor validation in `AgentTraceClient` (`packages/sdk`)
  that throws a clear, actionable error when `apiKey`/`baseUrl` are
  missing, instead of crashing three calls deep inside `HttpTransport`.
- A new, deliberately heavier test file (`scaffold-runtime.spec.ts`)
  that actually runs generated scaffold content through a real `tsc`
  and a real `node`, not just checking that the generated string
  contains an expected substring.

### What I learned

- A generated file can pass every test I'd written for it (correct
  file name, correct imports present, correct exported shape) and still
  be completely broken the moment a real person actually runs it,
  if none of those tests ever actually execute the thing. String-content
  assertions and real execution are testing two different claims, and
  I'd only been making the first one.
- Plain `node` does not load `.env` files. I knew this abstractly, but
  didn't connect it to my own generated scaffold until watching it
  crash for a reason that had nothing to do with the actual connection,
  credentials, or SDK logic, just an environment variable that was
  never populated in the first place.
- TypeScript's own module resolution and Node's real ESM module
  resolution are not the same thing, even for the exact same import
  statement. Code that typechecks cleanly can still fail at runtime for
  a reason TypeScript never had any way to catch, because the rule
  being violated (explicit file extensions on relative ESM imports) is
  Node's, not TypeScript's.
- Writing a test specifically to catch one bug can catch a second,
  completely unrelated one, if the test is built around actually doing
  the real thing rather than checking a narrow property of it. The ESM
  extension bug was never on my radar; it surfaced because the new test
  ran real code instead of inspecting a string.

### Decisions made

- ADR-0020: fixing `agenttrace init`'s real bugs as their own
  same-day-adjacent milestone rather than silently folding them into
  M16's already-large rename; validating in `AgentTraceClient` rather
  than the unexported `HttpTransport`; writing genuinely heavier
  execution tests for generated scaffold content instead of adding more
  string assertions to the existing fast unit tests; holding both
  `0.1.2`/`0.1.1` publishes for the project owner's own review rather
  than publishing immediately once verification passed.

### Problems encountered and how we resolved them

- `node agenttrace.example.js`, exactly the command the CLI itself
  prints as the next step, crashed with a `TypeError` inside the SDK's
  own `HttpTransport` constructor. Traced to `baseUrl` being
  `undefined`, which traced further back to `.env` never actually being
  loaded into `process.env` by plain `node`. Fixed by having the
  generated client file load it itself via `dotenv`, matching
  `apps/reference-agent`'s own existing, already-established pattern
  instead of inventing a new one.
- The new runtime test for the ESM scaffold variant failed immediately
  with a real `ERR_MODULE_NOT_FOUND`, a bug I hadn't gone looking for.
  Fixed by adding the `.js` extension Node's ESM resolution actually
  requires for relative imports, verified by rerunning the exact same
  test afterward and watching it pass.
- After both fixes, re-ran the entire flow again from scratch (new
  throwaway directories, a new browser approval, both scaffold formats)
  rather than trusting the unit tests alone, and confirmed the real
  generated example files actually run successfully this time,
  visible as real, successful traces in the dashboard.

### Interview questions I should be able to answer

- Why can a test suite pass completely and the feature it's testing
  still be broken for a real user? Walk through exactly how that
  happened here.
- What's the actual difference between TypeScript's module resolution
  and Node's runtime ESM resolution, and why did one catch a bug the
  other couldn't?
- Why does plain `node` not load `.env` files, and what's actually
  loading them in frameworks where it seems to "just work"?
- Why validate `apiKey`/`baseUrl` inside `AgentTraceClient` specifically,
  and not deeper in the call stack where the actual crash happened?
- If you had shipped `0.1.1` without this verification and a real user
  hit this crash, how would you have diagnosed it from their bug report
  alone?

### Common mistakes engineers make here

- Treating "the generated file has the right content" and "the
  generated file works when you run it" as the same claim, when only
  a test that actually executes the file can verify the second one.
- Assuming a Node.js script has access to `.env` values just because a
  `.env` file exists in the same directory, without checking whether
  anything actually loads it.
- Assuming TypeScript's type-checker enforces every rule a piece of
  code needs to follow at runtime, instead of recognizing that some
  rules (module resolution among them) belong to the runtime, not the
  type system.
- Writing a fix for a reported bug and calling it done, without asking
  whether a new test built to catch that exact bug might also catch
  something else nearby if it's built to exercise the real thing rather
  than a narrow symptom of it.

### How this milestone improves my resume

"Found that a fully-passing test suite still shipped a feature that
crashed on first real use, root-caused it to the gap between checking
generated content and executing it, and closed that gap by writing
tests that run real code in a real environment rather than adding more
string assertions, catching a second, unrelated bug in the same pass"
is a specific, verifiable claim about testing judgment, not just "wrote
tests."

## M16 — Publishing the SDK and CLI to npm as @agenttraceai (2026-08-04)

### What I built

- A rename of three packages from the `@agenttrace` scope (which turned
  out to belong to an unrelated organization) to `@agenttraceai`, a new
  npm organization confirmed live to be actually available and owned by
  me, applied consistently across every functional reference in the
  monorepo, roughly 15 files.
- A real build for `packages/sdk` for the first time: esbuild for a
  dependency-free runtime bundle, `dts-bundle-generator` to inline
  `packages/shared-types`' type definitions into one self-contained
  declaration file, so the published SDK never needs that package
  published separately.
- A root `LICENSE` (MIT), copied into both publishable packages, plus
  real `license`/`repository` metadata.
- The actual, real, public npm publish of `@agenttraceai/sdk@0.1.0` and
  `@agenttraceai/cli@0.1.1` (a patch released the same day, for a real
  bug found during the CLI's own publish verification), each verified
  end to end from a completely clean external directory against the
  live registry, not just locally.

### What I learned

- An assumption made at one milestone can quietly become load-bearing
  for a later one without anyone re-checking it. M15 assumed
  `@agenttrace` was this project's own scope; nothing forced that
  assumption to be tested until M17's own live verification actually
  tried to install the real package and got someone else's code back.
  The lesson isn't "check every assumption forever," it's noticing which
  assumptions a later milestone is quietly relying on being still true.
- `npm whoami` succeeding is not the same fact as "this session can
  publish." Both a fresh login and a long-standing one can still hit a
  `403` requiring a separate, browser-based one-time-password step for
  the actual publish action, specifically for 2FA-enabled accounts.
  Worth knowing before assuming a login step alone clears the way.
- A locally-printed npm warning is not proof of what actually happened
  on the registry. `"bin[agenttrace]" script name ... was invalid and
  removed` printed on every single publish attempt, including one that
  failed with `EOTP` before any upload completed, yet the real,
  live registry manifest had the correct `bin` field every time I
  checked it directly. The warning fires locally, unconditionally,
  seemingly disconnected from the actual result; trusting the real,
  externally-verified outcome over a locally-printed message turned out
  to matter here.
- Type-only imports (`import type`) are erased entirely during
  compilation, which means a package can depend on another purely for
  types without ever needing that dependency resolvable at runtime.
  That's exactly why `packages/sdk`'s runtime bundle never needed
  `packages/shared-types` published at all; only the declaration output
  did, and only because `tsc` doesn't inline cross-package type
  references on its own.

### Decisions made

- ADR-0019: the `@agenttraceai` scope; renaming `shared-types` too for
  internal consistency even though it's never published; bundling
  shared-types' definitions into `sdk`'s own declaration output with
  `dts-bundle-generator` instead of publishing a second package; MIT as
  the license; the exact publish order and gating the project owner
  specified (SDK published and verified live before the CLI); fixing
  the `--help`/`-h` exit-code bug as its own same-day patch rather than
  folding it into the rename itself.

### Problems encountered and how we resolved them

- A live `npm install` of the assumed `@agenttrace/sdk` package name
  succeeded, but resolved to a real, unrelated package under a
  different GitHub account. Found by reading the installed
  `package.json` directly instead of trusting a successful exit code;
  led to checking the unscoped fallback names too, both of which turned
  out to already be taken by yet other unrelated projects.
- The first `npm publish` attempt for `@agenttraceai/sdk` returned a
  `403` requiring 2FA, even with a valid, freshly-verified login
  session. Resolved by the project owner completing the browser-based
  OTP step directly; I never attempted to handle that step myself, per
  this project's own credential-handling rule.
- After the CLI's first publish, `--help`/`-h` were found to exit `1`
  instead of `0`, despite printing correct usage text. Fixed with an
  exported, pure `usageExitCode()` function and 4 new tests, verified
  against a real packed tarball in a clean directory before the
  `0.1.1` publish, then again against the live registry package after.
- A `bin[agenttrace] ... was invalid and removed` warning appeared on
  every publish attempt, including a failed one. Rather than assume it
  meant the published package was broken, checked the actual registry
  manifest directly both times; it was correct both times. Concluded
  the warning doesn't reliably reflect the real outcome and stopped
  chasing it once direct, repeated, live verification contradicted it.

### Interview questions I should be able to answer

- Walk through exactly how you discovered the npm scope collision, and
  why a successful `npm install` didn't already tell you something was
  wrong.
- Why does `import type` matter for whether a package needs its
  dependency published separately, and how does that interact with a
  declaration-file bundler versus a plain `tsc` build?
- What's the actual difference between being logged into npm and being
  able to publish, and why did that only show up at publish time, not
  login time?
- Why trust a live registry check over a locally-printed CLI warning,
  and what would have to be true for that judgment call to be wrong?
- What would you do differently if this collision had been discovered
  after `agenttrace init` was already in wide use, instead of during
  its own pre-release verification?

### Common mistakes engineers make here

- Assuming a scope, package name, or organization is available without
  checking it live against the actual registry, especially when the
  name is generic or obvious enough that others may have already
  reached for it.
- Treating a successful command (a `npm install` that exits 0, an
  `npm whoami` that returns a username) as proof of the specific thing
  you actually care about, instead of the narrower thing it actually
  confirmed.
- Reacting to every CLI warning as if it's ground truth, instead of
  checking the actual, externally-verifiable outcome when the two
  seem to disagree.
- Publishing a package with no license declared, leaving it at npm's
  default of "all rights reserved" by accident rather than by choice.

### How this milestone improves my resume

"Discovered a real npm namespace collision during pre-release
verification (not after a real user hit it), migrated three packages
to a new, verified-available scope with a full re-verification of the
entire blast radius, added a real build step and self-contained type
bundling for a package that had never needed one before, and shipped a
same-day patch release for a bug found during the package's own
publish verification" is a specific, verifiable claim about release
engineering discipline, not just "published a package to npm."

## M15 — `@agenttrace/cli` and the real connect flow (2026-08-02)

### What I built

- `packages/cli` (`@agenttrace/cli`), a real, standalone CLI: `connect`
  (opens a browser, runs a real loopback listener, exchanges a real
  authorization code plus PKCE verifier for a credential, writes it
  into a target app's `.env`, sends a real smoke trace), `whoami`/
  `status`, `disconnect` (local-only), and `test`.
- A real build step, the first in this monorepo: esbuild bundles
  `src/bin.ts` into a single `dist/bin.js`, inlining
  `@agenttrace/sdk`/`@agenttrace/shared-types`'s raw TypeScript source
  directly, plus a separate `tsc --emitDeclarationOnly` pass for types.
- A hand-rolled `.env` editor (`env-file.ts`) that updates or appends
  specific keys without disturbing comments, blank lines, or unrelated
  keys, and preserves the file's own line-ending style.
- 28 colocated Jest unit tests across `pkce.ts`, `label.ts`, and
  `env-file.ts`, plus a genuinely live, end-to-end manual verification:
  running the built CLI against a real throwaway application directory,
  approving in a real browser with a throwaway test account, and
  confirming the resulting trace and Connected Application in Postgres.

### What I learned

- A package meant to run standalone outside the monorepo (via `npx` or
  a plain `node` invocation) cannot share `packages/sdk`'s and
  `packages/shared-types`' "ship raw TypeScript" convention. Those two
  packages only ever get consumed by something already running through
  a TypeScript-aware tool; `packages/cli` doesn't have that luxury once
  it leaves this repo, confirmed the hard way when a plain-`tsc`-built
  version failed immediately trying to `require()` one of them.
- `AgentTraceClient.trace()`'s fail-open design (ADR-0009) is a design
  decision made for a specific consumer, not a universal default: it is
  exactly correct for instrumenting someone else's agent, and exactly
  wrong for a CLI command whose entire job is telling the truth about
  whether a connection works. The same code can be the right choice in
  one caller and the wrong choice in another; what matters is checking
  which one you're actually building for, not treating "this is how the
  SDK behaves" as settled everywhere it gets used.
- A process that appears to finish all its real work can still hang
  indefinitely because of something entirely outside your own code
  (an idle keep-alive socket Node's built-in `fetch` leaves open). The
  useful debugging move wasn't guessing at the cause, it was building a
  series of small, targeted reproduction scripts that each ruled out one
  candidate (the loopback server, `open()`, the SDK's own transport)
  until only one plausible explanation was left.
- Testing filesystem-mutation logic (`.env` editing) by comparing exact
  file contents byte-for-byte, not just checking a key's value with a
  substring match, is what actually catches a bug like a stray blank
  line or a mixed line-ending file. A substring check would have passed
  on both of this milestone's real bugs.

### Decisions made

- ADR-0018: bundling `packages/cli` with esbuild rather than plain
  `tsc`; gating `connect`/`whoami`/`test`'s success reporting on a real
  `GET /api-keys/verify` call rather than the SDK's own fail-open
  `.trace()` result; an explicit `process.exit()` in `bin.ts` as the
  correct, CLI-specific fix for the hang; deferring `--project`
  preselection and a Bearer-token self-revoke endpoint as accepted,
  explicitly out-of-scope gaps rather than building either into this
  milestone.
- Prompting before overwriting an existing `.env`'s
  `AGENTTRACE_API_KEY`/`AGENTTRACE_BASE_URL` (with `--force` to skip),
  a UX correction requested before implementation began.

### Problems encountered and how we resolved them

- A first, plain-`tsc`-built version of the CLI failed at runtime with
  `SyntaxError: Unexpected identifier` the moment it tried to
  `require('@agenttrace/sdk')`. Fixed by switching the build to esbuild
  bundling and moving the two workspace packages from `dependencies` to
  `devDependencies`, since the published CLI no longer needs them at
  runtime once they're inlined.
- The first fully-successful live run printed a correct "Connected!"
  message but never returned control to the shell. Diagnosed by
  elimination, not assumption: built and ran a series of increasingly
  targeted reproduction scripts, ruling out the loopback server,
  `open()`, and the SDK's own (correctly `clearTimeout`'d) HTTP
  transport individually, before concluding the remaining explanation
  was Node's built-in fetch leaving an idle keep-alive socket open.
  Fixed with a single `process.exit()` call in `bin.ts`, chained onto
  `main()`'s `.finally()`, verified by rerunning the exact same live
  flow and observing the process exit on its own.
- `removeEnvValues`'s first version left a stray blank line behind when
  removing a key from a file that had one, caused by not stripping the
  trailing empty string a plain `split("\n")` produces for a file ending
  in a newline. Caught by its own test comparing file contents exactly,
  before this ever touched a real `.env` file.
- A CRLF line-ending bug, found during final review, not by any test
  written up to that point: the original `setEnvValues`/`removeEnvValues`
  always rejoined lines with a plain `"\n"`, so a CRLF-formatted `.env`
  file kept `\r\n` only on lines the tool never touched, while any
  rewritten or appended line came back `\n`-only, a mixed-ending file.
  Fixed by detecting the file's existing line ending and reapplying it
  uniformly to every line, touched or not; verified the fix actually
  catches the regression by temporarily reverting to a plain `"\n"` join
  and confirming exactly the new CRLF-specific tests failed, then
  restoring the fix and rerunning the full suite clean.
- A real installation token appeared in this session's own terminal
  output from a plain `cat .env` run during hang debugging. Handled
  immediately per this project's own credential-hygiene rule: the token
  was never reused for further testing, disclosed the same turn, and
  both it and a second valid connection were revoked from the dashboard
  once verification finished.

### Interview questions I should be able to answer

- Why does a CLI package need a bundled build when the rest of this
  monorepo's packages don't, and what specifically breaks without one?
- Walk through why `AgentTraceClient.trace()`'s fail-open design is
  correct in one context and wrong in another, and how `connect` works
  around that without changing the SDK itself.
- How did you actually diagnose a process hang with no error message and
  no obvious stack trace to follow?
- What real bug did testing your `.env` editor byte-for-byte (not just
  by value) catch that a looser test would have missed?
- What would it take to make `agenttrace disconnect` fully revoke a
  connection server-side, and why wasn't that built in this milestone?

### Common mistakes engineers make here

- Assuming a library's documented (or even correct) behavior for one
  use case is automatically correct for every caller, instead of
  checking whether this specific caller's requirements actually match.
- Guessing at the cause of a hanging process instead of building small,
  targeted reproductions that rule candidates out one at a time.
- Testing file-mutation logic only by checking that the intended change
  happened, not by comparing the entire file's contents exactly, which
  is what actually catches corruption or formatting regressions in the
  untouched parts.
- Treating "the exchange succeeded" and "the resulting credential
  actually works" as the same fact, when they can diverge and a real
  tool needs to check the second one directly.
- Continuing to use a credential that has appeared in terminal output
  "just this once for local testing" instead of treating any such
  appearance as a real exposure requiring rotation.

### How this milestone improves my resume

"Built and shipped a real CLI package requiring its own bundled build
pipeline, diagnosed a process-hang bug by systematic elimination rather
than guesswork, and caught a file-corruption regression with exact
byte-for-byte tests before it ever reached a real file" is a specific,
verifiable claim about tooling, debugging discipline, and test rigor,
not just "built a CLI."

## M14 — Connected Applications dashboard UI (2026-08-01)

### What I built

- The `/cli/authorize` approve page: reads `state`, `redirect_uri`,
  `code_challenge`, and `suggested_name` from the query string, lets a
  signed-in person pick (or inline-create) a project, and on approval
  redirects back to the CLI's loopback listener with a real
  authorization code.
- `ConnectedApplicationsPanel` on the project settings page, the first
  UI for M13's `Installation` model: shows each connection's derived
  status (Pending/Connected/Revoked), who connected it, and an inline
  confirm/cancel revoke, matching `ApiKeysPanel`'s existing pattern.
- 7 real, not-mocked Playwright tests covering missing params, an
  external redirect being blocked, the userinfo-bypass exploit URL
  being blocked, a real approve-and-redirect against a real throwaway
  loopback listener, existing `redirect_uri` query params surviving the
  callback, and inline project creation.

### What I learned

- A `startsWith()` check on a URL is not the same thing as validating
  its host. `"http://localhost:1234@evil.example.com/callback"` passes
  `startsWith("http://localhost")` while actually pointing at
  `evil.example.com`, because everything before the `@` is userinfo
  (credentials), not host. The correct fix is to parse the string with
  `new URL()` and check `protocol`, `hostname`, `port`, `username`, and
  `password` as separate, explicit fields, never a prefix match against
  the raw string.
- Building a redirect URL by string concatenation risks silently
  dropping or duplicating query parameters the caller already supplied.
  `new URL(redirectUri)` plus `.searchParams.set(...)` handles this
  correctly without extra logic, since the URL object already knows how
  to merge into an existing query string.
- A route with no dynamic segment in its path still needs a `<Suspense>`
  boundary around `useSearchParams()` if it's going to be statically
  prerendered, something I only actually confirmed by watching a
  production build fail with the exact error, not by reading about it
  first.
- Defense-in-depth is worth applying even when a check already exists
  elsewhere: re-validating `redirect_uri` in the approve handler itself,
  not just at render time, means a component re-render or a
  race between validation and submission can't create a gap.

### Decisions made

- The UI-facing term is "Connected Applications"; the model, service,
  and route names all stay `Installation`, the same naming split
  `ApiKeysPanel` already established for `ApiKey`. See ADR-0017 and the
  design doc.
- `redirect_uri` validation uses `new URL()` field-by-field checks
  (`protocol === "http:"`, `hostname` exactly `localhost` or
  `127.0.0.1`, a non-empty `port`, empty `username`/`password`), applied
  both at render time and again inside the approve handler.
- Connection status is derived client-side from `lastUsedAt`/
  `revokedAt`, no new backend field needed for it.

### Problems encountered and how we resolved them

- The initial plan used `startsWith()` for `redirect_uri` validation.
  Corrected before implementation: given the exact bypass URL above,
  switched to full `new URL()` field validation, and verified the fix
  actually catches that exact exploit by temporarily reverting to
  `startsWith()`, confirming the test failed, then restoring the fix.
- `pnpm build` failed in production mode with "useSearchParams() should
  be wrapped in a suspense boundary," since `/cli/authorize` has no
  dynamic route segment and gets statically prerendered by default.
  Fixed by splitting the page into an outer component (wrapping an inner
  one in `<Suspense fallback={null}>`) that does the actual work.
- The only open browser tab available for live verification had a real,
  signed-in `nimra@gmail.com` session in it. Rather than touch a real
  account's session without asking, I raised it directly; the call was
  made to skip manual browser verification for this one step and rely
  on the real (not mocked) Playwright coverage instead.

### Interview questions I should be able to answer

- Walk through the exact userinfo-based bypass of a `startsWith()`
  redirect-uri check, and why `new URL()` field validation closes it.
- Why validate `redirect_uri` twice (render time and submit time)
  instead of once?
- Why does building a redirect URL with `URLSearchParams` matter more
  than it might seem, compared to string concatenation?
- What's the actual failure mode `<Suspense>` around `useSearchParams()`
  is protecting against, and why does it only show up in a production
  build?
- Why keep "Installation" as the internal name while showing "Connected
  Applications" in the UI, instead of renaming the model to match?

### Common mistakes engineers make here

- Validating a URL by checking whether a string starts with an expected
  prefix, instead of parsing it and checking its actual structured
  fields.
- Building redirect or callback URLs by string concatenation instead of
  using `URL`/`URLSearchParams`, risking dropped or duplicated query
  parameters.
- Trusting a validation check that runs once at render time to still
  hold true by the time a later action actually executes.
- Assuming a route without a dynamic segment can't hit prerendering
  issues, since "no params in the path" doesn't mean "no
  `useSearchParams()` usage."
- Proceeding with live manual testing in a browser tab without first
  confirming whose session is actually active in it.

### How this milestone improves my resume

"Found and fixed a redirect-uri validation vulnerability (a userinfo-
based bypass of a naive prefix check) before it shipped, replacing it
with structured URL field validation applied at two separate points in
the flow" is a specific, verifiable security-review claim, not just
"built a settings page."

## M13 — Installation credentials (CLI-connect backend) (2026-07-31)

### What I built

- The `Installation` and `CliAuthorizationCode` Prisma models: a
  second, personal, self-service credential type alongside the
  existing impersonal, admin-provisioned `ApiKey`.
- `POST /cli/authorize` (session-authenticated) and `POST /cli/token`
  (public): an authorization-code-plus-PKCE exchange, where a code is
  minted when a person approves a connection in the browser, and a real
  secret is only generated once the CLI completes the second half of
  the exchange.
- `ApiKeyGuard`, generalized in place to check both `ApiKey` and
  `Installation` credential tables, returning the exact same generic
  failure message for either.
- `Trace.installationId`, a new nullable provenance column, added in
  this migration even though nothing reads it back yet.
- A third named throttler (`'cli-token'`), with `@SkipThrottle()`
  applied to every other already-throttled route upfront, and unit and
  integration tests for every new piece (PKCE, the service layer, the
  guard, the throttler, the extended cross-throttler regression test).

### What I learned

- An "illustrative schema sketch" in a design doc is a starting point,
  not a contract. The design doc's original `Installation.tokenHash`
  was non-nullable, which would have meant generating and persisting a
  raw secret at browser-approval time, even briefly. Following this
  project's own existing rule (never persist a raw secret, only its
  hash) took precedence over matching the doc exactly, and the actual
  implementation is better for it: making `tokenHash` nullable and
  populating it only at exchange time means a pending, never-exchanged
  `Installation` can never authenticate anything, with no special-case
  logic needed to exclude it.
- A lesson from a previous milestone is only actually "learned" once
  it's applied without being prompted. M12 found the cumulative-named-
  throttler bug live, by accident. This milestone added a third named
  throttler and applied `@SkipThrottle()` everywhere upfront, on
  purpose, verified by a test, rather than waiting to rediscover the
  same bug a second time.
- Atomically claiming a single-use resource under concurrency isn't
  just "check then act," it needs the check and the claim to be the
  same database operation. `updateMany({ where: { id, usedAt: null } })`
  inside a transaction, checking the affected row count, is what
  actually closes the race window between two concurrent exchange
  attempts for the same authorization code; a separate `findUnique`
  followed by an `update` would not.

### Decisions made

- ADR-0017: `Installation` as a distinct model from `ApiKey`;
  `tokenHash` generated at exchange time, not approval time; the
  authorization-code-plus-PKCE flow; the generalized `ApiKeyGuard`;
  `Trace.installationId` added ahead of any UI reading it; the third
  named throttler with throttle-scoping applied proactively.

### Problems encountered and how we resolved them

- No significant live bugs surfaced during this milestone, unlike M11
  and M12. The cumulative-throttler bug that did surface at M12 was
  specifically avoided here by applying its fix proactively rather than
  waiting to hit it again; the extended regression test confirms all
  three named throttlers are actually isolated, not just assumed to be.
- An early version of `InstallationsService.authorize()` typed `label`
  as `label: string | undefined` instead of `label?: string`, which
  failed type-checking against tests that called it with fewer
  arguments. A small, mechanical fix, but a reminder that an optional
  parameter needs to actually be declared optional, not just typed to
  accept `undefined`.

### Interview questions I should be able to answer

- Why is `Installation.tokenHash` nullable, and what does a `null` value
  there actually mean operationally?
- Walk through the authorization-code-plus-PKCE exchange end to end:
  what's minted when, what's compared against what, and what stops a
  stolen code from being replayed.
- Why extend `ApiKeyGuard` in place instead of writing a second guard
  for the new credential type?
- Why does `Trace.installationId` get added now, before any UI reads it
  back out?
- What specifically makes the `updateMany`-inside-a-transaction pattern
  safe against concurrent exchange attempts, that a plain
  find-then-update wouldn't be?

### Common mistakes engineers make here

- Treating a design doc's illustrative schema as final once
  implementation starts, instead of re-checking it against the
  project's actual existing rules for similar data.
- Reading about a bug fix once and considering the lesson "learned,"
  without checking whether the same class of bug could recur the next
  time similar code is added.
- Implementing a "claim a single-use resource" check as a separate
  read-then-write instead of a single atomic conditional update,
  leaving a race window open under concurrency.
- Typing an optional function parameter as `T | undefined` instead of
  `param?: T`, which looks equivalent but isn't at every call site.

### How this milestone improves my resume

"Designed a second, self-service credential type alongside an existing
admin-provisioned one, implemented an OAuth-style authorization-code-
plus-PKCE exchange with atomic single-use code claiming under
concurrency, and proactively closed a rate-limiter bug class found in a
previous milestone before it could recur" is a specific, verifiable
claim about credential design and applied debugging discipline.

## M12 — LLM-as-judge evaluation (2026-07-30)

### What I built

- `apps/eval-worker`, a new stateless Python/FastAPI service, the first
  non-TypeScript app in the monorepo. One endpoint, `POST /evaluate`:
  build a prompt from a bounded evidence snapshot, ask Gemini for a
  strict-JSON verdict, validate it, hand it back. Never touches
  Postgres — `apps/api` owns authorization and persistence.
- `EvaluationsModule` in `apps/api`: bounds and truncates a trace's
  evidence (`MAX_SPANS = 20`, per-field and total character caps),
  calls the worker over an internal `X-Internal-Secret`-authenticated
  endpoint, and persists the result as an append-only `EvalResult` row
  with the exact snapshot and an `evaluatorVersion`, not a
  reconstruction of either.
- A cost-containment throttle (`EvaluationThrottlerGuard`, keyed on
  `userId:projectId`), a shared-fixture contract test that both
  languages' test suites validate against, and sanitized, distinct
  HTTP statuses (504/503/503/502/500) for every way the worker call can
  fail, instead of one undifferentiated 500.
- A narrow frontend: an Evaluate button on the trace detail page,
  disabled while pending, friendly per-status error text, and the
  append-only history rendered newest-first — no rubric config, model
  selection, auto-evaluation, deletion, or comparison in this slice.

### What I learned

- `@nestjs/throttler`'s `ThrottlerGuard` applies *every* named
  throttler registered in `ThrottlerModule.forRoot()` to any route it
  guards, not just the one a route's own `@Throttle()` references —
  confirmed by reading the library's actual `canActivate` source, not
  assumed from the docs. A route's `@Throttle({evaluate: {...}})` only
  supplies that one config's limit; it doesn't exempt the route from
  every other registered name. This meant the new `'evaluate'` route
  was silently also being checked against `'auth'`'s lower limit, and
  `signup`/`login` were silently also being checked against
  `'evaluate'`'s higher one, invisible only because the lower limit
  always won first. `@SkipThrottle()` on both sides fixed it.
- A live burst test is a bad way to verify an exact rate-limit
  threshold. Firing a dozen rapid real requests to prove "the limit is
  10, not 5" also produced real `503`s from Gemini itself under load,
  which took extra time to untangle from the actual bug being
  investigated. A deterministic integration test that boots a real
  Nest app and asserts the exact threshold proved the same fact faster,
  for free, and without depending on provider-side conditions I don't
  control. I should reach for that first next time, not as a fallback.
- `AbortSignal.timeout()` rejects with a `DOMException` named
  `TimeoutError`, not the generic `AbortError` I expected — checked
  empirically against this project's actual Node version with a small
  throwaway script, not assumed from older reading. That distinction is
  what let the client tell "the worker took too long" apart from "the
  worker was unreachable" without guessing.
- `google.genai`'s `ServerError` and `ClientError` both extend a common
  `APIError` base — found by reading the installed package directly.
  Catching `APIError` once covers both a `503` from Gemini being
  overloaded and a `429` from quota exhaustion, which turned out to
  matter for real: the frontend smoke test's live "provider
  unavailable" responses were actually a genuine `429
  RESOURCE_EXHAUSTED` on a shared free-tier key exhausted by a full
  day's testing, not a transient outage, confirmed by calling the
  Gemini API directly outside the app rather than guessing from the
  symptom alone.
- I wrote ADR-0016 late, after having already referenced "ADR-0016" by
  name in a dozen code comments across two languages while implementing
  the milestone. The comments were right about a decision that hadn't
  actually been written down anywhere yet. Caught during review, not
  before, a reminder that writing the ADR at the same time as the first
  comment referencing it is safer than trusting to circle back later.

### Decisions made

- ADR-0016: the Python/FastAPI worker boundary, the internal shared
  secret, the bounded evidence snapshot and its truncation rules,
  append-only history with `evaluatorVersion`, the cost-containment
  throttle (and the cumulative-named-throttler fix), no automatic retry
  of the worker call, the sanitized error-boundary status mapping, and
  cross-language contract testing.

### Problems encountered and how we resolved them

- `ThrottlerModule` is `@Global()`, and an earlier sketch of the
  design had it registered once per feature module (`AuthModule` and
  the new `EvaluationsModule` each calling `forRoot()`). Caught by
  reading the compiled module source before it caused a live bug, not
  after, and fixed by consolidating both named configs into one call in
  `AppModule`.
- Live-testing that consolidation fix (deliberately spending a few real
  Gemini calls to verify a real architectural change, not just
  reasoning about it) showed the throttle engaging at request 6, not
  the configured 10, and five of the first several requests returning a
  bare `500`. The `500`s turned out to be unrelated real `503`s from
  Gemini under burst load; the request-6 throttle was the real bug
  described above, fixed with `@SkipThrottle()` on both routes and
  proven with a new integration test that fails without the fix and
  passes with it.
- The frontend's live smoke test got a real `503` four times in a row.
  Rather than keep retrying blindly (which I'd already been corrected
  on once this same milestone, for the throttle test), I checked the
  actual cause with a small out-of-band script calling Gemini directly,
  found a real `429 RESOURCE_EXHAUSTED` with an explicit retry-after
  hint, waited for it, and when it was still exhausted, asked the user
  how to proceed rather than keep guessing. They chose to accept the
  live error-path verification plus a mocked success-path test as
  sufficient, rather than burn more of a shared, already-exhausted
  quota.

### Interview questions I should be able to answer

- Why build a separate Python service for this instead of adding an
  endpoint to the existing NestJS API?
- Why is the evidence snapshot bounded and truncated at the character
  level, and why is truncated text never re-parsed as JSON afterward?
- What does "append-only" actually buy you here, and what live
  evidence did you see that it mattered, not just that it sounded
  right?
- Walk through exactly why two unrelated routes ended up sharing each
  other's rate limits, and how the fix and its test work.
- Why does an internal-secret mismatch surface as a `500` while a
  provider failure surfaces as a `503`, given both are "the backend
  failed"?

### Common mistakes engineers make here

- Registering a `@Global()` Nest module more than once across feature
  modules, assuming the later import can't silently conflict with the
  first.
- Assuming a route's own `@Throttle()` config is a complete description
  of what rate limits apply to it, without checking whether the guard
  it uses also applies other named configs by default.
- Verifying a rate limit's exact threshold by hammering a real,
  paid, rate-limited endpoint instead of writing a deterministic test
  that proves the same fact for free.
- Collapsing every non-2xx response from an internal dependency into
  one generic `500`, losing the ability to tell "try again later" apart
  from "this is broken" apart from "we misconfigured something
  ourselves."
- Treating "the provider returned an error" as a single case, instead
  of checking whether the client library's own exception hierarchy
  already distinguishes categories worth handling differently.

### How this milestone improves my resume

"Designed a cross-language service boundary (NestJS to FastAPI) with a
shared internal-auth secret, a bounded/truncated evidence payload, and
a sanitized error-boundary mapping across both languages, then found
and fixed a real rate-limiter bug in a well-known library by reading
its source rather than assuming its documented behavior" is a specific,
verifiable claim about system design and debugging discipline, not just
"integrated an LLM API."

## M11 — Playwright end-to-end tests and CI database (2026-07-30)

### What I built

- Four Playwright specs (`apps/web/e2e/`): auth (signup, logout, the
  signed-out redirect), project creation, API-key management, and one
  narrow trace-ingestion smoke test — sign up and create a project and
  an API key via requests, POST a real trace and span through the
  public ingestion API, then verify the actual browser shows both on
  the runs page and its detail page.
- A new CI job with its first real, isolated, disposable Postgres
  service container, running the whole suite against production
  builds of both apps, with health polling, server-log capture, and
  Playwright report/trace artifacts on failure.

### What I learned

- CORS is a browser-page restriction, not an HTTP-client restriction —
  and I only actually confirmed this by hitting it. While debugging a
  test failure, I tried reproducing the ingestion call from inside a
  real browser tab's JavaScript console and got a `Failed to fetch`
  CORS error calling the API's own origin directly. That's real, but
  it's irrelevant to what Playwright's `request` fixture does: it's
  Playwright's own Node-based HTTP client, running outside any
  browser page context, so it was never subject to CORS in the first
  place, the same way curl never is. I had the right design already;
  what I didn't have yet was a clean way to prove it, and the wrong
  debugging method momentarily made a correct design look suspect.
- A local "it works on my machine" pass and a real CI run are
  different claims, even when I deliberately reproduce CI's production
  build-and-start steps locally first. I did that reproduction and it
  passed — and CI *still* found two more real bugs on the very first
  push: a `start:prod` script pointing at a path that has never
  existed (`dist/main` vs. the actual `dist/src/main.js`), and a typo
  in my own workflow's placeholder `CSRF_SECRET` (`i` isn't a valid hex
  character). Neither was something a more careful local dry-run would
  have caught by construction — they were specifically about the gap
  between "the command I typed locally" and "the exact environment and
  script GitHub Actions actually runs." The lesson isn't "simulate CI
  more" so much as "a green local dry-run narrows the search space, it
  doesn't close it — the actual CI run is still the real test."
- A script that ships in every `nest new` scaffold and has apparently
  never been questioned (`start:prod`) can be silently wrong for years
  in a project that never happens to run it — this repo has always used
  `nest start`/`--watch` for dev, so `node dist/main` had no chance to
  fail until something (this milestone) finally called it. "It's the
  framework's own default" is not the same claim as "it's been
  verified against this project's actual build output."
- `BrowserContext.request` sharing a cookie jar with `page` isn't just
  a convenience API, it's the mechanism that makes API-based test setup
  actually correct: cookies are scoped to the origin that issued them,
  so the setup calls have to go through the same origin (the Next.js
  proxy) the browser will later navigate to, not the API's own origin
  directly. Getting this backwards would have been a bug that only
  shows up as "the session doesn't exist," not as an obvious error at
  the point of the mistake.

### Decisions made

- ADR-0015: the four-spec scope, API-request-based setup (not UI, not
  the SDK, not direct DB writes) with the `context.request`
  cookie-sharing mechanism and the proxy-vs-direct origin choice for
  setup calls versus ingestion calls, unique/tagged test data with no
  automated cleanup, and the CI job's isolated database, fixed CI-only
  credentials, explicit port for `next start`, bounded health polling,
  failure-artifact capture, and single-worker execution — each with its
  own stated reasoning, not just "because that's how Playwright docs
  show it."

### Problems encountered and how we resolved them

- `trace-smoke.spec.ts` failed on its first run with a bare "Internal
  Server Error" page. Traced to a stale Turbopack dev-server module
  cache — installing `@playwright/test` as a new dependency while
  `next dev` was already running invalidated its cache without it
  noticing. Confirmed via the browser's own console diagnostic (which
  explicitly suggested a stale-cache cause), not guessed; fixed by
  restarting the dev server. Not a real application bug.
- `apps/api`'s `start:prod` script (`node dist/main`) failed with
  `MODULE_NOT_FOUND` the first time it was ever run, in a local
  production-mode dry run before even reaching CI. Root cause:
  `tsconfig.json` has no `rootDir`, needed because `prisma.config.ts`
  lives outside `src/`, so TypeScript's inferred output root includes
  the whole `apps/api/` directory, putting the compiled entry point at
  `dist/src/main.js`. Fixed the script, re-verified a full
  production-mode start locally, then again for real in CI.
- The CI workflow's own placeholder `CSRF_SECRET` value failed the same
  startup validation a real invalid secret would (ADR-0014) — a typo
  (`i` at the end isn't valid hex), caught on the very first real CI
  run, not locally, since I hadn't actually run the startup validator
  against that literal string before pushing. Fixed and specifically
  re-verified against the real `validateCsrfSecret` function before
  pushing again, then confirmed against a second real CI run.

### Interview questions I should be able to answer

- Why is Playwright's `request` fixture not subject to CORS, when a
  `fetch()` call from inside a real page would be?
- Why does test setup use `context.request` specifically, not the
  plain global `request` fixture, and what would break if you got that
  wrong?
- Why do the setup calls in `trace-smoke.spec.ts` go through the Next.js
  proxy while the ingestion calls hit the API directly — what's the
  actual reasoning, not just "that's what the code does"?
- What did reproducing CI's build-and-start steps locally actually
  catch, and what did it *not* catch that the real CI run still found?
- Why did `apps/api`'s `start:prod` script silently point at a
  nonexistent path for the entire life of this project until now?

### Common mistakes engineers make here

- Debugging a CORS-flavored error by reasoning about server-side CORS
  configuration, without first checking whether the client making the
  request is even subject to CORS in the first place (a browser page's
  JS is; a Node-based test runner or curl is not).
- Treating a green local dry-run of CI's exact commands as equivalent
  to a real CI run, instead of as evidence that narrows what's left to
  find, not proof nothing's left.
- Trusting a framework-scaffolded script (`start:prod`, `package.json`
  defaults from `nest new`) as correct by virtue of being the
  framework's own default, without checking it against this specific
  project's actual build configuration.
- Writing a "this doesn't need to be a real secret" placeholder value
  for a CI environment variable without running it past the actual
  validation logic it needs to satisfy.

### How this milestone improves my resume

"Stood up Playwright e2e tests and CI's first real, isolated database,
and caught two genuine bugs (a broken production-start script that had
never once been run in this project's history, and an invalid
placeholder secret in the CI workflow itself) specifically because the
milestone's own definition of done included a real CI run, not just a
passing local dry-run" is a concrete, specific claim about the
difference between local verification and the real target environment
actually being exercised.

## M10 — API key management UI (2026-07-29)

### What I built

- `/projects/:projectId/settings`, an `ApiKeysPanel` component: list,
  create (with a one-time raw-key reveal), and revoke (with an inline
  confirm/cancel, not a native dialog).
- `ApiKeyRecord`/`CreateApiKeyPayload`/`CreateApiKeyResponse` in
  `packages/shared-types`, plus a `toApiKeyRecord` mapper — the
  API-keys endpoints had been returning raw object literals with `Date`
  fields since M3, never brought in line with the Date-to-ISO-string
  wire contract every other endpoint already has.
- A real, live end-to-end proof that "Revoke" actually disables a key,
  not just changes a status label: created a key, used its raw value
  to authenticate a real ingestion call (succeeded), revoked it through
  the UI, then reused the *same* raw value again (rejected, `401`).

### What I learned

- A working feature (`ApiKeysController`, since M3) can sit completely
  unused by its own product for multiple milestones without anyone
  noticing, simply because curl and a raw browser `fetch` were "good
  enough" to keep testing other things. It took explicitly asking "does
  a real UI exist for this" during M9's testing to surface that it
  didn't.
- I caught myself reaching for a module-level mutable variable as a
  shortcut to avoid passing a prop one level down. It would have
  worked for the single-tab, single-render case I was testing, but
  breaks under anything else (concurrent renders, more than one panel
  instance, React re-render ordering) — the kind of bug that wouldn't
  show up in the exact manual test I was about to run, only later,
  under different conditions. Caught by asking "what does this
  variable actually need to be" rather than "does this pass the test
  I'm about to run," and fixed by just threading the prop normally
  before it ever shipped.
- A native `confirm()` dialog is a real, structural cost, not just a
  style preference: it blocks the page, including this project's own
  browser-automation testing tools, until a human manually dismisses
  it. Knowing I'd need to verify the revoke flow with those same tools
  later in the same milestone was itself a reason to build the
  confirmation as ordinary DOM state instead.
- "The button says Revoked" and "the key stopped working" are two
  different claims, and only testing the first one would have left the
  actual security property (a revoked key can no longer authenticate)
  completely unverified. Proving it required exercising the real
  ingestion path with a real raw key, not just checking the settings
  table's rendered state.

### Decisions made

- No new ADR this milestone, decided deliberately rather than skipped:
  M10 applied several already-established patterns (the mapper
  convention from ADR-0011, session-authenticated CRUD, CSRF-protected
  mutations from ADR-0014) to a new UI surface, rather than making a
  new architectural decision worth recording on its own.

### Problems encountered and how we resolved them

- Verifying that a revoked key's raw value actually fails would
  normally mean typing that raw value into a curl command, which
  would print it directly into this session's own visible output —
  exactly the kind of secret-echoing this project's security rules
  exist to prevent. Resolved by running the entire create-use-revoke-
  reuse sequence inside a single browser-executed script, which only
  ever returned HTTP status codes to my own output, never the key
  itself.

### Interview questions I should be able to answer

- Why does the raw API key have no "view again" affordance in the UI,
  and what would have to change server-side to add one?
- Why is a native `confirm()` dialog a worse choice here than inline
  confirm/cancel state, beyond visual preference?
- What's the difference between verifying a UI's displayed state and
  verifying the security property that state is supposed to represent?

### Common mistakes engineers make here

- Assuming a backend feature is "done" once its endpoints exist and
  pass their own tests, without checking whether anything in the
  actual product surface ever calls them.
- Reaching for shared mutable state to avoid a small amount of prop
  threading, which works for whatever specific case is being tested
  right now and breaks under a slightly different one later.
- Testing that a destructive action's UI reflects the new state (a
  status label changes) without testing that the underlying capability
  it represents was actually revoked.

### How this milestone improves my resume

"Built an API key management UI, including a live, end-to-end
verification that revocation actually invalidates a key for real
authentication (not just a status change in the interface), performed
without ever exposing the raw credential in visible output" is a
specific, concrete claim about verifying a security property directly,
not just building a CRUD screen.

## M9 — CSRF protection and login/signup rate limiting (2026-07-29)

### What I built

- `AuthThrottlerGuard` (extending `@nestjs/throttler`'s `ThrottlerGuard`),
  applied only to `POST /auth/login` and `POST /auth/signup` via
  `@UseGuards`/`@Throttle`, not globally — no generous global backstop
  to remember to exempt ingestion routes from.
- A signed, session-bound CSRF token (`HMAC-SHA256(CSRF_SECRET,
  session.id)`), not a naive double-submit cookie: `CsrfGuard` never
  reads the request's own cookie, it recomputes the expected value
  server-side and compares against a header with a constant-time
  comparison.
- `GET /auth/csrf`, a session-authenticated bootstrap endpoint letting
  an existing session (or one whose CSRF cookie was separately lost)
  recover a valid cookie without a full logout/login cycle.
- Startup validation for `CSRF_SECRET` (required, not a placeholder, at
  least 32 random bytes) that fails fast, before the API accepts any
  traffic, rather than surfacing as a confusing error on the first login.
- A frontend `ensureCsrfToken()` singleton promise that every mutating
  API call awaits before running, so the guarantee "a mutation never
  runs before a token exists" holds regardless of component call order.

### What I learned

- Reading code told me something curl couldn't: I assumed Next.js's
  rewrite-based proxy (`next.config.ts`) would add its own
  `X-Forwarded-For` hop the way a real reverse proxy does. It doesn't —
  confirmed by adding a temporary debug endpoint and hitting it four
  ways (direct, through the proxy, with and without a spoofed header).
  It relays whatever the client sent, completely unmodified. Trusting
  that header for rate limiting would have meant trusting a value any
  caller can set to anything, which is worse than not trusting it at
  all: it would look like real client-IP filtering while being
  trivially bypassable. This is exactly why "verify the actual request
  path, don't assume the framework does what a real reverse proxy
  would" mattered here, not just in the abstract.
- A "consistent normalization" question turned out to have a
  falsifiable answer, not a matter of taste. I initially lowercased the
  throttle's email key, assuming that was simply good practice. Asked
  to confirm it matched authentication's own behavior, I checked (and
  then verified live, by actually logging in with different casing
  than used at signup) and found `AuthService`'s lookup is genuinely
  case-sensitive — no normalization anywhere in the DTOs or the
  `User.email` column. Lowercasing the throttle key would have bucketed
  together requests that authentication treats as different accounts.
  Removed it. The lesson generalizes: "this seems like good practice"
  is not the same question as "does this match what the system it's
  protecting actually does," and the second question has a real,
  checkable answer.
- A naive double-submit cookie (cookie value equals header value,
  compared directly) only proves two requests came from the same
  browser context, not that the *server* ever issued the value. Signing
  the token (an HMAC only the server's secret could produce) and
  binding it to the session id, then never even reading the request's
  own cookie during validation, closes that gap: the trust decision
  becomes "could this header value have been produced by the server for
  this exact session," not "do two client-writable values happen to
  match."
- A route whose job is entirely about session validity (recovering a
  CSRF token for an *existing* session) needs the raw bearer token to
  never be re-derivable, which is exactly why it can't exist: only the
  token's hash is stored (ADR-0005). Keying the CSRF HMAC on the
  session row's own id instead solved this cleanly, but only because I
  checked what was actually available on every request (loaded by
  `SessionGuard` already) rather than assuming the raw token was an
  option.
- Rate limiting a specific mechanism (per-account, per-email) is not
  the same claim as rate limiting the underlying threat class
  (credential stuffing across many accounts, or signup spam across many
  emails). Both remain possible against this design, on purpose,
  documented as accepted debt rather than quietly out of scope.

### Decisions made

- ADR-0014: CSRF protection (signed, session-bound token; explicit
  authentication-mechanism-based exemption, not `@Public()`-based; the
  bootstrap endpoint; cookie attributes and rotation policy) and
  login/signup rate limiting (email-keyed, not IP-keyed, and why;
  process-local storage as a known limitation; credential-stuffing and
  signup-bypass limitations explicitly accepted, not fixed, this
  milestone).

### Problems encountered and how we resolved them

- My first `AuthThrottlerGuard` implementation lowercased the email
  tracking key. Caught during review, verified live (logged in with
  different casing than used at signup, confirmed it fails), fixed by
  trimming only, not case-folding.
- Calling the CSRF bootstrap endpoint automatically for every mutating
  request would have broken login/signup itself: at the moment you're
  logging in, no session exists yet, so bootstrapping a CSRF token
  first would 401 and trigger the frontend's redirect-to-login handler
  — meaning attempting to log in would immediately redirect you away
  from the login page. Caught before it ever ran, by tracing through
  what `ensureCsrfToken()` would actually do for those three specific
  routes, and fixed with an explicit exemption list matching the
  backend's own exemption logic.
- The CSRF bootstrap endpoint returns `204 No Content`, which the
  existing `request()` helper's unconditional `response.json()` call
  would have thrown on (no body to parse). Fixed by special-casing 204
  before attempting to parse a body.

### Interview questions I should be able to answer

- Why is a signed, session-bound CSRF token stronger than a naive
  double-submit cookie, specifically?
- Why does the CSRF guard never read the request's own cookie during
  validation, and what does it check instead?
- Why is the CSRF HMAC keyed on the session's database id rather than
  the raw session token?
- Why does keying the login/signup throttle on IP address not work in
  this project's current deployment topology, and what does it use
  instead?
- What does per-email rate limiting *not* protect against, and why was
  that accepted rather than fixed in this milestone?

### Common mistakes engineers make here

- Assuming a reverse-proxy-shaped mechanism (a URL rewrite) provides
  reverse-proxy-shaped guarantees (a trustworthy `X-Forwarded-For` hop)
  without checking.
- Normalizing an identifier (lowercasing an email) because it "seems
  like good practice," without checking whether the system whose
  behavior it's supposed to mirror actually does the same normalization.
- Implementing double-submit CSRF protection as a literal string
  comparison between a cookie and a header, without considering whether
  the server ever actually vouched for that value.
- Deriving a per-session secret from a raw bearer token, which only
  works once (at issuance) and can't be recomputed later for an
  existing session, instead of from a stable, already-available,
  non-sensitive identifier like the session row's own id.
- Fixing one mechanism (per-account throttling) and describing it as if
  it closes the whole threat category (brute force) it's named after,
  instead of being explicit about what it does and doesn't cover.

### How this milestone improves my resume

"Closed two previously-documented security gaps in a session-based auth
system: a signed, session-bound CSRF token (verified stronger than a
naive double-submit cookie) and account-targeted rate limiting, with
both the network-topology assumption (trusting X-Forwarded-For) and the
throttle key's consistency with the system's actual authentication
behavior verified empirically rather than assumed" is a specific,
concrete claim about closing a real gap correctly, not just adding a
middleware and calling it done.

## M8 — Trace detail view (2026-07-29)

### What I built

- `GET /projects/:projectId/traces/:traceId`, returning a flat,
  chronologically-ordered span array (not pre-nested), plus the trace
  detail page in `apps/web`: a summary card and a custom span
  waterfall.
- Two-pass span tree construction (`span-waterfall.tsx`): every span
  becomes a node before any linking happens, so a child appearing
  before its parent in the array never matters, and a span whose parent
  is missing, self-referential, or would close a cycle becomes a root
  instead of being dropped or causing infinite recursion.
- A deterministic effective-end calculation for the waterfall's bar
  widths (`trace.endedAt ?? max span endedAt ?? max span startedAt ??
  trace.startedAt`), never wall-clock `now`.
- Collapsible input/output/metadata payloads (native `<details>`, no
  library) and a hand-rolled waterfall (plain divs, no charting
  dependency).

### What I learned

- A response contract question ("should spans come back pre-nested or
  flat?") had a real answer once I asked what the frontend actually
  needed: a waterfall needs each span's own timing relative to the
  trace, which means walking every span regardless of whether the tree
  was pre-built. Pre-nesting server-side would have added a second
  representation to keep in sync for no removed work.
- Tree-building code that assumes its input is a valid tree (every
  parent reference resolves, no cycles) will eventually meet data that
  isn't one — not because ingestion is expected to produce it today
  (parent-first ingestion, ADR-0008, already prevents a cycle through
  the normal path), but because "the normal path prevents it" and "the
  code that renders it is safe if it doesn't" are two different
  guarantees, and only one of them is actually enforced by construction
  once you also consider future out-of-order ingestion or direct data
  edits. Building the guard in (two-pass construction, explicit cycle
  detection, a depth cap) rather than trusting the input was cheaper
  than it looked, and worth verifying live with a real, deliberately
  malformed mutual-reference case, not just reasoning about it.
- A trace's own `totalTokens`/`totalCostUsd` and a naive sum of its
  spans' token/cost fields are not guaranteed to be the same number,
  and treating them as interchangeable would have been an assumption,
  not a fact — confirmed by rereading `CreateTraceDto` and finding they
  really are independent, explicitly-reported fields, not derived ones.
- Effective "now," for a still-running trace with no `endedAt`, has to
  come from data already on hand (the latest known timestamp), not
  wall-clock time — otherwise a waterfall's bar widths would shift on
  every reload and disagree with whatever `durationMs` the client
  actually reported.

### Decisions made

- ADR-0013 (written retroactively; the decision was made and shipped in
  this milestone, but the ADR itself was written later after the gap
  was noticed): the flat response contract, two-pass cycle-safe tree
  construction, the effective-end calculation, never re-summing
  trace-level totals from spans, and no charting dependency for the
  waterfall.

### Problems encountered and how we resolved them

- The ingestion API's own parent-must-already-exist validation
  (ADR-0008) meant I couldn't construct an orphaned or cyclic span
  through normal means to test the frontend's defenses against one.
  Resolved by writing malformed `parentSpanId` values directly to the
  database for the test, then reverting them — a deliberate,
  temporary violation of the normal path specifically to prove the
  rendering code doesn't depend on that path always holding.
- This milestone's own documentation pass (ADR, learning journal entry,
  the `CLAUDE.md` milestone marker) was skipped entirely at the time
  and only caught later, while working on M9's docs. Backfilled here.
  Worth remembering: "pause for review before committing" covers the
  code, but a milestone isn't actually done until the docs pass runs
  too, and that step is easy to drop silently when a session moves
  straight from "approved" to "commit."

### Interview questions I should be able to answer

- Why does the trace detail endpoint return spans as a flat array
  instead of a pre-built tree?
- Walk through how the span tree builder protects against a cycle in
  `parentSpanId`, step by step.
- Why does the waterfall never use `Date.now()` to size a still-running
  span's bar?
- Why must a trace's `totalTokens`/`totalCostUsd` be displayed as
  reported, not recomputed from its spans?

### Common mistakes engineers make here

- Assuming a data structure is always well-formed just because the
  code that normally produces it enforces that shape, and skipping
  defensive handling in the code that later consumes it.
- Using wall-clock time to size a duration-based visualization for
  something still in progress, instead of the latest timestamp actually
  known.
- Treating a "total" field on a parent record as if it must equal the
  sum of its children's fields, without checking whether it's actually
  derived that way.

### How this milestone improves my resume

"Built a trace detail view with a custom span waterfall (two-pass,
cycle-safe tree construction verified against deliberately malformed
data, not just well-formed test cases) without a charting dependency"
is a specific, concrete claim about defensive data-structure handling,
not just "displayed some data in a UI."

## M7 — Dashboard: list agent runs (2026-07-29)

### What I built

- `GET /projects/:projectId/traces` (`ProjectTracesController`), a
  session-authenticated list endpoint with cursor pagination ordered by
  `(startedAt DESC, id DESC)`, and filters for status, agent name
  (partial match), and a date range.
- `ListTracesResponse` (`{ items, nextCursor }`) in `packages/shared-types`,
  an explicit response contract instead of a raw Prisma model.
- `apps/web`'s first real functionality: login and signup pages, a
  project list with inline creation, and the runs dashboard (filters
  synced to the URL, a table, cursor-based "Load more" pagination).
- A same-origin reverse proxy (`next.config.ts` rewrites) so the
  browser never has to deal with cross-origin cookies, and `proxy.ts`
  (Next.js 16's renamed `middleware.ts`) doing a cookie-presence-only
  convenience redirect, not real authentication.
- Along the way: found and fixed a real Prisma `Decimal`-serializes-as-
  a-JSON-string bug affecting every trace/span endpoint, not just the
  new one, and a real expired-session redirect loop caught only through
  manual browser testing.

### What I learned

- Prisma's `Decimal` type serializes to JSON as a **string**
  (`"12.34"`), not a `number`, even though the documented wire type
  (`TraceRecord.totalCostUsd: number`) had promised a number since M5.
  This had been true and untriggered since the M4 ingestion endpoints
  shipped; nothing surfaced it until building a second endpoint forced
  a direct comparison between what the type said and what the database
  driver actually produced. Confirmed with a standalone script first,
  then live over a real HTTP response, before touching any code.
- `startedAt` alone is not a safe sort key for cursor pagination once
  more than one row can share a timestamp. The fix isn't exotic:
  sort and compare on `(startedAt, id)` as a compound key, breaking
  ties with something that only needs to be stable and unique, not
  meaningfully ordered.
- Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts`
  (and the exported function from `middleware` to `proxy`). This
  wasn't something to infer from prior Next.js experience; it only
  showed up as a real build failure pointing at Next's own migration
  docs. A framework's file-based conventions are exactly the kind of
  thing a version bump can silently break.
- A convenience check and a real check can actively fight each other if
  they don't agree on what "signed out" means. `proxy.ts` treats
  "cookie present" as "signed in." The API's real 401 handler treats
  "cookie present but server-invalid" as "signed out" and redirects to
  `/login`. Because `proxy.ts` can't tell those two cases apart, it
  bounced `/login` straight back to `/projects`, which 401'd again,
  forever. This is a category of bug that unit tests and typechecks
  cannot catch at all: it only exists in the interaction between two
  files, triggered by a specific stateful condition (a stale cookie),
  and it only became visible by deliberately creating that condition in
  a real browser and watching what actually happened. Reading either
  file in isolation, both looked correct.
- A route whose entire job is ending a session (`POST /auth/logout`)
  must not itself require a *valid* session to run. Guarding it with
  the same `SessionGuard` as every other route seemed consistent, but
  it meant the one case logout exists to handle (an already-invalid
  session) was exactly the case where calling logout failed.
- Seeding realistic test data (varied statuses, agent names, and
  timestamps, via direct API calls with a real API key) surfaced things
  a single hand-typed test case wouldn't have: duration formatting only
  looked right once a trace actually had `durationMs` set, since
  nothing in the system derives it automatically from `startedAt`/
  `endedAt`, it's whatever the client explicitly reports.

### Decisions made

- ADR-0011: the trace list endpoint's cursor pagination design, the
  explicit response type, the Decimal serialization fix (extended to
  the M4 ingestion endpoints in the same checkpoint since it turned out
  to be small), and the two-controller split (session vs. API-key auth).
- ADR-0012: the frontend's same-origin proxy, `proxy.ts` as a
  convenience-only check, TanStack Query for data fetching, URL-synced
  filters, and the expired-session redirect loop bug found during
  manual testing along with its fix.

### Problems encountered and how we resolved them

- Six existing unit tests broke once `upsert()` started returning a
  mapped `TraceRecord`/`SpanRecord` instead of a raw Prisma row: their
  mocks returned incomplete objects (`{ id: 'trace-1' }`) missing
  `startedAt`, and the mapper's `.toISOString()` call threw on
  `undefined`. Fixed by introducing shared, realistic fixture helpers
  (`fakeTraceRow()`, `fakeSpanRow()`) instead of ad hoc partial mocks.
- The expired-session redirect loop (see above). Reproduced deliberately
  by expiring a session directly in the database while the browser kept
  its cookie, confirmed via a rapid stream of `[HMR] connected` console
  messages (the fingerprint of a tight redirect loop), fixed by having
  the frontend's 401 handler call `/auth/logout` before navigating, and
  by making that endpoint `@Public()` so it works on an already-invalid
  session.
- A test project I created via the browser ended up named "Test"
  instead of the name I'd typed, almost certainly a Chrome autofill
  suggestion accepted instead of my typed text landing in the field.
  Not a product bug, worth remembering that automated browser
  interaction can be misled by browser-level autofill in ways a human
  clicking through the same form usually notices and corrects for.

### Interview questions I should be able to answer

- Why does Prisma's `Decimal` type need an explicit mapper before
  returning it in an API response, and what would happen if you skipped
  that step?
- Why is `startedAt` alone not enough to order a cursor-paginated list
  correctly, and what does adding `id` as a second sort key actually
  fix?
- What's the difference between the job `proxy.ts` does and the job the
  API's 401 handler does, and why does the app need both instead of
  just one of them?
- Walk through exactly how the expired-session redirect loop happened,
  step by step, and why neither file was wrong in isolation.
- Why does `POST /auth/logout` need to be public, when almost every
  other route in the API defaults to requiring a valid session?

### Common mistakes engineers make here

- Trusting a wire-format type declaration (`number`) without checking
  what the underlying database driver actually puts on the wire for
  that field, especially for `Decimal`/`BigInt`-like types that many
  ORMs serialize specially.
- Sorting a paginated list by a timestamp alone, assuming timestamps
  are unique enough in practice, until two rows share one and a page
  boundary silently duplicates or skips a row.
- Treating a middleware/proxy cookie-presence check as if it were real
  authentication, instead of clearly designating one layer as the
  actual source of truth and the other as a pure UX convenience.
- Guarding a logout endpoint with the same auth requirement as every
  other route, without asking whether the one case it exists to handle
  (an invalid session) is the exact case that guard would reject.
- Assuming that because two pieces of code each look correct on their
  own, their interaction must also be correct, instead of actually
  exercising the interaction (here, a stale-but-present cookie) in a
  real environment.

### How this milestone improves my resume

"Built a cursor-paginated dashboard list endpoint and its frontend
(session-based auth, URL-synced filters, TanStack Query), and diagnosed
a redirect loop caused by a convenience auth check and a real auth
check disagreeing about session validity, catching it only through
deliberate manual browser testing rather than typechecking or
automated tests" is a specific, real claim about finding and fixing a
bug that only exists in the interaction between two otherwise-correct
pieces of code, a distinct skill from writing either piece correctly
on its own.

## M6 — Reference AI agent (2026-07-28)

### What I built

- `apps/reference-agent`: a GitHub issue investigator with three steps
  under one trace, fetch the issue, fetch the README, ask Gemini for a
  root cause and a proposed resolution, instrumented with the SDK from
  M5.
- Unauthenticated, read-only GitHub access (no personal access token),
  and a small per-model cost-estimation table for the LLM call.
- The first real, end-to-end run of the whole system: auth, projects,
  API keys, ingestion, and the SDK, all exercised by something other
  than us testing each piece by hand.

### What I learned

- A model I expected to work (`gemini-2.5-flash`, based on training
  knowledge) returned `404 "no longer available to new users"` for a
  freshly created API key. Training knowledge about which models are
  currently available is not something to trust without checking; a
  direct REST call against the provider's API is the actual source of
  truth, and I should reach for that first, not after something fails.
- A `429` response is not always a transient "you're going too fast"
  signal. This one's structured detail explicitly scoped every violated
  metric to `FreeTier` and stated `limit: 0`, meaning zero allocation,
  not "quota used up for now." The response's own `retryDelay` hint
  doesn't mean retrying will help, that field is boilerplate attached to
  most `RESOURCE_EXHAUSTED` responses regardless of whether the
  underlying limit is temporary or structural. Reading the actual
  structured error, not just the HTTP status code, was what caught this.
- A model outside what I recognized from training (`gemini-3-flash-preview`)
  turned out to be the one that actually worked, no billing required.
  Provider APIs release new models continuously, and any AI assistant's
  own knowledge has a cutoff, so unfamiliar model names showing up in a
  real API response are expected, not a sign something is wrong. The
  honest response to a knowledge gap like that is to test directly
  against the real API, not to guess based on naming patterns or assume
  the newest-looking name is right.
- Newer models can bill for things that aren't in the visible response.
  Gemini 3's `usageMetadata.thoughtsTokenCount` (internal "thinking"
  tokens) is real, documented, and billed as output, but it's a
  separate field from `candidatesTokenCount`, the token count for the
  actual visible text. Missing this would have meant every cost
  estimate and every recorded completion-token count for this model was
  silently wrong, not obviously wrong, just quietly too low. Confirmed
  by actually inspecting a real response's JSON, not by trusting the
  first field name that looked plausible.
- I temporarily displayed a live, working API key in plain terminal
  output while helping set up local testing. It was caught immediately
  in review before anything happened, but the right response to a
  credential ever entering visible output, even in a local dev
  test, even for a "local-only" project, is to revoke and replace it,
  not to just be more careful next time. This is the same discipline
  used for the platform's own API keys in earlier milestones, now
  applied to a key it wasn't AgentTrace's own guard checking.
- I wrote "verified directly" in a design document to describe a test
  that had not actually been run yet. This is a stronger version of a
  mistake I already knew to avoid: not just "don't claim something works
  without checking," but "don't even write it down as done in a document
  meant to be a record," since a document is exactly the kind of place a
  false claim quietly outlives the conversation it was made in.

### Decisions made

- ADR-0010: the three-step flat trace design, unauthenticated read-only
  GitHub access, Gemini as the chosen provider with a live-tested
  default model, per-model (not per-provider) cost estimation with no
  guessed prices for unverified models, and the real findings from
  testing model availability and quota against a real API key.

### Problems encountered and how we resolved them

- Covered in detail above: `gemini-2.5-flash` and `gemini-2.5-flash-lite`
  both 404'd for a new API key, `gemini-2.0-flash-001` hit a hard `0`
  free-tier quota, `gemini-3-flash-preview` worked. Resolved by testing
  each candidate directly via `curl` against Gemini's REST API before
  changing any of our own code, so each finding was based on a real
  response, not a guess, before it got written into `llm.ts`.
- `thoughtsTokenCount` was not accounted for in the first version of
  `analyzeIssue`. Caught by inspecting a real, successful response's
  full JSON rather than only checking that the call succeeded. Fixed by
  folding it into `completionTokens`, with a comment explaining why,
  rather than silently dropping it.
- An API key appeared in plain terminal output during setup. Resolved by
  revoking it immediately and generating a replacement, confirming the
  new one never appeared in any command's output, and confirming (via
  `git log --all` and `git check-ignore`) that `.env` itself had never
  entered git history at any point.

### Interview questions I should be able to answer

- Why does this agent only ever have read-only access to GitHub, and how
  is that enforced (a policy, or a structural limitation)?
- What's the actual difference between a `429` meaning "slow down" and a
  `429` meaning "this will never succeed no matter how long you wait,"
  and how do you tell them apart from the response body?
- Why did `completionTokens` need to include Gemini's `thoughtsTokenCount`
  field, and what would have gone wrong silently if it hadn't?
- Why does the reference agent never run in CI, when the API and SDK's
  tests do?
- What's the difference between the SDK's fail-open behavior (ADR-0009)
  and a real failure in the agent's own logic (a bad issue number, a
  failed LLM call), and why do they need to be handled differently?

### Common mistakes engineers make here

- Trusting a model name or provider detail from memory or training data
  instead of checking the provider's current API directly, especially
  for anything that changes over time (model availability, pricing,
  deprecations).
- Treating every `429` the same way (assume retry-after-a-delay will
  work) instead of reading the actual quota details in the response
  body, which can say "this will never succeed as configured," not just
  "not right now."
- Recording only the most obvious usage field from an API response
  (visible completion tokens) and missing a less obvious one (thinking
  tokens) that's still real and still billed.
- Letting a secret appear in any command output "just this once" because
  it's local-only or "nobody's watching," instead of treating every
  appearance the same way as a real leak.
- Writing a result into a design document before actually producing that
  result, planning to "fix it later" once the real test runs, which
  quietly turns an intended-but-unverified claim into a permanent,
  false one if that follow-up step gets skipped.

### How this milestone improves my resume

"Built and instrumented a reference AI agent (GitHub issue investigation,
unauthenticated read-only tool access, LLM cost estimation with
per-model verification) that exercises the full observability platform
end to end, including diagnosing and resolving a real third-party API
model deprecation and quota issue during integration" is a specific,
concrete claim about debugging a real external dependency, not just
building against documentation that turned out to be accurate.

## M5 — TypeScript SDK (2026-07-28)

### What I built

- `AgentTraceClient`, a small SDK wrapping the ingestion API from M4.
  `client.trace(info, fn)` and `trace.span(info, fn)` wrap a callback,
  measuring timing and reporting to AgentTrace automatically.
- Fail-open behavior: any failure in AgentTrace's own reporting (network
  error, timeout, bad response) is caught and logged as a sanitized
  warning, never thrown, so a problem with AgentTrace can never break or
  hang the agent using it.
- Real content in `packages/shared-types` for the first time since it
  was scaffolded in M0: wire-format request/response types, with
  `apps/api`'s DTOs now `implements`-checked against them at compile
  time.

### What I learned

- "Never break the caller's code" and "never hang the caller's code" are
  two different guarantees, and I only had the first one until it was
  pointed out. Fail-open on errors is not enough on its own if a slow
  response can still delay real work; a bounded timeout is what actually
  makes fail-open true in practice, not just in the happy path.
- A callback's return value looks like an obviously convenient thing to
  auto-capture as "the output," and that convenience is exactly the
  problem: it means application code choosing what to return silently
  decides what gets sent to a third system, with no chance to think about
  whether that value is safe to send.
- Wall-clock time and monotonic time solve different problems and are
  not interchangeable. `Date` answers "what time did this happen," useful
  for a dashboard. `performance.now()` answers "how much time elapsed,"
  and unlike `Date`, is guaranteed not to jump due to a clock
  adjustment. Using the wrong one for duration is a subtle, intermittent
  bug, not something that fails in an obvious way most of the time.
- A network timeout is genuinely ambiguous: it means "we stopped
  waiting," not "the server didn't process the request." Code that
  assumes a timeout means failure, and skips anything that depended on
  success, can end up in a worse state than code that treats the
  outcome as unknown and stays self-sufficient regardless. This is why
  the finish call for a trace or span was designed to never depend on
  whether the start call actually succeeded.
- `implements` in TypeScript is a compile-time shape check, nothing
  about it runs when a real HTTP request comes in. It is still valuable:
  it turns "the API and the SDK's types silently drifted apart" from a
  bug someone has to notice into a build failure the moment it happens.

### Decisions made

- ADR-0009: the wrapper API shape, fail-open with a bounded timeout, no
  automatic output capture, wall-clock vs. monotonic timestamps, the
  finish-call-is-self-sufficient design, bounded error capture with
  stack traces excluded, and sanitized warning logging.

### Problems encountered and how we resolved them

- Jest failed to parse the SDK's test files at all
  (`Cannot use import statement outside a module`) once
  `packages/sdk/package.json` had `"type": "module"` set. Fixed by
  removing it, matching `apps/api`'s existing convention of relying on
  `tsconfig`'s `NodeNext` module resolution without also declaring the
  package as real ESM, which Jest's default CommonJS-oriented transform
  does not handle well. Also hit a stale Jest cache while debugging this,
  `jest --clearCache` was necessary after the fix before it actually took
  effect, worth remembering before assuming a fix didn't work.
- A test that mocked the global `Date` constructor
  (`jest.spyOn(global, 'Date')`) to simulate a wall-clock jump produced
  objects missing their prototype methods (`toISOString` was not a
  function). Native constructors are known to be fragile to mock this
  way. Replaced with a simpler test that only mocks `performance.now()`
  and lets real, unmocked wall-clock time pass, which proves the same
  property (duration comes from the monotonic clock) without needing to
  fight a native constructor mock at all.

### Interview questions I should be able to answer

- Why does "fail open" require a timeout, not just a try/catch around
  the network call?
- Why should an SDK never automatically send a wrapped function's return
  value to a third-party system?
- What is the actual difference between wall-clock time and monotonic
  time, and why does duration specifically need the monotonic one?
- Why is a network timeout an ambiguous outcome, and how did that shape
  the design of the "finish" call?
- What does `implements` actually check in TypeScript, and what does it
  not check?

### Common mistakes engineers make here

- Adding a try/catch around a network call and calling it "fail open,"
  without a timeout, so a hanging request still blocks or delays the
  caller even though it will eventually resolve to a caught error.
- Auto-capturing a function's return value for logging or telemetry
  without considering that the function's caller never opted into that
  data leaving the process.
- Using `Date.now()` (or two `Date` objects) to measure elapsed time
  instead of a monotonic clock, which works almost all the time and
  fails intermittently in a way that's hard to reproduce.
- Assuming a network timeout means the request definitely failed
  server-side, when it only means the client gave up waiting.

### How this milestone improves my resume

"Designed a fail-open TypeScript SDK (bounded timeouts, explicit opt-in
output capture, monotonic duration measurement, and a self-sufficient
upsert-based reporting protocol) for instrumenting third-party
application code without risking that code's correctness or
availability" is a specific, real claim about building a library other
people's code depends on, a different skill than building an API only
your own frontend calls.

## M4 — Trace ingestion API (2026-07-27)

### What I built

- `POST /traces` and `POST /traces/:traceId/spans`, the first endpoints
  meant to be called by code (an agent's own instrumentation) instead of
  a person testing the API by hand.
- Both act as an upsert: a client supplied `externalTraceId` /
  `externalSpanId` decides whether a request creates a new row or
  updates an existing one, so an agent can report a trace as started,
  then report the same trace again later as finished.
- A `Span.parentSpanId` check requiring the referenced parent span to
  already exist and belong to the same trace, plus a check preventing a
  span from being its own parent.
- Renamed `Trace.idempotencyKey` to `Trace.externalTraceId`, and added
  `Span.externalSpanId`, after realizing the old name described the
  wrong concept.
- Finished the `ApiKey.lastUsedAt` work deferred from M3: it now updates
  after a key successfully authenticates, throttled to once per hour.

### What I learned

- A name can be technically functional but still wrong, in a way that
  would eventually cause a real bug. `idempotencyKey` worked, the
  unique-constraint-plus-upsert mechanism was already correct, but the
  name itself invited the wrong usage: standard idempotency-key advice
  says to generate a fresh key per request, which would have silently
  broken the exact "report now, update later" pattern the field existed
  to support. Renaming it to `externalTraceId` fixed nothing about the
  code, only the name, and that was the actual fix.
- Prisma treats `undefined` and `null` differently on purpose in
  `create`/`update` data: `undefined` means "do not mention this
  column," `null` means "write an actual NULL." This is exactly the
  tool needed for "an omitted field on an update should not overwrite
  existing data," as long as application code does not accidentally
  apply a default (like `status ?? RUNNING`) to a field before it
  reaches Prisma, which would turn an intentionally-omitted field into
  an explicit overwrite.
- Nullable JSON columns are a genuine Prisma special case: a plain `null`
  is ambiguous between "no value" and "the JSON value `null`," so Prisma
  has a distinct `Prisma.DbNull` sentinel for "actually clear this
  column," different from passing `null` directly.
- An atomic database operation (`upsert()`) and an informational read
  used only for validation are not the same kind of "read before write."
  The race a retried request could cause is specifically about the
  create-or-update *decision*, which stays inside the single atomic
  call; a read done purely to check something like self-parenting
  doesn't reintroduce that race, since it never decides how the write
  itself resolves.
- A constraint can be worth documenting as a real limitation rather than
  silently working around: parent-first ingestion (a span's parent must
  already exist) is simple and correct for a synchronous agent, but
  would break for any future out-of-order or batched ingestion. Writing
  that down now means it won't need to be rediscovered later.

### Decisions made

- ADR-0008: upsert-based ingestion, undefined vs null update semantics,
  the externalTraceId/externalSpanId rename, parent-first ingestion as a
  documented limitation, semantic validation rules, and the lastUsedAt
  update timing.

### Problems encountered and how we resolved them

- `prisma migrate dev` refused to run at all in this non-interactive
  terminal, even with `--create-only`, since it always wants to be able
  to prompt. Worked around with `expect` to drive the interactive
  confirmation prompt for `--create-only` (generating the migration file
  without applying it), reviewed the generated SQL, then applied it
  non-interactively with `prisma migrate deploy`, which is meant for
  exactly that.
- A broken `NODE_OPTIONS` environment variable (pointing at a missing
  harness file, unrelated to this project) made every `node`/`pnpm`
  command fail outright partway through this session. Worked around
  per-command with `NODE_OPTIONS=""`, documented in `CLAUDE.md` so it
  isn't mistaken for a project problem next time.
- TypeScript rejected passing `unknown`-typed DTO fields directly into
  Prisma's JSON columns, correctly, since Prisma's JSON input type is
  more specific than `unknown`. Fixed with a small `toJsonInput` helper
  that also handles the `Prisma.DbNull` case from above.

### Interview questions I should be able to answer

- Why does this ingestion API use upsert instead of separate start/end
  endpoints for a trace or span?
- What is the actual difference between `undefined` and `null` in a
  Prisma update call, and why does that distinction matter for a
  "report now, update later" API?
- Why was `idempotencyKey` the wrong name for a field whose mechanism
  was already correct?
- What does "parent-first ingestion" mean, and what would break it?
- Why doesn't a validation-only read before an `upsert()` call
  reintroduce the race that the atomic upsert is meant to prevent?

### Common mistakes engineers make here

- Applying a default value (`?? someDefault`) to a field on both the
  create and update paths of an upsert, which silently overwrites
  existing data with a default on every update where the client didn't
  resend that field.
- Naming a field after the mechanism it happens to use (idempotency)
  instead of the concept it actually represents (a stable client
  identity), which invites correct-sounding advice for the wrong
  concept.
- Treating `null` and an omitted field as the same thing when building
  update payloads, when they need to mean different things: clear this,
  versus leave it alone.
- Assuming any read before a write reintroduces a race condition,
  instead of checking specifically whether that read is used to decide
  the write's outcome.

### How this milestone improves my resume

"Designed an idempotent trace/span ingestion API (atomic upsert
semantics, undefined-vs-null update handling, parent-first referential
validation) that supports both one-shot and progressive reporting from
client SDKs" is a specific, real claim about API design for a system
that receives data from external clients, not just CRUD over your own
frontend.

## M3 — API keys, create and revoke (2026-07-24)

### What I built

- Endpoints for a signed in user to create, list, and revoke API keys for
  a project.
- A new `ApiKeyGuard`, separate from the session guard from M2, that
  reads an `Authorization: Bearer <key>` header and resolves it to a
  project instead of a person.
- A temporary `GET /api-keys/verify` endpoint to prove the guard works
  with a real HTTP request, since there was no other API-key-protected
  endpoint yet to test it against.
- Moved the `hashToken` helper out of the auth folder into a shared
  common folder, since both sessions and API keys need it now, not just
  auth.

### What I learned

- A session answers "which person," an API key answers "which project."
  They needed two different guards, not one guard trying to handle both
  cases, since what gets attached to the request afterward
  (`request.user` versus `request.apiKeyContext`) is a genuinely
  different shape.
- Giving every failure case the same error message is a real security
  choice, not just tidiness. If "missing key," "unknown key," and
  "revoked key" each had their own message, an attacker probing an
  endpoint could learn something from which message came back. I wrote a
  test specifically checking that all rejection cases produce the exact
  same message, not just that they all return 401.
- An authorization check can have more than one part. Revoking a key
  needed two separate checks: does this project belong to my
  organization, and does this key belong to this project. Skipping
  either one on its own would open a real gap, even though each check
  looks like it is doing the same kind of thing.
- Returning `404` instead of `403` for a project you cannot access, a
  pattern from M2, applies here too. It came up again naturally instead
  of needing to be reinvented, which was a good sign that the pattern
  actually generalizes.
- A guard can be applied per route with `@UseGuards(...)` instead of
  globally. `SessionGuard` from M2 is global because most routes are for
  a logged in person. `ApiKeyGuard` is not global, because only a few
  routes are meant to be called by a script holding a key.

### Decisions made

- ADR-0007: API key format, hashed storage, one generic 401 for every
  failure case, and `/api-keys/verify` marked explicitly as temporary.

### Problems encountered and how we resolved them

- No schema or tooling problems this milestone. The `ApiKey` table
  already existed from M1's schema, and the hashing and guard patterns
  from M2 carried over directly, so most of this was applying an
  established pattern rather than solving something new.
- The pre-commit review did catch two real issues in the first version
  of the code, both worth remembering:
  - I had `ApiKeyGuard` update `lastUsedAt` on every successful
    authentication. It worked, but it meant every future ingestion
    request (M4, the busiest path in the whole system) would carry an
    extra database write just to track a field that is only useful
    occasionally. Removed for now, revisit with a throttled or async
    update once ingestion exists.
  - `revoke()` did not check whether a key was already revoked. Calling
    it twice would silently overwrite the original `revokedAt`
    timestamp with a new one, which quietly defeats the audit reasoning
    for soft-deleting instead of hard-deleting in the first place. Fixed
    by making revoke idempotent: if already revoked, return success
    without touching the row.
  - Neither issue would have failed a test or a build. Both were only
    caught by specifically asking "what happens on every request" and
    "what happens if this is called twice," not by anything automated.

### Interview questions I should be able to answer

- Why does an API key need a different guard than a session, instead of
  reusing the same one?
- Why is giving every auth failure the same error message a security
  decision and not just a style choice?
- What are the two separate checks involved in revoking an API key, and
  what would go wrong if only one of them existed?
- Why store a short prefix of an API key separately from its hash?
- Why mark `/api-keys/verify` as temporary instead of just building it
  and moving on?
- Why does writing `lastUsedAt` on every authenticated request matter
  more for an ingestion endpoint than for a login endpoint?
- What goes wrong if an action like "revoke" is not idempotent, and how
  would you notice, since it would not show up as a failing test?

### Common mistakes engineers make here

- Giving different error messages for different auth failure reasons,
  which leaks information to whoever is probing the endpoint.
- Checking that a project belongs to the right organization, but
  forgetting to also check that the specific resource being modified
  (an API key here) actually belongs to that project.
- Adding a write to a hot path (a field update on every authenticated
  request) without asking how often that path will actually run once a
  real client is calling it many times a second.
- Writing an action like "revoke" or "delete" as if it will only ever be
  called once, so a retried or duplicate call silently does something
  slightly wrong (like overwriting a timestamp) instead of safely doing
  nothing.
- Building a debug or test endpoint and never revisiting whether it
  should still exist once the real endpoint it was standing in for
  finally gets built.

### How this milestone improves my resume

"Designed and implemented an API key system (hashed storage, prefix
based identification, a dedicated auth guard, and a tested single-message
failure response) as a second authentication path alongside session
based login" shows the ability to support more than one kind of client
(browser and machine) in the same system, a common real world need.

## M2 — Auth, sessions, and org/project creation (2026-07-23)

### What I built

- Signup and login with email and password, using bcrypt to hash
  passwords.
- A `Session` table and a session cookie system. When you log in, the
  server makes a random token, stores only its hash in the database, and
  sends the raw token to the browser as an httpOnly cookie.
- A `SessionGuard` that checks this cookie on every request, applied
  globally, with a `@Public()` decorator for the few routes that should
  skip it (signup, login, health check).
- Endpoints to create and list projects, scoped to the signed in user's
  organization.
- Unit tests for the signup and login logic, using a mocked database so
  no test database was needed yet.

### What I learned

- The difference between authentication (who are you) and authorization
  (what are you allowed to do). This milestone builds authentication and
  a very simple form of authorization (are you a member of this
  organization).
- Why hashing a session token before storing it matters, not just
  hashing passwords. If the database ever leaked, an attacker with only
  the hashes still could not log in as anyone, since they do not have the
  original random tokens.
- httpOnly cookies keep a token away from client side JavaScript. This
  matters because it means an XSS bug somewhere else in a future
  frontend could not just read the cookie and steal a session.
- Why a login should give the exact same error for "wrong password" and
  "no such user." If the errors were different, an attacker could use
  login attempts to figure out which emails have accounts, one at a time.
- Nest's guards can be applied globally, and turned off per route with a
  decorator, instead of being added one at a time to every protected
  route. This means new routes are protected by default, which is safer,
  since it is easy to forget to add a guard to a new route but much
  harder to forget to remove `@Public()` from a route that should not
  have it.
- Database transactions matter for signup, since it creates three rows
  (organization, user, membership) that all need to succeed together or
  not at all. If the membership creation failed after the user was
  already created, we would have a user with no organization, stuck.

### Decisions made

- ADR-0005: session based auth with hashed tokens, no Passport, guard
  defaults to deny.
- ADR-0006: create an organization automatically at signup, one
  organization per user for now.

### Problems encountered and how we resolved them

- The same `.js` extension import problem from M1 showed up again, this
  time in Jest. `ts-jest` could not resolve `../../generated/prisma/client.js`
  because only the `.ts` file exists on disk. Fixed by adding a
  `moduleNameMapper` rule to the Jest config that strips `.js` from
  relative imports before Jest tries to resolve them. This is a known,
  documented workaround for `ts-jest` plus `nodenext` style TypeScript
  projects, not something specific to our setup.
- Once the session guard was registered globally, the existing `/` and
  `/health` routes from M0 and M1 started requiring a login too, since
  they were not marked public. Had to explicitly add `@Public()` to both.
  A good reminder that a global guard change can quietly break existing
  routes if you are not careful to check all of them.

### Interview questions I should be able to answer

- What is the actual difference between a session and a JWT, and when
  would you pick one over the other?
- Why hash a session token before storing it, if the cookie is already
  httpOnly?
- Why does a login endpoint give the same error for a wrong password and
  an email that does not exist?
- What is a database transaction protecting against in the signup flow,
  specifically?
- Why register an auth guard globally instead of adding it to each
  protected route one at a time?

### Common mistakes engineers make here

- Giving different error messages for "wrong password" versus "no such
  account," which leaks which emails are registered.
- Storing a raw, usable session token in the database instead of a hash
  of it.
- Adding a new protected route and forgetting to add the auth check to
  it, because the project relies on each route remembering to add its
  own guard instead of defaulting to protected.
- Skipping a database transaction on a multi step signup, leaving room
  for a user to end up half created if one step fails.

### How this milestone improves my resume

"Built a session based authentication system from scratch (hashed
tokens, httpOnly cookies, a globally applied guard with explicit public
route opt outs) and a multi tenant project creation flow with tested
authorization boundaries" is a real, specific line. It shows an
understanding of how login actually works, not just "used a login
library."

## M1 — Prisma schema, migrations, and a live Postgres connection (2026-07-22)

### What I built

- The full trace/span data model (`Organization`, `User`, `Membership`,
  `Project`, `ApiKey`, `Trace`, `Span`) as `apps/api/prisma/schema.prisma`,
  applied to local Postgres via a real, versioned migration.
- A seed script creating a demo org/user/project, runnable idempotently
  via `pnpm db:seed`.
- `PrismaService`/`PrismaModule` in NestJS, managing the Prisma connection
  through Nest's own module lifecycle, plus a `GET /health` endpoint that
  proves the API can actually reach Postgres (`SELECT 1` through Prisma).

### What I learned

- **Migrations vs. `db push`**: `prisma migrate dev` generates a
  versioned, plain-SQL file and records it as applied in a
  `_prisma_migrations` table — every environment replays the same ordered
  SQL to reach the same state. `db push` just diffs and mutates, with no
  history; fine for throwaway prototypes, wrong for anything with real
  data or more than one environment.
- **Postgres enforces enums and foreign keys at the database layer**, not
  just in application code — `CREATE TYPE ... AS ENUM` means an invalid
  status value is rejected by Postgres itself, and a foreign key means you
  literally cannot insert a `Trace` row pointing at a `Project` that
  doesn't exist, regardless of what the application code does.
- **`ON DELETE RESTRICT` vs `CASCADE`** is a real design decision, not a
  default to ignore — RESTRICT (Prisma's default) protects against
  accidental data loss by refusing a delete while dependents exist; we
  kept it everywhere, including `Span → Trace`, since we have no deletion
  feature yet and don't want silent cascading deletes as a side effect of
  something else.
- **`DECIMAL`, not `FLOAT`, for money-like values** — floating point
  rounding error compounds; fixed-point decimal is the standard choice for
  anything resembling currency.
- **Prisma 7 changed enough conventions that old habits actively broke
  things**: the datasource URL moved out of `schema.prisma` into
  `prisma.config.ts`; `PrismaClient` now requires an explicit driver
  adapter (`@prisma/adapter-pg`, wrapping the standard `pg` driver)
  instead of managing its own connection; and the generated client
  defaults to an ESM-only shape (`import.meta.url`) that breaks under
  `ts-node`'s CommonJS mode. Fixed by setting `moduleFormat = "cjs"` in
  the generator block and running standalone scripts with `tsx` instead
  of `ts-node`. Lesson: a major-version bump is a reason to actually check
  what changed, not assume prior experience still applies verbatim.
- **`prisma init` isn't harmless scaffolding** — this version bundled
  duplicate "AI assistant skill" doc packs for three different tools into
  the repo unprompted. Worth actually looking at what a scaffolding
  command generates rather than trusting it by default.
- **NestJS module lifecycle hooks** (`OnModuleInit`, `OnModuleDestroy`)
  are how you tie an external resource's connection lifecycle (Prisma's
  connection pool here) to the application's own startup/shutdown,
  instead of managing it as a bare global.

### Decisions made

- ADR-0003: trace/span data model, ID/index/type choices, RESTRICT as the
  default delete behavior.
- ADR-0004: Prisma over Drizzle, including the real Prisma-7-specific
  friction encountered while implementing it.

### Problems encountered and how we resolved them

- `ts-node prisma/seed.ts` failed with `Cannot find module
  '../generated/prisma/client.js'` — the generated client is `.ts` source
  using `.js`-extension internal imports (TypeScript's `nodenext`
  convention), which plain CommonJS `require` can't resolve. Fixed by
  switching the seed runner to `tsx` and setting the generator's
  `moduleFormat` to `"cjs"` to drop the ESM-only `import.meta.url` usage
  entirely.
- Port 5432 conflict (already documented from M0) meant `.env` had to
  point at `localhost:5433`, not the Postgres default.

### Interview questions I should be able to answer

- What's the actual difference between `prisma migrate dev` and
  `prisma db push`, and why does it matter which one you use against a
  database with real data in it?
- Why store cost as `Decimal` instead of `Float`?
- What does `ON DELETE RESTRICT` protect against, and when would you
  choose `CASCADE` instead?
- Why does an ORM's generated client need to know about your database
  driver at all (driver adapters) — what problem does that solve compared
  to the ORM managing its own connection internally?
- Why is `Span.parentSpanId` a self-reference instead of a separate join
  table, and how does that map to OpenTelemetry's model?

### Common mistakes engineers make here

- Using `db push` against a database that already has real data, losing
  migration history and making rollback/audit impossible.
- Defaulting to `CASCADE` everywhere "to keep things simple," which turns
  one accidental delete into a much bigger accidental delete.
- Blindly trusting a scaffolding tool's output (`prisma init` here)
  without checking what it actually generated.
- Assuming a major-version upgrade of a dependency preserves all prior
  behavior — checking the changelog would have caught the driver-adapter
  and ESM changes before hitting the errors directly.

### How this milestone improves my resume

"Designed a multi-tenant Postgres schema (orgs/projects/API keys/traces/
spans) with versioned Prisma migrations, idempotency-safe unique
constraints, and NestJS-managed connection lifecycle" is a legitimate,
specific resume line — it names real decisions (idempotency, tenancy,
migrations) instead of just "used Postgres."

## M0 — Repo scaffolding (2026-07-21)

### What I built

- A pnpm-workspace monorepo (`apps/web`, `apps/api`, `packages/shared-types`,
  `packages/sdk`) with a shared `tsconfig.base.json`.
- Next.js (App Router, TS, Tailwind) app and a NestJS app, both installing,
  linting, typechecking, and building cleanly.
- `infra/docker/docker-compose.yml` for local Postgres.
- A GitHub Actions CI skeleton (install → lint → typecheck → build).
- `CLAUDE.md`, ADR process (`docs/adr/`), and this learning journal.

### What I learned

- **Corepack** is the officially bundled way to get a pinned package-manager
  version (`pnpm`) without a separate global install — Node ships it, you
  just `corepack enable`.
- **pnpm workspaces** turn a set of folders into linked local packages via
  the `workspace:*` protocol — no publishing to npm needed for one package
  to `import` another inside the same repo.
- **pnpm 10+ blocks native postinstall/build scripts by default**
  (supply-chain-attack mitigation — a malicious package can't silently run
  arbitrary code on `install` anymore). You explicitly allow the ones you
  trust in `pnpm-workspace.yaml` (`allowBuilds`). We allowed `sharp`
  (native image resizing for `next/image`) and `unrs-resolver` (native
  resolver used by ESLint's import plugin) — both extremely widely-used
  packages, not something we're taking on blind trust.
- **A nested `pnpm-workspace.yaml`** (created by `create-next-app`'s
  template) would have made `apps/web` its own separate workspace root
  instead of a member of ours — workspace files only belong at the
  monorepo root. Had to catch and remove it.
- **CI lint must never run with `--fix`.** Nest's default generated `lint`
  script includes `--fix`, which is fine for a local pre-commit habit but
  wrong in CI: CI should *fail* on violations, not silently rewrite files
  and pass. Split into `lint` (check-only, used in CI) and `lint:fix`
  (local convenience).
- **Port conflicts are a normal part of local dev with Docker.** This
  machine already runs a native PostgreSQL 15 install bound to 5432
  (unrelated to this project). Rather than touching an existing system
  service, we remapped our container's *host* port to 5433, leaving the
  *container's internal* port at 5432 — the mapping (`5433:5432`) only
  affects how you reach it from the host, not how Postgres itself is
  configured inside the container.
- **`nest start --watch` spawns a child process that outlives a naive
  `pkill -f` on the parent's command line** — killing dev servers
  cleanly sometimes means killing whatever's bound to the port
  (`lsof -ti:PORT | xargs kill`), not just the command you launched.

### Decisions made

- ADR-0001: pnpm workspaces, no Turborepo/Nx yet.
- ADR-0002: NestJS for the core API; FastAPI deferred to a future,
  narrowly-scoped evaluation worker.

### Problems encountered and how we resolved them

- `create-next-app` and `nest new` running concurrently raced on creating
  `apps/`, and the Next.js scaffold failed with a permissions error.
  Resolved by re-running it alone once `apps/` existed.
- Docker Compose failed to bind port 5432 because of the pre-existing
  native Postgres install. Resolved by remapping the host port to 5433
  (see above).

### Interview questions I should be able to answer

- Why does this project use a monorepo instead of separate repositories,
  and what would make you switch to Turborepo/Nx?
- What is `workspace:*` doing, mechanically, when one package "depends on"
  another in the same repo?
- Why did you choose NestJS over FastAPI for the core API, and where does
  Python still fit in this system?
- What's the difference between blocking native install scripts by default
  (pnpm 10+) and the older behavior — what's the actual attack this
  defends against?
- Why does a `docker-compose.yml` port mapping look like `"5433:5432"`,
  and which side is "the outside world" vs. "inside the container"?

### Common mistakes engineers make here

- Running `--fix` in CI lint steps, which turns a should-fail check into a
  silent auto-correction (and can mask real issues, or even fail
  unexpectedly if the CI runner's filesystem is read-only).
- Committing a monorepo without deciding the workspace boundary up front,
  leading to nested/conflicting workspace files from scaffolding tools.
- Killing Docker port conflicts by stopping or uninstalling whatever else
  is using the port, instead of just remapping your own container.

### How this milestone improves my resume

Not itself a resume bullet on its own (it's scaffolding), but it's the
foundation the real bullets (ingestion API design, dashboard, deployment)
will sit on — and "structured a TypeScript monorepo with shared types
across frontend/backend/SDK, enforced via CI" is a legitimate, small,
factual line if needed.
