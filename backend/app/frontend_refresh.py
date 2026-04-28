import logging
from datetime import datetime, timezone

import httpx

from app.env import clean_env

logger = logging.getLogger("blog.frontend_refresh")


def trigger_frontend_refresh(*, event: str, payload: dict | None = None) -> bool:
    hook_url = clean_env("VERCEL_DEPLOY_HOOK_URL")
    if not hook_url:
        return False

    body = {
        "event": event,
        "source": "backend",
        "triggered_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload:
        body.update(payload)

    response = httpx.post(
        hook_url,
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=15.0,
        follow_redirects=True,
    )
    if not response.is_success:
        raise RuntimeError(f"frontend refresh hook failed with {response.status_code}")

    return True


def trigger_frontend_refresh_safe(*, event: str, payload: dict | None = None) -> bool:
    hook_url = clean_env("VERCEL_DEPLOY_HOOK_URL")
    if not hook_url:
        return False

    try:
        trigger_frontend_refresh(event=event, payload=payload)
        logger.info("frontend_refresh event=%s status=triggered", event)
        return True
    except Exception as exc:
        logger.warning("frontend_refresh event=%s status=failed detail=%s", event, exc)
        return False
