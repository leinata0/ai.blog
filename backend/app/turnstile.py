"""Cloudflare Turnstile verification for register/login.

When TURNSTILE_SECRET_KEY isn't configured, turnstile_ready() is False and
callers skip verification entirely — so local/dev and unconfigured deployments
keep working. Enabling protection is purely a matter of setting the env var.
"""
from __future__ import annotations

import logging

import httpx

from app.env import clean_env

logger = logging.getLogger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def turnstile_ready() -> bool:
    return bool(clean_env("TURNSTILE_SECRET_KEY"))


def verify_turnstile(token: str | None, remote_ip: str | None = None) -> bool:
    secret = clean_env("TURNSTILE_SECRET_KEY")
    if not secret:
        # Not configured → treat as pass (caller gates on turnstile_ready()).
        return True
    if not token:
        return False
    payload = {"secret": secret, "response": token}
    if remote_ip and remote_ip != "unknown":
        payload["remoteip"] = remote_ip
    try:
        response = httpx.post(SITEVERIFY_URL, data=payload, timeout=10)
        response.raise_for_status()
        return bool(response.json().get("success"))
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Turnstile verification failed: %s", exc)
        return False
