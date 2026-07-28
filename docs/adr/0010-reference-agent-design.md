# ADR-0010: Reference agent design

Status: Accepted

## Context

Everything built so far (auth, projects, API keys, ingestion, the SDK)
has only ever been exercised by us testing each piece on its own. This
milestone needed something real using all of it together: a small agent
that does actual work, instrumented the way a real user of AgentTrace
would instrument their own agent.

## Decision

`apps/reference-agent` is a GitHub issue investigator with three steps,
under one trace:

1. **Tool span**: fetch the issue (title, body) from GitHub's public
   REST API.
2. **Tool span**: fetch the repository's README, for context.
3. **LLM span**: ask Gemini for a likely root cause and a proposed
   resolution, given the issue and the README.

Kept deliberately simple, a flat trace with three sibling spans, no
nested sub-spans. The point of this milestone is proving the
observability system works end to end, not building a sophisticated
agent architecture.

### GitHub access is unauthenticated and read-only, structurally

No personal access token. Every GitHub call is a plain `GET` against the
public REST API. This isn't a policy the agent's code happens to follow,
it's the only thing it's capable of: there is no write capability
anywhere in `github.ts` to misuse, accidentally or otherwise.

### The LLM provider is Gemini, model configurable

Chosen over OpenAI for this reference implementation, a deliberate
choice, not a default. The model is not hardcoded unconditionally:
`GEMINI_MODEL` is read from the environment, falling back to
`DEFAULT_MODEL` in `llm.ts` if unset.

**Which model that default actually is took real, live testing to
figure out, not documentation.** `gemini-2.5-flash` and
`gemini-2.5-flash-lite` both returned `404 "no longer available to new
users"` for a freshly created API key. `gemini-2.0-flash-001` was
recognized but returned `429 RESOURCE_EXHAUSTED`, with all violated
quota metrics explicitly scoped to `FreeTier` and stating `limit: 0`,
meaning this key's project has no free-tier allocation at all for that
model, not merely a temporarily exhausted one (the response's
`retryDelay` hint does not change that, a `0` limit does not become
nonzero by waiting). `gemini-3-flash-preview` worked immediately, no
billing required, confirmed via a direct REST call before touching any
of our code. `DEFAULT_MODEL` is `gemini-3-flash-preview`.

This also surfaced something worth designing around: Gemini 3 models can
return `usageMetadata.thoughtsTokenCount`, tokens spent on internal
"thinking" before producing the visible response, real, billed output
tokens that are not part of `candidatesTokenCount`. Confirmed by
inspecting a real response, not assumed from documentation. `llm.ts`
folds `thoughtsTokenCount` into `completionTokens`, since both are
billed as output; not doing so would have meant `costUsd` and the
recorded token counts silently undercounting actual usage for any
Gemini 3 model.

### Cost is bounded and never runs unattended

One LLM call per run, a short prompt (issue text plus a truncated
README, not the whole repository), and a cheap, fast model by default.
Token usage from the real API response is recorded via
`span.recordUsage(...)`. `pricing.ts` estimates `costUsd` from a small,
explicitly approximate, hardcoded price table keyed by model name, not
fetched live, and documented as needing a manual check against Google's
current pricing rather than treated as billing-accurate. If a model
(including the current default, `gemini-3-flash-preview`, a preview
model with no publicly verified price at the time this was written) is
not in that table, cost estimation returns `undefined` rather than
silently applying another model's price to it, wrong data with false
confidence is worse than no data. Confirmed live: running the agent with
`gemini-3-flash-preview` recorded real, correct `promptTokens` /
`completionTokens` on the span, with `costUsd` left empty rather than a
guessed number. This lives in the reference agent, not the SDK, since
per-model pricing is application-specific knowledge that changes over
time, not something a generic client should hardcode.

**This agent is never run in CI.** Wiring a real, paid, network-dependent
LLM call into every push would be a recurring cost and a flaky build for
no real benefit, since this milestone's automated test coverage
(`pricing.spec.ts`) covers the one piece of pure logic (cost estimation)
without needing a real network call to verify it.

### Two different kinds of failure, not one

The SDK's fail-open behavior (ADR-0009) only covers AgentTrace's own
reporting. It has nothing to do with whether the agent's actual work
succeeded. If the GitHub issue number doesn't exist, or the LLM call
fails, `fetchIssue` / `analyzeIssue` throw a real error, which propagates
out of the wrapping span, out of the wrapping trace, and ends the run
with a non-zero exit code, an `ERROR` trace correctly recorded, not
silently swallowed.

### Testing scope: one small pure function, not the network calls

Unlike the API and SDK, most of this app's code is a thin wrapper over
GitHub's REST API and Gemini's SDK, there isn't much independent logic
worth unit testing with mocks. `pricing.ts`'s `estimateCostUsd` is the
one deterministic, pure piece of logic here, and it has real automated
tests. The rest is meant to be verified by actually running the agent
against the real APIs, not by mocking GitHub and Gemini, which would be
a less honest test of "does this actually work" for a reference
implementation whose whole purpose is demonstrating a real integration.

## Manual test results (actually executed)

- Ran against `vercel/next.js#1`. Result: a `SUCCESS` trace
  (`durationMs` 16726), with all three spans present and `SUCCESS`:
  `fetch-issue` (`TOOL`, 371ms), `fetch-readme` (`TOOL`, 218ms),
  `analyze-issue` (`LLM`, 15939ms, `model=gemini-3-flash-preview`,
  `provider=gemini`, `promptTokens=1057`, `completionTokens=854`,
  `costUsd` empty as expected). Confirmed directly via `psql`, not just
  the CLI's own stdout. A real proposed root cause and resolution were
  printed to the console.
- Ran against `vercel/next.js#999999999` (does not exist). Result: an
  `ERROR` trace (`durationMs` 361, `error` set to the exact GitHub 404
  message), with exactly one span, `fetch-issue`, recorded as `ERROR`.
  `fetch-readme` and `analyze-issue` never ran, correctly: `fetchIssue`
  throwing inside the first `trace.span(...)` call stops the rest of the
  callback in `index.ts` from ever executing, which is exactly what
  should happen. The process exited non-zero.

Both runs confirm the design worked as intended: real success is
recorded completely, real failure is recorded accurately and stops
further (now-meaningless) work, and neither path silently swallowed
anything.

## Alternatives considered

- **OpenAI instead of Gemini.** Equally reasonable; Gemini was picked
  deliberately for this reference implementation, not because OpenAI
  would have been worse.
- **Nested sub-spans** (for example, a "retrieval" span containing both
  GitHub calls). Rejected for now: three flat sibling spans already
  demonstrate the trace/span model clearly, and nesting them for its own
  sake would add structure without adding a real reason for it to exist.
- **A GitHub personal access token**, for higher rate limits or private
  repo access. Rejected: unauthenticated public access is sufficient for
  a demo against a public repo, and avoids introducing a credential this
  agent has no real need for.
- **Running this in CI** as a smoke test. Rejected, see cost section
  above.

## Consequences

- Gain: a real, working, end-to-end integration of auth, project/API key
  scoping, ingestion, and the SDK, confirmed by actually running it, not
  just each piece tested in isolation.
- Give up: no automated test coverage of the actual GitHub/Gemini
  integration itself, only manual verification. Acceptable for a
  reference implementation, would not be acceptable for code other
  systems depend on. Also: no verified cost estimate for the current
  default model, `costUsd` will be empty until real pricing is confirmed
  and added to `pricing.ts`.
- Later: if a second reference agent or a different provider integration
  is ever added, the cost-estimation pattern (a small, explicit,
  per-model, documented-as-approximate price table) is the template to
  reuse, not something to rebuild from scratch.
