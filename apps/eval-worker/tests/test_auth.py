import pytest
from fastapi import HTTPException

from app.auth import verify_internal_secret
from tests.conftest import VALID_SECRET


async def _call(header_value: str | None, settings) -> None:
    await verify_internal_secret(x_internal_secret=header_value, settings=settings)


@pytest.mark.asyncio
async def test_accepts_the_correct_secret(test_settings):
    await _call(VALID_SECRET, test_settings)  # does not raise


@pytest.mark.asyncio
async def test_rejects_a_missing_header(test_settings):
    with pytest.raises(HTTPException) as exc_info:
        await _call(None, test_settings)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_the_wrong_secret(test_settings):
    with pytest.raises(HTTPException) as exc_info:
        await _call("not-the-right-secret-but-32-chars", test_settings)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_an_empty_string_header(test_settings):
    with pytest.raises(HTTPException) as exc_info:
        await _call("", test_settings)
    assert exc_info.value.status_code == 401
