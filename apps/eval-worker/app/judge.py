"""The judge: builds a prompt from a bounded evidence snapshot, asks
Gemini for a strict-JSON verdict, validates it. See ADR-0016.

EVALUATOR_VERSION identifies this specific combination of rubric text +
prompt-building logic + response-parsing logic, not just "which model
answered." Bump it manually whenever any of those change in a way that
would make a historical score not directly comparable to a new one --
apps/api stores this value on every EvalResult specifically so a past
score's provenance never depends on this file's current, possibly
different, content.
"""

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from .schemas import EvaluationJudgment, EvaluationSnapshot

EVALUATOR_VERSION = "judge-v1"

MIN_SCORE = 1
MAX_SCORE = 5

RUBRIC_INSTRUCTIONS = f"""You are evaluating an AI agent's execution based ONLY on the evidence provided below. Do not assume the agent took any action, or that any fact holds, that is not shown in this evidence. If the evidence appears incomplete or truncated, note this explicitly in your rationale rather than penalizing the agent for missing evidence you cannot see.

Score how successfully and correctly the agent completed the task described in the trace's input, on a scale of {MIN_SCORE} (completely failed) to {MAX_SCORE} (fully successful). Explain your reasoning in 1-3 sentences, grounded specifically in the evidence shown."""


class _JudgeOutput(BaseModel):
    """Internal only -- the schema Gemini is asked to produce. Distinct
    from EvaluationJudgment, which also carries judgeModel and
    evaluatorVersion, neither of which the model itself should be
    asked to supply."""

    score: int
    rationale: str


def build_prompt(snapshot: EvaluationSnapshot) -> str:
    lines = [
        RUBRIC_INSTRUCTIONS,
        "",
        "## Trace",
        f"Name: {snapshot.trace.name}",
        f"Agent: {snapshot.trace.agentName}",
        f"Status: {snapshot.trace.status}",
    ]
    if snapshot.trace.input is not None:
        lines.append(f"Input: {snapshot.trace.input}")
    if snapshot.trace.output is not None:
        lines.append(f"Output: {snapshot.trace.output}")
    if snapshot.trace.error is not None:
        lines.append(f"Error: {snapshot.trace.error}")

    if snapshot.spans:
        lines.append("")
        lines.append("## Spans (chronological)")
        for span in snapshot.spans:
            lines.append(f"- {span.name} ({span.type}, {span.status})")
            if span.input is not None:
                lines.append(f"  input: {span.input}")
            if span.output is not None:
                lines.append(f"  output: {span.output}")
            if span.error is not None:
                lines.append(f"  error: {span.error}")

    if snapshot.truncated:
        lines.append("")
        lines.append(
            f"Note: this evidence was truncated ({snapshot.omittedSpanCount} "
            "span(s) omitted and/or some fields shortened). Judge only what "
            "is shown; do not treat missing evidence as evidence of failure."
        )

    return "\n".join(lines)


def parse_judgment(raw_text: str, model: str) -> EvaluationJudgment:
    try:
        output = _JudgeOutput.model_validate_json(raw_text)
    except ValidationError as exc:
        raise ValueError(
            f"Judge response was not valid JSON in the expected shape: {exc}"
        ) from exc

    if not MIN_SCORE <= output.score <= MAX_SCORE:
        raise ValueError(f"Judge returned an out-of-range score: {output.score}")

    return EvaluationJudgment(
        score=output.score,
        rationale=output.rationale,
        judgeModel=model,
        evaluatorVersion=EVALUATOR_VERSION,
    )


def evaluate(
    snapshot: EvaluationSnapshot, *, api_key: str, model: str
) -> EvaluationJudgment:
    client = genai.Client(api_key=api_key)
    prompt = build_prompt(snapshot)

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_JudgeOutput,
        ),
    )

    return parse_judgment(response.text or "", model)
