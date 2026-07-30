"""Verifies the shared internal secret apps/api sends on every request.
Not the same system as apps/api's own ApiKey or session/CSRF -- a
distinct, internal, service-to-service secret. See ADR-0016.
"""

import hmac

from fastapi import Depends, Header, HTTPException

from .config import Settings, get_settings


async def verify_internal_secret(
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
    settings: Settings = Depends(get_settings),
) -> None:
    # Constant-time comparison, matching the same discipline apps/api
    # uses for its own CSRF token comparison (crypto.timingSafeEqual,
    # ADR-0014) -- a secret-bearing comparison is exactly the kind of
    # thing timing attacks target.
    if x_internal_secret is None or not hmac.compare_digest(
        x_internal_secret, settings.eval_worker_secret
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing internal secret")
