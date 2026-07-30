"""Startup-validated settings. Instantiating Settings() (via
get_settings(), called eagerly at module import in main.py) fails fast
with a clear error before uvicorn ever binds a port, mirroring
apps/api's main.ts validating CSRF_SECRET/EVAL_WORKER_SECRET before
app.listen(). See ADR-0016.
"""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Matches apps/api's EVAL_WORKER_SECRET validation (evaluation-worker.util.ts)
# exactly -- both sides of this shared secret enforce the same rule,
# since either service could be misconfigured independently.
MIN_SECRET_LENGTH = 32
KNOWN_PLACEHOLDER_VALUES = {"changeme", "change-me", "secret", "your-secret-here"}

DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    eval_worker_secret: str
    gemini_api_key: str
    gemini_model: str = DEFAULT_GEMINI_MODEL

    @field_validator("eval_worker_secret")
    @classmethod
    def validate_secret(cls, value: str) -> str:
        if not value:
            raise ValueError("EVAL_WORKER_SECRET is not set.")
        if value.lower() in KNOWN_PLACEHOLDER_VALUES:
            raise ValueError(
                "EVAL_WORKER_SECRET looks like a placeholder value, not a "
                "generated secret."
            )
        if len(value) < MIN_SECRET_LENGTH:
            raise ValueError(
                f"EVAL_WORKER_SECRET must be at least {MIN_SECRET_LENGTH} "
                "characters."
            )
        return value

    @field_validator("gemini_api_key")
    @classmethod
    def validate_gemini_api_key(cls, value: str) -> str:
        if not value:
            raise ValueError("GEMINI_API_KEY is not set.")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
