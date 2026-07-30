import os

VALID_SECRET = "a" * 32
VALID_API_KEY = "test-gemini-key"

# main.py calls get_settings() at module import time on purpose (fail
# fast before accepting traffic, ADR-0016) -- which means these env
# vars must exist before anything imports app.main, including this
# conftest's own later imports. Set before importing app.config/app.main
# at all, not inside a fixture (fixtures run too late, after collection
# has already imported test modules that import app.main).
os.environ.setdefault("EVAL_WORKER_SECRET", VALID_SECRET)
os.environ.setdefault("GEMINI_API_KEY", VALID_API_KEY)

import pytest

from app.config import Settings, get_settings


@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        eval_worker_secret=VALID_SECRET,
        gemini_api_key=VALID_API_KEY,
        gemini_model="gemini-3-flash-preview",
    )


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    # get_settings() is @lru_cache'd for production use (read env once);
    # tests need every test to see a fresh Settings() instance instead
    # of whatever the first test happened to cache.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
