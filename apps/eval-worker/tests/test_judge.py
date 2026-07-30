import json

import pytest

from app.judge import EVALUATOR_VERSION, build_prompt, parse_judgment
from app.schemas import EvaluationSnapshot, SpanEvidence, TraceEvidence


def fake_snapshot(**overrides) -> EvaluationSnapshot:
    defaults = {
        "trace": TraceEvidence(
            name="run",
            agentName="agent",
            status="SUCCESS",
            input="the question",
            output="the answer",
            error=None,
        ),
        "spans": [],
        "truncated": False,
        "omittedSpanCount": 0,
    }
    defaults.update(overrides)
    return EvaluationSnapshot(**defaults)


class TestBuildPrompt:
    def test_includes_trace_fields(self):
        prompt = build_prompt(fake_snapshot())
        assert "run" in prompt
        assert "agent" in prompt
        assert "the question" in prompt
        assert "the answer" in prompt

    def test_includes_span_evidence_in_order(self):
        snapshot = fake_snapshot(
            spans=[
                SpanEvidence(
                    name="fetch-issue",
                    type="TOOL",
                    status="SUCCESS",
                    input=None,
                    output="issue body",
                    error=None,
                ),
                SpanEvidence(
                    name="call-llm",
                    type="LLM",
                    status="SUCCESS",
                    input="prompt text",
                    output="model output",
                    error=None,
                ),
            ]
        )
        prompt = build_prompt(snapshot)
        assert prompt.index("fetch-issue") < prompt.index("call-llm")
        assert "issue body" in prompt
        assert "prompt text" in prompt

    def test_notes_truncation_explicitly_when_present(self):
        snapshot = fake_snapshot(truncated=True, omittedSpanCount=3)
        prompt = build_prompt(snapshot)
        assert "truncated" in prompt.lower()
        assert "3" in prompt

    def test_says_nothing_about_truncation_when_not_truncated(self):
        prompt = build_prompt(fake_snapshot(truncated=False, omittedSpanCount=0))
        assert "omitted" not in prompt.lower()

    def test_instructs_the_judge_to_rely_only_on_supplied_evidence(self):
        # The rubric-phrasing requirement from the architecture revision:
        # the judge must be told explicitly not to assume anything
        # beyond what's shown. See ADR-0016.
        prompt = build_prompt(fake_snapshot())
        assert "ONLY" in prompt
        assert "not shown" in prompt or "not assume" in prompt.lower()

    def test_omits_none_fields_rather_than_printing_them(self):
        snapshot = fake_snapshot(
            trace=TraceEvidence(
                name="run", agentName="agent", status="SUCCESS", error=None
            )
        )
        prompt = build_prompt(snapshot)
        assert "None" not in prompt


class TestParseJudgment:
    def test_parses_a_well_formed_response(self):
        raw = json.dumps({"score": 4, "rationale": "Did the job."})
        judgment = parse_judgment(raw, model="gemini-3-flash-preview")

        assert judgment.score == 4
        assert judgment.rationale == "Did the job."
        assert judgment.judgeModel == "gemini-3-flash-preview"
        assert judgment.evaluatorVersion == EVALUATOR_VERSION

    def test_rejects_malformed_json(self):
        with pytest.raises(ValueError, match="not valid JSON"):
            parse_judgment("not json at all", model="m")

    def test_rejects_a_response_missing_required_fields(self):
        with pytest.raises(ValueError, match="not valid JSON"):
            parse_judgment(json.dumps({"score": 4}), model="m")

    def test_rejects_an_out_of_range_score(self):
        raw = json.dumps({"score": 9, "rationale": "x"})
        with pytest.raises(ValueError, match="out-of-range"):
            parse_judgment(raw, model="m")

    def test_rejects_a_score_below_the_minimum(self):
        raw = json.dumps({"score": 0, "rationale": "x"})
        with pytest.raises(ValueError, match="out-of-range"):
            parse_judgment(raw, model="m")
