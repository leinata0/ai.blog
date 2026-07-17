"""Client IP resolution that does not blindly trust forwarded headers.

The like/comment/view anti-abuse limits all key off the caller's IP. If the
server trusts ``X-Forwarded-For`` / ``CF-Connecting-IP`` unconditionally, anyone
can send a random value per request and bypass every limit. Those headers are
only meaningful when the request actually arrived through a known reverse proxy
(Cloudflare -> Render here), so by default we ignore them and use the real
socket peer.

Operators should set ``TRUST_PROXY_HEADERS=1`` only when the reverse proxy
appends a trustworthy X-Forwarded-For entry. ``CF-Connecting-IP`` needs the
additional ``TRUST_CF_CONNECTING_IP=1`` opt-in and must only be enabled when
direct origin access is blocked. When proxy trust is unset, it auto-enables on
Render so the right-most XFF hop can be used instead of the internal socket peer.
"""

from __future__ import annotations

import ipaddress

from app.env import clean_env, env_truthy

# Header the deployment's trusted edge sets to the real client IP. Cloudflare
# uses CF-Connecting-IP; it is only trustworthy when proxy headers are trusted.
_CF_HEADER = "cf-connecting-ip"
_XFF_HEADER = "x-forwarded-for"

_UNKNOWN = "unknown"


def trust_proxy_headers() -> bool:
    """Whether forwarded IP headers should be honored.

    Precedence:
    1. Explicit ``TRUST_PROXY_HEADERS`` (truthy/falsy) always wins.
    2. When unset, auto-enable on Render so production rate limits key off the
       real client IP rather than the shared load-balancer peer.
    3. Otherwise fail closed (False).
    """
    raw = clean_env("TRUST_PROXY_HEADERS")
    if raw:
        return env_truthy("TRUST_PROXY_HEADERS", default=False)
    # Render terminates TLS and overwrites CF-Connecting-IP / X-Forwarded-For.
    if clean_env("RENDER") or clean_env("RENDER_SERVICE_ID"):
        return True
    return False


def trust_cf_connecting_ip() -> bool:
    """Trust Cloudflare's client-IP header only after origin access is restricted."""
    return env_truthy("TRUST_CF_CONNECTING_IP", default=False)


def _normalize_ip(value: str | None) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return ""


def _trusted_proxy_depth() -> int:
    """Number of trusted proxy hops in front of the app.

    X-Forwarded-For is appended to by each hop, so the right-most entries are the
    ones added by infrastructure you control. With ``depth`` trusted hops, the
    client IP is the entry ``depth`` positions from the right. Defaults to 1
    (a single trusted proxy, e.g. Render's load balancer or Cloudflare).
    """
    raw = clean_env("TRUSTED_PROXY_DEPTH")
    if not raw:
        return 1
    try:
        return max(1, int(raw))
    except ValueError:
        return 1


def resolve_client_ip(
    *,
    peer_ip: str | None,
    cf_connecting_ip: str | None = None,
    forwarded_for: str | None = None,
    trust_proxy: bool | None = None,
    trust_cf_header: bool | None = None,
    proxy_depth: int | None = None,
) -> str:
    """Resolve the client IP from the socket peer and optional forwarded headers.

    When proxy headers are not trusted, only ``peer_ip`` is used. When trusted,
    the X-Forwarded-For entry ``proxy_depth`` hops from the right is used.
    CF-Connecting-IP takes precedence only with its separate explicit opt-in.
    """
    trusted = trust_proxy_headers() if trust_proxy is None else trust_proxy
    peer = _normalize_ip(peer_ip)

    if not trusted:
        return peer or _UNKNOWN

    cf = _normalize_ip(cf_connecting_ip)
    cf_is_trusted = trust_cf_connecting_ip() if trust_cf_header is None else trust_cf_header
    if cf_is_trusted and cf:
        return cf

    forwarded = (forwarded_for or "").strip()
    if forwarded:
        # Each proxy appends the address it saw to the right. The client address
        # the trusted edge observed sits `depth` positions from the right.
        parts = [item.strip() for item in forwarded.split(",") if item.strip()]
        if parts:
            depth = _trusted_proxy_depth() if proxy_depth is None else proxy_depth
            index = len(parts) - depth
            if index < 0:
                index = 0
            forwarded_ip = _normalize_ip(parts[index])
            if forwarded_ip:
                return forwarded_ip

    return peer or _UNKNOWN


def client_ip_from_request(request) -> str:
    """Adapter that pulls the relevant fields off a Starlette/FastAPI request."""
    headers = request.headers
    peer_ip = request.client.host if request.client else ""
    return resolve_client_ip(
        peer_ip=peer_ip,
        cf_connecting_ip=headers.get(_CF_HEADER),
        forwarded_for=headers.get(_XFF_HEADER),
    )

