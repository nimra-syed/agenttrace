# Contracts

Fixtures defining the wire shape of the internal `apps/api` <->
`apps/eval-worker` HTTP boundary (ADR-0016). This directory exists
specifically because those two services are implemented in different
languages (TypeScript, Python) with no shared type system — nothing
stops one side's model from silently drifting from the other's without
something that both sides' own test suites load and validate against.

- `evaluation-request.example.json` — a realistic `EvaluationSnapshot`,
  the bounded evidence payload `apps/api` POSTs to `apps/eval-worker`'s
  `/evaluate` endpoint.
- `evaluation-response.example.json` — a realistic `EvaluationJudgment`,
  what `/evaluate` returns.

`apps/api/src/evaluations/*.spec.ts` and `apps/eval-worker/tests/`
each load these same two files and validate them against their own
side's types (a TypeScript type guard on one side, a Pydantic model on
the other). If either side's shape changes without updating these
fixtures, or the fixtures change without updating both sides' models,
the corresponding test breaks — that's the point.

This is a deliberately lightweight alternative to a shared
OpenAPI/JSON-Schema-generated contract, appropriate for a boundary this
small (one endpoint). Worth revisiting if the eval-worker surface grows
beyond a single request/response pair.
