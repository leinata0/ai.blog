"""Client IP resolution that does not blindly trust forwarded headers.

The like/comment/view anti-abuse limits and every slowapi rate limit key off the
caller's IP. If the server trusts ``X-Forwarded-For`` / ``CF-Connecting-IP``
unconditionally, anyone can send a random value per request and bypass every
limit. Those headers are only meaningful when the request actually arrived
through a known reverse proxy (Cloudflare -> Render here), so by default we
ignore them and use the real socket peer.

Operators should set ``TRUST_PROXY_HEADERS=1`` only when the reverse proxy
appends a trustworthy X-Forwarded-For entry. ``CF-Connecting-IP`` needs the
additional ``TRUST_CF_CONNECTING_IP=1`` opt-in and must only be enabled when
direct origin access is blocked. When proxy trust is unset, it auto-enables on
Render so the right-most XFF hop can be used instead of the internal socket peer.

Calibrating ``TRUSTED_PROXY_DEPTH``
-----------------------------------
Each hop *appends* the address it saw, so the chain grows left-to-right and only
the right-most entries are trustworthy. ``TRUSTED_PROXY_DEPTH`` must equal the
number of appending hops in front of the app; the client IP is then the entry
that many positions from the right.

Getting this wrong is silent and expensive. With ``Cloudflare -> Render`` the app
receives ``client, cloudflare_egress`` (two appending hops), so ``depth=1``
resolves the *Cloudflare egress IP* — identical for every visitor. Every per-IP
limit then shares one counter: one user tripping ``/api/admin/login`` (5/minute),
``/api/users/login`` (5/minute) or ``/proxy-image`` (30/minute) locks out the
whole site, and the anonymous-like ``UNIQUE(post_id, ip_address)`` dedupe
collapses to a single global "visitor".

To calibrate against the real deployment:

1. Deploy and let normal traffic run. The first request logs, at INFO on the
   ``blog.client_ip`` logger, the full ``X-Forwarded-For`` chain, the socket
   peer, the resolved client IP and the configured depth. No other headers are
   logged — the addresses themselves are the operational signal.
2. Read ``suggested_depth`` from that log line, or call the authenticated
   ``GET /api/admin/diagnostics/client-ip`` endpoint, which returns this
   module's ``client_ip_diagnostics()`` snapshot plus a ``recommendation``
   naming the next action. It is the *minimum* chain length observed. Clients
   can only ever prepend forged entries on the left, so the shortest chain seen
   equals the number of real appending hops.
3. If ``suggested_depth`` differs from ``TRUSTED_PROXY_DEPTH``, a WARNING is
   emitted once and the value should be updated in ``render.yaml``.
4. ``distinct_resolved_ips == 1`` after a meaningful number of requests is the
   direct symptom of the collapse described above and also warns once.

Set ``CLIENT_IP_CHAIN_LOG=always`` to log the chain for every request while
calibrating (verbose — turn it back off afterwards), or ``=off`` to silence it.

The more reliable option, once the origin is locked down to Cloudflare traffic
only, is ``TRUST_CF_CONNECTING_IP=1``: ``CF-Connecting-IP`` is a single value
Cloudflare overwrites on every request, so it needs no depth arithmetic and
cannot be lengthened by a client. Prefer it over tuning ``TRUSTED_PROXY_DEPTH``
whenever direct origin access is blocked.
"""

from __future__ import annotations

import ipaddress
import logging
import threading

from app.env import clean_env, env_truthy

logger = logging.getLogger("blog.client_ip")

# Header the deployment's trusted edge sets to the real client IP. Cloudflare
# uses CF-Connecting-IP; it is only trustworthy when proxy headers are trusted.
_CF_HEADER = "cf-connecting-ip"
_XFF_HEADER = "x-forwarded-for"

_UNKNOWN = "unknown"

# Enough requests that "every visitor resolved to the same IP" is a signal rather
# than a quiet afternoon, while still surfacing early in a deploy.
_DIAGNOSTIC_SAMPLE_TARGET = 50
# Bound on remembered addresses so diagnostics can never grow with traffic.
_DIAGNOSTIC_IP_CAP = 64
# Chain lengths are histogrammed exactly up to this many hops and bucketed above
# it. A client can prepend an unbounded number of forged entries, so the number
# of distinct buckets must not follow attacker input.
_CHAIN_LENGTH_HISTOGRAM_MAX = 8

# Verdicts that mean the deployment is currently mis-keying its per-IP limits.
_ACTION_REQUIRED_VERDICTS = frozenset({"depth_mismatch", "collapsed"})


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

    See the module docstring for how to verify this matches the real chain.
    """
    raw = clean_env("TRUSTED_PROXY_DEPTH")
    if not raw:
        return 1
    try:
        return max(1, int(raw))
    except ValueError:
        return 1


def split_forwarded_for(forwarded_for: str | None) -> list[str]:
    """Non-empty, whitespace-trimmed X-Forwarded-For entries, left to right."""
    return [item.strip() for item in (forwarded_for or "").split(",") if item.strip()]


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

    parts = split_forwarded_for(forwarded_for)
    if parts:
        # Each proxy appends the address it saw to the right. The client address
        # the trusted edge observed sits `depth` positions from the right.
        depth = _trusted_proxy_depth() if proxy_depth is None else proxy_depth
        index = len(parts) - depth
        if index < 0:
            index = 0
        forwarded_ip = _normalize_ip(parts[index])
        if forwarded_ip:
            return forwarded_ip

    return peer or _UNKNOWN


# --------------------------------------------------------------------------- #
# Depth calibration diagnostics
#
# Whether Render appends to or overwrites X-Forwarded-For cannot be determined
# from the code, so instead of guessing a depth we make the real chain
# observable. Everything below is bounded (fixed sample budget, capped IP set)
# and short-circuits once it has answered, so the hot path pays a boolean read.
# --------------------------------------------------------------------------- #

_diag_lock = threading.Lock()
_diag_observations = 0
_diag_min_chain: int | None = None
_diag_max_chain: int | None = None
_diag_resolved_ips: set[str] = set()
_diag_chain_lengths: dict[int, int] = {}
_diag_first_logged = False
_diag_verdict_logged = False


def reset_client_ip_diagnostics() -> None:
    """Clear collected samples (used by tests; safe to call at runtime)."""
    global _diag_observations, _diag_min_chain, _diag_max_chain
    global _diag_first_logged, _diag_verdict_logged
    with _diag_lock:
        _diag_observations = 0
        _diag_min_chain = None
        _diag_max_chain = None
        _diag_resolved_ips.clear()
        _diag_chain_lengths.clear()
        _diag_first_logged = False
        _diag_verdict_logged = False


def _chain_log_mode() -> str:
    """``once`` (default), ``always`` while calibrating, or ``off``."""
    mode = clean_env("CLIENT_IP_CHAIN_LOG").lower()
    return mode if mode in {"once", "always", "off"} else "once"


def _format_chain_histogram(counts: dict[int, int]) -> dict[str, int]:
    """JSON-friendly chain-length distribution, shortest bucket first."""
    return {
        (f"{length}+" if length >= _CHAIN_LENGTH_HISTOGRAM_MAX else str(length)): count
        for length, count in sorted(counts.items())
    }


def client_ip_diagnostics() -> dict:
    """Snapshot of forwarded-chain observations for an ops/diagnostic surface.

    Exposed by ``GET /api/admin/diagnostics/client-ip`` (admin-only: the payload
    describes the proxy chain in front of the origin). It is a plain dict so
    mounting it costs one line wherever routes are defined. ``verdict`` is the
    one field to read, ``recommendation`` says what to do about it:

    - ``proxy_not_trusted``  – forwarded headers ignored, depth is irrelevant
    - ``insufficient_data``  – not enough requests observed yet
    - ``depth_mismatch``     – ``TRUSTED_PROXY_DEPTH`` should be ``suggested_depth``
    - ``collapsed``          – every request resolved to one IP (shared counter)
    - ``ok``                 – configured depth matches the observed chain

    ``suggested_depth`` is raw observation, not advice: it only becomes safe to
    act on once ``sample_complete`` is true, because a single request cannot
    distinguish a real hop from a client-prepended one. ``recommendation``
    already accounts for that, so prefer it over re-deriving a depth here.
    """
    with _diag_lock:
        observations = _diag_observations
        min_chain = _diag_min_chain
        max_chain = _diag_max_chain
        distinct = len(_diag_resolved_ips)
        capped = distinct >= _DIAGNOSTIC_IP_CAP
        chain_lengths = dict(_diag_chain_lengths)

    configured_depth = _trusted_proxy_depth()
    trusted = trust_proxy_headers()
    cf_trusted = trust_cf_connecting_ip()
    chain_log_mode = _chain_log_mode()
    verdict = _diagnostic_verdict(
        trusted=trusted,
        cf_trusted=cf_trusted,
        configured_depth=configured_depth,
        observations=observations,
        min_chain=min_chain,
        distinct=distinct,
    )
    payload = {
        "trust_proxy_headers": trusted,
        "trust_cf_connecting_ip": cf_trusted,
        "configured_depth": configured_depth,
        "chain_log_mode": chain_log_mode,
        "observations": observations,
        "min_chain_length": min_chain,
        "max_chain_length": max_chain,
        "chain_length_histogram": _format_chain_histogram(chain_lengths),
        "distinct_resolved_ips": distinct,
        "distinct_resolved_ips_capped": capped,
        "suggested_depth": min_chain,
        "sample_target": _DIAGNOSTIC_SAMPLE_TARGET,
        "sample_complete": observations >= _DIAGNOSTIC_SAMPLE_TARGET,
        "verdict": verdict,
        "action_required": verdict in _ACTION_REQUIRED_VERDICTS,
        "recommendation": _diagnostic_recommendation(
            verdict=verdict,
            cf_trusted=cf_trusted,
            configured_depth=configured_depth,
            suggested_depth=min_chain,
            observations=observations,
            min_chain=min_chain,
            max_chain=max_chain,
            distinct=distinct,
            chain_log_mode=chain_log_mode,
        ),
    }
    return payload


def _diagnostic_recommendation(
    *,
    verdict: str,
    cf_trusted: bool,
    configured_depth: int,
    suggested_depth: int | None,
    observations: int,
    min_chain: int | None,
    max_chain: int | None,
    distinct: int,
    chain_log_mode: str,
) -> str:
    """The next action, phrased so an operator never has to read this module.

    Deliberately withholds a depth to apply until the sample is large enough —
    "the shortest chain so far" over three requests is not evidence, and acting
    on it would swap one wrong ``TRUSTED_PROXY_DEPTH`` for another.
    """
    if verdict == "proxy_not_trusted":
        return (
            "Forwarded headers are ignored, so the client IP is the socket peer and "
            "TRUSTED_PROXY_DEPTH has no effect. That is correct when the app is reached "
            "directly; if it actually sits behind Cloudflare/Render, set TRUST_PROXY_HEADERS=1, "
            "otherwise every visitor shares the proxy's address as their rate-limit key."
        )
    if verdict == "insufficient_data":
        if chain_log_mode == "off":
            return (
                "Sampling is disabled (CLIENT_IP_CHAIN_LOG=off), so no chain observations are "
                "being collected and no depth can be suggested. Set CLIENT_IP_CHAIN_LOG=once "
                f"(the default) and re-check after {_DIAGNOSTIC_SAMPLE_TARGET} requests."
            )
        return (
            f"Keep TRUSTED_PROXY_DEPTH={configured_depth} unchanged for now: only {observations} "
            f"of {_DIAGNOSTIC_SAMPLE_TARGET} requests have been observed, too few to tell a real "
            "proxy hop from a client-prepended one. Re-check this endpoint once live traffic "
            "reaches the sample target."
        )
    if verdict == "depth_mismatch":
        return (
            f"Set TRUSTED_PROXY_DEPTH={suggested_depth} in render.yaml and redeploy. The shortest "
            f"X-Forwarded-For chain over {observations} requests was {suggested_depth} hop(s) "
            f"while the app is configured for {configured_depth}, so every rate limit and the "
            "anonymous-like dedupe are keying off a proxy address instead of the visitor. "
            "Alternatively set TRUST_CF_CONNECTING_IP=1 once the origin only accepts Cloudflare "
            "traffic."
        )
    if verdict == "collapsed":
        if distinct == 0:
            return (
                f"None of the {observations} observed requests resolved to a usable address, so "
                "every per-IP limit currently shares the 'unknown' bucket. Confirm the edge "
                "forwards X-Forwarded-For at all, then re-check; if it does not, the only fix is "
                "TRUST_CF_CONNECTING_IP=1 with the origin locked to Cloudflare traffic."
            )
        if min_chain is not None and min_chain == max_chain:
            return (
                f"All {observations} requests resolved to a single address while the "
                f"X-Forwarded-For chain stayed exactly {min_chain} entry(ies) long. A constant "
                "length means the edge overwrites the header instead of appending to it, so no "
                "TRUSTED_PROXY_DEPTH value can recover the visitor address. Set "
                "TRUST_CF_CONNECTING_IP=1 and restrict the origin to Cloudflare traffic only."
            )
        return (
            f"All {observations} requests resolved to a single address, so admin login, user "
            "login, /proxy-image and the anonymous-like dedupe are all sharing one counter. "
            f"Depth {configured_depth} is selecting a proxy hop: set CLIENT_IP_CHAIN_LOG=always, "
            "read the logged chains, and prefer TRUST_CF_CONNECTING_IP=1 once the origin only "
            "accepts Cloudflare traffic."
        )
    if cf_trusted:
        return (
            "TRUST_CF_CONNECTING_IP=1 is active, so the client IP comes from a single header "
            "Cloudflare overwrites on every request and TRUSTED_PROXY_DEPTH is unused. Keep "
            "direct origin access blocked — any caller reaching the origin can set that header "
            "itself."
        )
    return (
        f"No change needed: TRUSTED_PROXY_DEPTH={configured_depth} matches the shortest chain "
        f"observed over {observations} requests, and {distinct} distinct client IPs were "
        "resolved."
    )


def _diagnostic_verdict(
    *,
    trusted: bool,
    cf_trusted: bool,
    configured_depth: int,
    observations: int,
    min_chain: int | None,
    distinct: int,
) -> str:
    if not trusted:
        return "proxy_not_trusted"
    # CF-Connecting-IP is a single overwritten value: depth never applies.
    if cf_trusted:
        return "ok"
    if observations < _DIAGNOSTIC_SAMPLE_TARGET or min_chain is None:
        return "insufficient_data"
    if min_chain != configured_depth:
        return "depth_mismatch"
    if distinct <= 1:
        return "collapsed"
    return "ok"


def _record_client_ip_observation(
    *,
    peer_ip: str,
    forwarded_for: str | None,
    cf_connecting_ip: str | None,
    resolved: str,
) -> None:
    """Accumulate chain statistics and log the calibration signals at most once.

    Only addresses and the configured depth are logged — never other request
    headers, paths or bodies. Operators need the IPs to fix the depth; anything
    beyond that would be gratuitous.
    """
    global _diag_observations, _diag_min_chain, _diag_max_chain
    global _diag_first_logged, _diag_verdict_logged

    mode = _chain_log_mode()
    if mode == "off":
        return

    chain = split_forwarded_for(forwarded_for)
    chain_length = len(chain)

    with _diag_lock:
        # Stop accounting once the sample is large enough and the verdict has
        # been reported: steady state must not keep taking this lock's work.
        # The absolute cap covers the degenerate case where no verdict is ever
        # reachable (e.g. trusted proxies but no X-Forwarded-For ever arrives).
        if mode != "always" and (
            _diag_verdict_logged or _diag_observations >= _DIAGNOSTIC_SAMPLE_TARGET * 10
        ):
            return

        _diag_observations += 1
        bucket = min(chain_length, _CHAIN_LENGTH_HISTOGRAM_MAX)
        _diag_chain_lengths[bucket] = _diag_chain_lengths.get(bucket, 0) + 1
        if chain_length:
            if _diag_min_chain is None or chain_length < _diag_min_chain:
                _diag_min_chain = chain_length
            if _diag_max_chain is None or chain_length > _diag_max_chain:
                _diag_max_chain = chain_length
        if resolved != _UNKNOWN and len(_diag_resolved_ips) < _DIAGNOSTIC_IP_CAP:
            _diag_resolved_ips.add(resolved)

        should_log_chain = mode == "always" or not _diag_first_logged
        _diag_first_logged = True
        observations = _diag_observations
        min_chain = _diag_min_chain
        distinct = len(_diag_resolved_ips)
        sample_ip = next(iter(_diag_resolved_ips), _UNKNOWN)
        verdict_pending = not _diag_verdict_logged

    configured_depth = _trusted_proxy_depth()
    trusted = trust_proxy_headers()
    cf_trusted = trust_cf_connecting_ip()

    if should_log_chain:
        logger.info(
            "client-ip chain: xff=%r peer=%s cf_connecting_ip=%s resolved=%s "
            "chain_length=%d configured_depth=%d trust_proxy=%s trust_cf=%s",
            ", ".join(chain),
            peer_ip or "-",
            (cf_connecting_ip or "-").strip() or "-",
            resolved,
            chain_length,
            configured_depth,
            trusted,
            cf_trusted,
        )

    if not verdict_pending or observations < _DIAGNOSTIC_SAMPLE_TARGET:
        return

    verdict = _diagnostic_verdict(
        trusted=trusted,
        cf_trusted=cf_trusted,
        configured_depth=configured_depth,
        observations=observations,
        min_chain=min_chain,
        distinct=distinct,
    )
    if verdict == "insufficient_data":
        return

    with _diag_lock:
        if _diag_verdict_logged:
            return
        _diag_verdict_logged = True

    if verdict == "depth_mismatch":
        logger.warning(
            "TRUSTED_PROXY_DEPTH=%d does not match the observed X-Forwarded-For chain "
            "(shortest chain seen over %d requests was %d hop(s)). Rate limits and "
            "anonymous-like dedupe are keying off a proxy address, not the visitor. "
            "Set TRUSTED_PROXY_DEPTH=%d (or enable TRUST_CF_CONNECTING_IP=1 once the "
            "origin only accepts Cloudflare traffic).",
            configured_depth,
            observations,
            min_chain,
            min_chain,
        )
    elif verdict == "collapsed":
        logger.warning(
            "All %d observed requests resolved to a single client IP (%s). This is the "
            "signature of a forwarded-header misconfiguration collapsing every rate "
            "limit onto one shared counter; verify TRUSTED_PROXY_DEPTH=%d against the "
            "logged X-Forwarded-For chain.",
            observations,
            sample_ip,
            configured_depth,
        )
    else:
        logger.info(
            "client-ip forwarded chain looks consistent: TRUSTED_PROXY_DEPTH=%d, "
            "%d requests observed, %d distinct client IPs.",
            configured_depth,
            observations,
            distinct,
        )


def client_ip_from_request(request) -> str:
    """Adapter that pulls the relevant fields off a Starlette/FastAPI request."""
    headers = request.headers
    peer_ip = request.client.host if request.client else ""
    cf_connecting_ip = headers.get(_CF_HEADER)
    forwarded_for = headers.get(_XFF_HEADER)
    resolved = resolve_client_ip(
        peer_ip=peer_ip,
        cf_connecting_ip=cf_connecting_ip,
        forwarded_for=forwarded_for,
    )
    _record_client_ip_observation(
        peer_ip=peer_ip,
        forwarded_for=forwarded_for,
        cf_connecting_ip=cf_connecting_ip,
        resolved=resolved,
    )
    return resolved
