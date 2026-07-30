"""Wire-format models for the apps/api <-> apps/eval-worker boundary.

Field names deliberately match the TypeScript side's camelCase exactly
(agentName, omittedSpanCount, judgeModel, evaluatorVersion), not
Python's usual snake_case -- this is a wire contract with another
language, not internal Python code, and keeping the field names
identical avoids needing alias mapping in either direction. See
ADR-0016 and /contracts/.
"""

from pydantic import BaseModel


class SpanEvidence(BaseModel):
    name: str
    type: str
    status: str
    input: str | None = None
    output: str | None = None
    error: str | None = None


class TraceEvidence(BaseModel):
    name: str
    agentName: str
    status: str
    input: str | None = None
    output: str | None = None
    error: str | None = None


class EvaluationSnapshot(BaseModel):
    """The bounded evidence apps/api sends. apps/api owns truncation
    (span count, per-field size, total size); this side trusts the
    snapshot it receives is already bounded rather than re-checking,
    since apps/api is the only caller and re-deriving the same limits
    here would just be a second place for them to drift apart."""

    trace: TraceEvidence
    spans: list[SpanEvidence]
    truncated: bool
    omittedSpanCount: int


class EvaluationJudgment(BaseModel):
    score: int
    rationale: str
    judgeModel: str
    evaluatorVersion: str
