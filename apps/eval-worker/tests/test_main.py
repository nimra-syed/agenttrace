from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from app import main
from app.config import get_settings
from app.schemas import EvaluationJudgment
from tests.conftest import VALID_SECRET

SNAPSHOT_BODY = {
    "trace": {
        "name": "run",
        "agentName": "agent",
        "status": "SUCCESS",
        "input": None,
        "output": None,
        "error": None,
    },
    "spans": [],
    "truncated": False,
    "omittedSpanCount": 0,
}


def client_with_settings(test_settings) -> TestClient:
    main.app.dependency_overrides[get_settings] = lambda: test_settings
    return TestClient(main.app)


def test_health_does_not_require_the_internal_secret(test_settings):
    client = client_with_settings(test_settings)
    response = client.get("/health")
    assert response.status_code == 200


def test_evaluate_rejects_a_missing_secret(test_settings):
    client = client_with_settings(test_settings)
    response = client.post("/evaluate", json=SNAPSHOT_BODY)
    assert response.status_code == 401


def test_evaluate_rejects_the_wrong_secret(test_settings):
    client = client_with_settings(test_settings)
    response = client.post(
        "/evaluate",
        json=SNAPSHOT_BODY,
        headers={"X-Internal-Secret": "wrong-secret-value-32-characters"},
    )
    assert response.status_code == 401


def test_evaluate_returns_the_judgment_on_success(test_settings, mocker):
    mocker.patch(
        "app.main.judge.evaluate",
        return_value=EvaluationJudgment(
            score=4,
            rationale="Looks correct.",
            judgeModel="gemini-3-flash-preview",
            evaluatorVersion="judge-v1",
        ),
    )
    client = client_with_settings(test_settings)

    response = client.post(
        "/evaluate",
        json=SNAPSHOT_BODY,
        headers={"X-Internal-Secret": VALID_SECRET},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 4
    assert body["judgeModel"] == "gemini-3-flash-preview"
    assert body["evaluatorVersion"] == "judge-v1"


def test_evaluate_returns_502_when_the_judge_response_cannot_be_parsed(
    test_settings, mocker
):
    mocker.patch(
        "app.main.judge.evaluate",
        side_effect=ValueError("Judge response was not valid JSON: boom"),
    )
    client = client_with_settings(test_settings)

    response = client.post(
        "/evaluate",
        json=SNAPSHOT_BODY,
        headers={"X-Internal-Secret": VALID_SECRET},
    )

    assert response.status_code == 502
    # Sanitized: the underlying parse-failure detail (which could echo
    # evidence content) is never in the response body. See ADR-0016 and
    # app/main.py.
    assert "boom" not in response.text

def test_evaluate_returns_503_when_the_provider_is_unavailable(
    test_settings, mocker
):
    # A real, live-observed failure mode: Gemini returning 503
    # UNAVAILABLE under high demand. genai_errors.APIError (ServerError
    # is a subclass) is distinct from the ValueError case above -- this
    # is an upstream-availability problem, not a parse failure, so it
    # gets its own status code. See ADR-0016.
    mocker.patch(
        "app.main.judge.evaluate",
        side_effect=genai_errors.ServerError(
            503,
            {
                "error": {
                    "code": 503,
                    "message": "leak-marker: high demand, try again later",
                    "status": "UNAVAILABLE",
                }
            },
        ),
    )
    client = client_with_settings(test_settings)

    response = client.post(
        "/evaluate",
        json=SNAPSHOT_BODY,
        headers={"X-Internal-Secret": VALID_SECRET},
    )

    assert response.status_code == 503
    # Sanitized: the provider's own raw error body is never in the
    # response, since it's not something this service controls the
    # contents of. See ADR-0016 and app/main.py.
    assert "leak-marker" not in response.text


def test_evaluate_rejects_a_malformed_snapshot_body(test_settings):
    client = client_with_settings(test_settings)
    response = client.post(
        "/evaluate",
        json={"not": "a valid snapshot"},
        headers={"X-Internal-Secret": VALID_SECRET},
    )
    assert response.status_code == 422
