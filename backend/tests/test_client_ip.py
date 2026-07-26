"""Tests for client IP resolution and forwarded-header trust.

These guard the anti-abuse fix: the like/comment/view limits all key off the
resolved client IP, so it must NOT honor forged headers unless the deployment
has explicitly opted into trusting its proxy.
"""

import logging

import pytest

from app.client_ip import (
    _DIAGNOSTIC_SAMPLE_TARGET,
    client_ip_diagnostics,
    client_ip_from_request,
    reset_client_ip_diagnostics,
    resolve_client_ip,
    split_forwarded_for,
    trust_proxy_headers,
)


def test_ignores_forged_headers_when_proxy_not_trusted():
    # Default posture: a client sending its own CF-Connecting-IP / X-Forwarded-For
    # must not be able to override the real socket peer.
    resolved = resolve_client_ip(
        peer_ip="203.0.113.9",
        cf_connecting_ip="1.2.3.4",
        forwarded_for="5.6.7.8, 9.10.11.12",
        trust_proxy=False,
    )
    assert resolved == "203.0.113.9"


def test_falls_back_to_unknown_without_peer():
    assert resolve_client_ip(peer_ip="", trust_proxy=False) == "unknown"
    assert resolve_client_ip(peer_ip=None, trust_proxy=False) == "unknown"


def test_cf_connecting_ip_requires_separate_explicit_trust():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        cf_connecting_ip="1.2.3.4",
        forwarded_for="5.6.7.8",
        trust_proxy=True,
    )
    assert resolved == "5.6.7.8"

    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        cf_connecting_ip="1.2.3.4",
        forwarded_for="5.6.7.8",
        trust_proxy=True,
        trust_cf_header=True,
    )
    assert resolved == "1.2.3.4"


def test_uses_rightmost_xff_entry_by_proxy_depth_when_trusted():
    # X-Forwarded-For grows left-to-right as hops append. With one trusted hop the
    # real client is the right-most entry — NOT the left-most, which a client can
    # forge by sending its own header that the proxy then appends to.
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="192.0.2.99, 198.51.100.7",
        trust_proxy=True,
        proxy_depth=1,
    )
    assert resolved == "198.51.100.7"


def test_proxy_depth_two_takes_second_from_right():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="192.0.2.99, 198.51.100.7, 203.0.113.2",
        trust_proxy=True,
        proxy_depth=2,
    )
    assert resolved == "198.51.100.7"


def test_depth_larger_than_chain_clamps_to_leftmost():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="198.51.100.7",
        trust_proxy=True,
        proxy_depth=3,
    )
    assert resolved == "198.51.100.7"


def test_invalid_forwarded_values_fall_back_to_peer():
    assert resolve_client_ip(
        peer_ip="203.0.113.9",
        forwarded_for="not-an-ip",
        trust_proxy=True,
    ) == "203.0.113.9"


def test_trusted_but_no_headers_uses_peer():
    resolved = resolve_client_ip(
        peer_ip="203.0.113.9",
        trust_proxy=True,
    )
    assert resolved == "203.0.113.9"


def test_trust_proxy_headers_defaults_false_without_render(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RENDER_SERVICE_ID", raising=False)
    assert trust_proxy_headers() is False


def test_trust_proxy_headers_auto_enables_on_render(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    monkeypatch.setenv("RENDER", "true")
    assert trust_proxy_headers() is True


def test_trust_proxy_headers_explicit_off_wins_over_render(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    assert trust_proxy_headers() is False


# --------------------------------------------------------------------------- #
# Depth calibration diagnostics
#
# TRUSTED_PROXY_DEPTH must equal the number of appending hops in front of the
# app. Nothing in the code can prove what that number is in production, so these
# guard the machinery that makes it observable instead.
# --------------------------------------------------------------------------- #


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    def __init__(self, peer_ip, headers=None):
        self.client = _FakeClient(peer_ip) if peer_ip else None
        self.headers = headers or {}


@pytest.fixture(autouse=True)
def _clean_diagnostics():
    reset_client_ip_diagnostics()
    yield
    reset_client_ip_diagnostics()


def _request(peer_ip="10.0.0.1", xff=None, cf=None):
    headers = {}
    if xff is not None:
        headers["x-forwarded-for"] = xff
    if cf is not None:
        headers["cf-connecting-ip"] = cf
    return _FakeRequest(peer_ip, headers)


def test_split_forwarded_for_trims_and_drops_blanks():
    assert split_forwarded_for(" 1.1.1.1 , , 2.2.2.2 ") == ["1.1.1.1", "2.2.2.2"]
    assert split_forwarded_for(None) == []
    assert split_forwarded_for("") == []


def test_first_request_logs_the_forwarded_chain_once(monkeypatch, caplog):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")

    with caplog.at_level(logging.INFO, logger="blog.client_ip"):
        for _ in range(3):
            client_ip_from_request(_request(xff="203.0.113.5, 198.51.100.7"))

    chain_logs = [rec for rec in caplog.records if "client-ip chain" in rec.getMessage()]
    assert len(chain_logs) == 1
    message = chain_logs[0].getMessage()
    # Operators need the addresses and the configured depth, nothing else.
    assert "203.0.113.5, 198.51.100.7" in message
    assert "configured_depth=1" in message
    assert "resolved=198.51.100.7" in message


def test_chain_log_can_be_disabled(monkeypatch, caplog):
    monkeypatch.setenv("CLIENT_IP_CHAIN_LOG", "off")

    with caplog.at_level(logging.INFO, logger="blog.client_ip"):
        client_ip_from_request(_request(xff="203.0.113.5, 198.51.100.7"))

    assert not [rec for rec in caplog.records if "client-ip chain" in rec.getMessage()]
    assert client_ip_diagnostics()["observations"] == 0


def test_chain_log_always_mode_logs_every_request(monkeypatch, caplog):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("CLIENT_IP_CHAIN_LOG", "always")

    with caplog.at_level(logging.INFO, logger="blog.client_ip"):
        for _ in range(3):
            client_ip_from_request(_request(xff="203.0.113.5, 198.51.100.7"))

    chain_logs = [rec for rec in caplog.records if "client-ip chain" in rec.getMessage()]
    assert len(chain_logs) == 3


def test_diagnostics_report_proxy_not_trusted(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")

    client_ip_from_request(_request(xff="203.0.113.5, 198.51.100.7"))

    diagnostics = client_ip_diagnostics()
    assert diagnostics["trust_proxy_headers"] is False
    assert diagnostics["verdict"] == "proxy_not_trusted"


def test_diagnostics_need_enough_samples(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")

    client_ip_from_request(_request(xff="203.0.113.5, 198.51.100.7"))

    assert client_ip_diagnostics()["verdict"] == "insufficient_data"


def test_shortest_observed_chain_is_the_suggested_depth(monkeypatch, caplog):
    # A client can only ever *prepend* forged entries, so the shortest chain seen
    # equals the number of real appending hops. Here the true chain is
    # "client, cloudflare" (2 hops) while depth is misconfigured to 1 — the
    # exact Cloudflare -> Render collapse this diagnostic exists to catch.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")

    with caplog.at_level(logging.WARNING, logger="blog.client_ip"):
        for index in range(_DIAGNOSTIC_SAMPLE_TARGET):
            forged = "192.0.2.1, " if index % 2 else ""
            client_ip_from_request(_request(xff=f"{forged}203.0.113.{index % 20}, 198.51.100.7"))

    diagnostics = client_ip_diagnostics()
    assert diagnostics["min_chain_length"] == 2
    assert diagnostics["suggested_depth"] == 2
    assert diagnostics["configured_depth"] == 1
    assert diagnostics["verdict"] == "depth_mismatch"

    warnings = [rec for rec in caplog.records if rec.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert "TRUSTED_PROXY_DEPTH=2" in warnings[0].getMessage()


def test_collapsed_rate_limit_key_is_reported(monkeypatch, caplog):
    # Depth matches the chain, but every request still resolves to one address:
    # the direct symptom of every per-IP limit sharing a single counter.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")

    with caplog.at_level(logging.WARNING, logger="blog.client_ip"):
        for _ in range(_DIAGNOSTIC_SAMPLE_TARGET):
            client_ip_from_request(_request(xff="198.51.100.7"))

    diagnostics = client_ip_diagnostics()
    assert diagnostics["distinct_resolved_ips"] == 1
    assert diagnostics["verdict"] == "collapsed"

    warnings = [rec for rec in caplog.records if rec.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert "single client IP" in warnings[0].getMessage()


def test_matching_depth_reports_ok_without_warning(monkeypatch, caplog):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "2")

    with caplog.at_level(logging.INFO, logger="blog.client_ip"):
        for index in range(_DIAGNOSTIC_SAMPLE_TARGET):
            client_ip_from_request(_request(xff=f"203.0.113.{index % 20}, 198.51.100.7"))

    diagnostics = client_ip_diagnostics()
    assert diagnostics["suggested_depth"] == 2
    assert diagnostics["verdict"] == "ok"
    assert not [rec for rec in caplog.records if rec.levelno >= logging.WARNING]


def test_cf_connecting_ip_path_skips_depth_arithmetic(monkeypatch):
    # The recommended posture once the origin only accepts Cloudflare traffic:
    # a single overwritten header, so chain length is irrelevant.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUST_CF_CONNECTING_IP", "1")

    resolved = client_ip_from_request(
        _request(xff="192.0.2.1, 203.0.113.5, 198.51.100.7", cf="1.2.3.4")
    )

    assert resolved == "1.2.3.4"
    assert client_ip_diagnostics()["verdict"] == "ok"


def test_distinct_ip_tracking_is_bounded(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "2")
    monkeypatch.setenv("CLIENT_IP_CHAIN_LOG", "always")

    for index in range(300):
        client_ip_from_request(_request(xff=f"203.0.113.{index % 256}, 198.51.100.7"))

    diagnostics = client_ip_diagnostics()
    assert diagnostics["distinct_resolved_ips"] <= 64
    assert diagnostics["distinct_resolved_ips_capped"] is True

