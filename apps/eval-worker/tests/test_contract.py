"""Loads the SAME two fixture files apps/api's own tests load
(contract.spec.ts, /contracts/README.md) and validates them against
this side's Pydantic models. Neither side shares a type system with
the other -- this is what actually catches drift, not just
documentation asserting the two sides agree."""

import json
from pathlib import Path

from app.schemas import EvaluationJudgment, EvaluationSnapshot

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"


def load_fixture(name: str) -> dict:
    with open(CONTRACTS_DIR / name) as f:
        return json.load(f)


def test_request_fixture_matches_evaluation_snapshot():
    fixture = load_fixture("evaluation-request.example.json")
    # Raises pydantic.ValidationError (failing the test) if the fixture
    # doesn't match this side's model.
    snapshot = EvaluationSnapshot(**fixture)
    assert snapshot.trace.name == fixture["trace"]["name"]
    assert len(snapshot.spans) == len(fixture["spans"])


def test_response_fixture_matches_evaluation_judgment():
    fixture = load_fixture("evaluation-response.example.json")
    judgment = EvaluationJudgment(**fixture)
    assert judgment.score == fixture["score"]
    assert judgment.evaluatorVersion == fixture["evaluatorVersion"]
