# ADR-0016: LLM-as-judge evaluation worker

Status: Accepted

## Context

AgentTrace's stated purpose is observability and evaluation. Through
M11 only the observability half existed (traces, spans, the dashboard).
M12 adds the first slice of evaluation: a way to ask an LLM to score a
recorded trace, using the trace's own recorded evidence.

The first design question was where this logic should live. Two options:
inside `apps/api` directly, or as a separate service. Implementing it
directly in `apps/api` would have shipped faster, but the evaluation
engine is a distinct responsibility from the main request-serving API,
is likely to grow independently (different libraries, different
languages, possibly its own scaling characteristics), and keeping
long-running LLM work isolated from the request-serving API better
reflects how this actually looks in production systems. The decision was
to build a separate Python/FastAPI worker (`apps/eval-worker`) from the
start, deliberately kept small for this first slice: one endpoint, one
Gemini integration, one rubric, no queues or background infrastructure.

## Decision

### Service boundary

`apps/eval-worker` is stateless and never touches Postgres. `apps/api`
owns authentication, authorization, trace/span data, and persistence; it
calls `apps/eval-worker` over a single internal HTTP endpoint
(`POST /evaluate`) and persists the result itself. This keeps exactly one
service talking to the database, matching every other design decision in
this project that defers distributed infrastructure until there's a
concrete need (see the top-level architecture overview).

### Internal authentication: a distinct shared secret

`apps/api` and `apps/eval-worker` share a secret (`EVAL_WORKER_SECRET`),
sent as an `X-Internal-Secret` header on every request and checked with a
constant-time comparison (`crypto.timingSafeEqual` on the Node side,
`hmac.compare_digest` on the Python side), the same discipline as
`CsrfGuard`'s token comparison (ADR-0014). This is a genuinely separate
secret from `CSRF_SECRET` and from user-facing API keys (ADR-0007): it
authenticates one internal service to another, not a browser session or
an external caller, and rotating it never needs to affect either of
those systems.

### Bounded evidence snapshot

Sending only a trace's own top-level input/output isn't enough evidence
for a meaningful judgment. The judge also needs to see what the agent's
spans actually did. But an unbounded snapshot (every span, full
payloads) is both a cost risk (prompt size) and an availability risk (a
single pathological trace could make every evaluation slow or
expensive). `buildEvaluationSnapshot()` (`evaluation-snapshot.builder.ts`)
bounds this explicitly:

- At most `MAX_SPANS = 20` spans, ordered deterministically
  (`startedAt asc, id asc`, the same convention as the trace detail
  view's waterfall, ADR-0013), with any spans beyond that count dropped
  and counted in `omittedSpanCount`.
- Each input/output/error field (trace-level and per-span) is
  pre-serialized to a plain string and truncated at `MAX_FIELD_CHARS =
  2000` characters.
- A final backstop, `MAX_TOTAL_SNAPSHOT_CHARS = 20000`, drops trailing
  (lowest-priority) spans if the snapshot is still too large after
  per-field truncation.

Truncated fields are never re-parsed as JSON on the receiving side.
Truncating a JSON string at the character level can produce invalid
JSON mid-structure, so every field is treated as opaque text throughout
the whole pipeline, prompt included.

The rubric itself (`RUBRIC_INSTRUCTIONS`, `app/judge.py`) is worded so
the judge scores only what it's shown: "based ONLY on the evidence
provided... do not assume... If the evidence appears incomplete or
truncated, note this explicitly." This matters because the snapshot is
deliberately incomplete by construction, so the rubric has to account
for that, not just the code.

### Reproducibility: `evaluatorVersion` plus a stored, exact snapshot

`judgeModel` alone can't explain a historical score months later. The
rubric text, prompt-building logic, and response-parsing logic can all
change independently of which model answered. `EVALUATOR_VERSION`
(`"judge-v1"`, `app/judge.py`) identifies that specific combination, and
is stored on every `EvalResult` row alongside the exact bounded
`evaluationInput` snapshot that was actually sent, not a
reconstruction of it. A past score's provenance never depends on
`judge.py`'s current content.

`EvalResult` rows are append-only: re-evaluating a trace creates a new
row rather than overwriting the last one. This was live-verified to
matter, not just theorized. Two live evaluations of the same trace
produced genuinely different scores (a `2` and a `5`) from real LLM
non-determinism, and both are preserved.

### Cost-containment throttle, keyed on user and project

`POST /evaluate` triggers a real, paid LLM call, so the goal here is
cost containment, not brute-force prevention (contrast with
`AuthThrottlerGuard`, ADR-0014). `EvaluationThrottlerGuard` (extending
`@nestjs/throttler`'s `ThrottlerGuard`, overriding `getTracker`) keys on
`` `${userId}:${projectId}` ``, not email or IP: one person hammering
"Evaluate" on one project gets a `429`, without affecting anyone else or
that same person's work in a different project. Configured as
`{ limit: 10, ttl: 60000 }`, registered under the name `'evaluate'` in
the same central `ThrottlerModule.forRoot()` call as `'auth'`
(ADR-0014), one call, both named configs, since `ThrottlerModule` is
`@Global()` and a second `forRoot()` call risks one registration
silently shadowing another.

#### A real bug: named throttlers are cumulative, not scoped, by default

While live-testing this throttle (deliberately spending a few real
Gemini calls specifically to verify a real architectural fix, not
theorize about it), the limit engaged after **5** requests, not 10, and
separately, five of those requests returned `500`, not a working
evaluation.

The `500`s turned out to be unrelated: real `503 UNAVAILABLE` responses
from Gemini itself under load from firing many requests in a burst, not
a code bug (see the error-boundary section below for how this is now
handled properly).

The throttle count was a real bug. Reading `ThrottlerGuard.canActivate`
(`@nestjs/throttler`'s own source, not assumed from documentation)
showed it loops over every named throttler registered in
`ThrottlerModule.forRoot()`, `'auth'` and `'evaluate'` both, for any
route guarded by a `ThrottlerGuard` subclass, checking each one's
metadata (`@Throttle()`/`@SkipThrottle()`) independently, and enforcing
whichever one trips first. A route's own `@Throttle({evaluate: {...}})`
only supplies that one named config's limit/ttl; it does not exempt the
route from every other registered named throttler, which falls back
to that throttler's own default (`'auth'`'s `limit: 5`). This is why the
evaluate route was silently also being checked against `limit: 5`.
Symmetrically (confirmed by the same read, not just inferred), the
`login`/`signup` routes were, and until this fix, still were as of that
testing, silently also being checked against `'evaluate'`'s `limit: 10`,
invisible only because `5 < 10` meant `'auth'` always tripped first.

Fixed with `@SkipThrottle()`, which the same source shows sets
per-name metadata a route can use to opt a specific named throttler back
out: `@SkipThrottle({ auth: true })` on the evaluate route, and
`@SkipThrottle({ evaluate: true })` on `signup`/`login`. Each route is
now checked only against its own intended limit.

The general rule this leaves for future work: any time a new named
throttler is added to the shared `ThrottlerModule.forRoot()` config,
every other route already guarded by a `ThrottlerGuard` subclass needs
a `@SkipThrottle()` entry for the new name, or it will silently also be
subject to that new limit. This does not self-document at the call
site (`@Throttle()` reads as "this route's limit is X," not "this route
is only subject to limit X"). A regression test
(`throttler-scoping.integration.spec.ts`) boots a real Nest app with both
named configs and asserts each route's actual, isolated threshold, so
this class of bug fails a test the next time a third named throttler is
added, rather than only surfacing in a live burst-test again.

### Strict timeout, no automatic retry

`EVAL_WORKER_TIMEOUT_MS = 30_000` (`AbortSignal.timeout()`), generous
enough for a real Gemini call including network latency, but bounded so
a hung request can't tie up a NestJS request indefinitely or leave the
dashboard user waiting forever.

The request to `apps/eval-worker` is never automatically retried.
Retrying a request that triggers a real, paid LLM call risks a duplicate
charge if the original call actually succeeded but the response was
merely slow or lost in transit. A human re-clicking "Evaluate" is an
intentional retry; the client silently doing one on the caller's behalf
is not, and this project has no idempotency-key mechanism on this
endpoint to make a silent retry safe.

### Error boundary: distinct, controlled statuses instead of one undifferentiated 500

Every failure mode `EvaluationWorkerClient.evaluate()` can hit is mapped
to a distinct, deliberately generic HTTP status, so a caller (today,
`apps/api`'s own controller; eventually the frontend) can tell "try
again later" apart from "this is broken" apart from "our own
misconfiguration":

| Failure | Detected where | Client-visible result |
|---|---|---|
| Request times out (`AbortSignal.timeout()`) | `fetch` throws a `DOMException` named `TimeoutError` (confirmed empirically against this project's Node version, not assumed from the spec) | `504 Gateway Timeout` |
| Worker unreachable (connection refused, DNS failure, etc) | `fetch` throws (any other error, typically a `TypeError`) | `503 Service Unavailable` |
| Gemini/provider itself failed (rate limited, overloaded, any `google.genai.errors.APIError`) | `apps/eval-worker` catches `APIError` around the `judge.evaluate()` call and returns its own `503` | `apps/api` propagates as `503 Service Unavailable` |
| Judge's response couldn't be parsed/validated (existing since the initial implementation) | `apps/eval-worker` catches `ValueError` and returns its own `502` | `apps/api` propagates as `502 Bad Gateway` |
| Worker returned `200` but the body doesn't match the wire contract (`isEvaluationJudgment` fails) | `apps/api`'s own type guard | `502 Bad Gateway` |
| Internal secret mismatch between the two services | `apps/eval-worker`'s `verify_internal_secret` returns `401` | `apps/api` propagates as a plain `500 Internal Server Error`. This is a misconfiguration on our own side, not a transient or provider problem, so it deliberately does not get one of the provider-facing codes above. |
| Any other unrecognized non-2xx status | n/a | `500 Internal Server Error` (fallback) |

Every one of these thrown messages is a static string, never built from
`error.message`, `response.status`, or a response body. This is checked
directly by tests on both sides (`evaluation-worker.client.spec.ts`;
`test_main.py`'s `test_evaluate_returns_...` tests assert specific
strings are not present in the response body), not just asserted in
prose:

- The Node-side network-error branch only reads `error.name` (`'Error'`,
  `'TimeoutError'`, etc), the same discipline as the SDK's own error
  handling (ADR-0009). Application data in trace/span input/output can
  contain secrets or private data, and an exception's `.message` is not
  guaranteed not to echo some of it.
- `apps/eval-worker`'s own `HTTPException` bodies (`app/main.py`) are
  hand-written, generic strings, never `str(exc)`, for the same
  reason: a malformed judge response, or a raw provider error body, can
  in principle contain fragments of the evidence that was sent to it.
- The shared internal secret is never included in any thrown message on
  either side, in either the success or failure path.

### Startup validation on both sides

Both `EVAL_WORKER_SECRET` (on both services) and `GEMINI_API_KEY` (on
`apps/eval-worker`) are validated before either process accepts traffic.
`apps/api`'s `main.ts` calls `validateEvalWorkerSecret`/
`validateEvalWorkerUrl` alongside its existing `CSRF_SECRET` check
(ADR-0014) before `app.listen()`; `apps/eval-worker`'s `main.py` calls
`get_settings()` eagerly at module import time, before FastAPI/uvicorn
ever binds a port. Same fail-fast discipline in both languages: a
missing or placeholder secret crashes the process immediately with a
clear message, rather than surfacing a confusing failure on the first
real request.

### Contract testing across languages

A `/contracts/` directory at the repo root holds two JSON fixtures
(`evaluation-request.example.json`, `evaluation-response.example.json`)
that both `apps/api` (`contract.spec.ts`, via the exported
`isEvaluationSnapshot`/`isEvaluationJudgment` type guards) and
`apps/eval-worker` (`test_contract.py`, via Pydantic model validation)
load and validate. TypeScript and Python's type systems can't check each
other, so this is the actual mechanism that catches drift between the
two independently-implemented sides of the wire contract, an assertion
in one language's test suite about a fixture the other language's test
suite also depends on.

## Alternatives considered

- **Implementing evaluation logic directly in `apps/api`.** Would have
  shipped faster, but rejected in favor of a separate service, see
  Context above.
- **Automatic retry on a failed worker call.** Rejected: risks a
  duplicate paid charge with no idempotency mechanism to make it safe.
- **A per-feature-module `ThrottlerModule.forRoot()` call for the
  `'evaluate'` config**, mirroring how the config was first sketched.
  Rejected after confirming `ThrottlerModule` is `@Global()`, since a
  second `forRoot()` call risks one registration silently shadowing the
  other. Consolidated into one call in `AppModule` instead, which is
  what surfaced the cumulative-throttler behavior described above.
- **Letting every non-2xx worker response collapse to a single 500.**
  Rejected in favor of the distinct 502/503/504 mapping above,
  specifically so a provider-availability problem doesn't look
  identical to a real internal bug.

## Consequences

- Gain: a genuinely separate, stateless evaluation service that can grow
  its own dependencies (Python-native evaluation libraries, later
  milestones) without touching `apps/api`'s runtime.
- Gain: every evaluation is reproducible from its own stored snapshot
  and `evaluatorVersion`, independent of whether the rubric or prompt
  logic later changes.
- Gain: a caller can distinguish "the provider is temporarily
  unavailable, try again" from "something is actually broken" from "our
  two services' secrets don't match," instead of one undifferentiated
  500 for all three.
- Gain: the cumulative-named-throttler behavior is now a known, tested
  fact about this codebase (not just about `@nestjs/throttler` in the
  abstract). The next named throttler added anywhere has a concrete
  regression test and this ADR to check against.
- Give up (accepted, documented debt, not fixed in this milestone): if
  the paid Gemini call succeeds but the subsequent `prisma.evalResult.create()`
  write fails (a transient DB error, the process crashing mid-request),
  the result is lost, not persisted, not shown, and not automatically
  retried (per the no-retry decision above). A person can just click
  "Evaluate" again. Fixing this properly needs a queue or outbox
  pattern, deliberately deferred, same reasoning as every other
  distributed-infrastructure decision in this project.
- Give up: `@nestjs/throttler`'s process-local storage (ADR-0014's
  existing limitation) now applies to the `'evaluate'` throttler too. If
  `apps/api` ever runs as more than one instance, the real
  per-(user, project) cost-containment limit is multiplied by the
  instance count.
