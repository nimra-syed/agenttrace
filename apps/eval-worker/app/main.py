"""apps/eval-worker: a stateless LLM-as-judge service. It never touches
Postgres -- apps/api owns authorization, the trace/span data, and
persistence; this service only scores the bounded evidence it's given
and hands back a verdict. See ADR-0016.
"""

from fastapi import Depends, FastAPI, HTTPException
from google.genai import errors as genai_errors

from . import judge
from .auth import verify_internal_secret
from .config import Settings, get_settings

# Importing get_settings() eagerly here (not lazily inside a route)
# means a missing/invalid EVAL_WORKER_SECRET or GEMINI_API_KEY fails
# fast, before this app ever accepts a request -- mirroring apps/api's
# main.ts validating its own secrets before app.listen(). See ADR-0016.
get_settings()

app = FastAPI(title="AgentTrace Evaluation Worker")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/evaluate", dependencies=[Depends(verify_internal_secret)])
async def evaluate(
    snapshot: judge.EvaluationSnapshot,
    settings: Settings = Depends(get_settings),
) -> judge.EvaluationJudgment:
    try:
        return judge.evaluate(
            snapshot,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
        )
    except genai_errors.APIError as exc:
        # Any failure calling Gemini itself -- rate limited, temporarily
        # overloaded (a real, live-observed case: 503 UNAVAILABLE "high
        # demand"), or any other provider-side error -- covers both
        # ServerError and ClientError, since both mean the same thing
        # from this service's perspective: it depended on an upstream
        # that didn't cooperate, not our own bug. Surfaced as 503, not
        # 500, so apps/api (and eventually the browser) can tell "the
        # provider is having trouble, try again later" apart from a real
        # internal error. Detail is deliberately generic, not str(exc):
        # APIError carries the provider's raw response body, which is
        # not something this service controls the contents of. See
        # ADR-0016.
        raise HTTPException(
            status_code=503,
            detail="The evaluation provider is temporarily unavailable.",
        ) from exc
    except ValueError as exc:
        # The judge's own response didn't parse/validate -- a real,
        # if hopefully rare, failure mode distinct from a network or
        # auth problem. Surfaced as a client-visible 502 (this service
        # depended on an upstream -- Gemini -- that misbehaved), not a
        # 500, so apps/api's own error handling can tell the difference
        # if it ever needs to.
        #
        # Detail is deliberately generic, not str(exc): a malformed
        # judge response can, in principle, echo fragments of the
        # evidence it was given (trace/span input/output can contain
        # secrets or private data), so the exact parse failure is not
        # returned in the response body. Same sanitized-error discipline
        # as apps/api's own EvaluationWorkerClient. See ADR-0016.
        raise HTTPException(
            status_code=502,
            detail="The evaluation model returned a response that could not be parsed.",
        ) from exc
