import os

from slowapi import Limiter

from app.client_ip import client_ip_from_request

# Disable rate limiting in test environment
is_test = os.environ.get("APP_ENV") == "test" or os.environ.get("PYTEST_CURRENT_TEST")


def _rate_limit_key(request) -> str:
    """Key rate limits off the resolved client IP rather than the socket peer.

    slowapi's default ``get_remote_address`` uses ``request.client.host``. Behind
    Cloudflare -> Render that is the edge's egress IP, identical for every visitor,
    so a per-IP limit like login's ``5/minute`` would be shared by the whole world
    (false lockouts) while a distributed attacker still bypasses it. Reuse the same
    trust-aware resolution the anti-abuse limits use so the key reflects the real
    caller when (and only when) proxy headers are trusted.
    """
    return client_ip_from_request(request)


limiter = Limiter(
    key_func=_rate_limit_key,
    # No default_limits: a global limit only takes effect with SlowAPIMiddleware
    # wired in, and keyed on the (untrusted) peer IP that would be Cloudflare's
    # shared egress address — locking out the whole site at once. Apply limits
    # explicitly per route (e.g. login) where the key semantics are understood.
    enabled=not is_test,
)
