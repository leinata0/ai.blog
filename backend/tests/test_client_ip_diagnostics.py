"""Tests for GET /api/admin/diagnostics/client-ip.

`app.client_ip` can already tell whether TRUSTED_PROXY_DEPTH matches the real
X-Forwarded-For chain, but that answer only exists in production, where the
person who needs it cannot run a Python REPL. These guard the endpoint that
hands it over: that it stays behind admin auth (it exposes visitor addresses and
the proxy topology), that each verdict reaches the wire intact, and — the easy
one to get wrong — that a sample of one request never produces a confident
"set TRUSTED_PROXY_DEPTH=N", which would just swap one wrong depth for another.

No network is touched: observations are seeded by driving `client_ip_from_request`
with fake request objects, exactly as `test_client_ip.py` does.
"""

import pytest

from app.client_ip import (
    _DIAGNOSTIC_SAMPLE_TARGET,
    client_ip_from_request,
    reset_client_ip_diagnostics,
)

ENDPOINT = "/api/admin/diagnostics/client-ip"

EXPECTED_KEYS = {
    "trust_proxy_headers",
    "trust_cf_connecting_ip",
    "configured_depth",
    "chain_log_mode",
    "observations",
    "min_chain_length",
    "max_chain_length",
    "chain_length_histogram",
    "distinct_resolved_ips",
    "distinct_resolved_ips_capped",
    "suggested_depth",
    "sample_target",
    "sample_complete",
    "verdict",
    "action_required",
    "recommendation",
}


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


def _observe(peer_ip="10.0.0.1", xff=None, cf=None):
    headers = {}
    if xff is not None:
        headers["x-forwarded-for"] = xff
    if cf is not None:
        headers["cf-connecting-ip"] = cf
    return client_ip_from_request(_FakeRequest(peer_ip, headers))


def _auth_headers(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _fetch(client):
    resp = client.get(ENDPOINT, headers=_auth_headers(client))
    assert resp.status_code == 200
    return resp.json()


# --------------------------------------------------------------------------- #
# Authorization
# --------------------------------------------------------------------------- #


def test_endpoint_requires_authentication(client):
    # Visitor IPs and the proxy chain in front of the origin are reconnaissance
    # for anyone but the operator.
    assert client.get(ENDPOINT).status_code in (401, 403)


def test_endpoint_rejects_a_bogus_token(client):
    response = client.get(ENDPOINT, headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code in (401, 403)


def test_unauthenticated_request_leaks_no_addresses(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    _observe(xff="203.0.113.5, 198.51.100.7")

    body = client.get(ENDPOINT).text
    assert "203.0.113.5" not in body
    assert "198.51.100.7" not in body


# --------------------------------------------------------------------------- #
# Payload contract
# --------------------------------------------------------------------------- #


def test_payload_exposes_the_documented_fields_only(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")

    payload = _fetch(client)

    assert set(payload) == EXPECTED_KEYS
    assert payload["sample_target"] == _DIAGNOSTIC_SAMPLE_TARGET
    assert payload["configured_depth"] == 1
    assert isinstance(payload["recommendation"], str) and payload["recommendation"]


# --------------------------------------------------------------------------- #
# Verdicts
# --------------------------------------------------------------------------- #


def test_verdict_proxy_not_trusted(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    _observe(xff="203.0.113.5, 198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "proxy_not_trusted"
    assert payload["trust_proxy_headers"] is False
    assert payload["action_required"] is False
    assert "TRUST_PROXY_HEADERS=1" in payload["recommendation"]


def test_verdict_insufficient_data_withholds_a_depth_to_apply(client, monkeypatch):
    # The whole point of the sample target: one request cannot distinguish a real
    # appending hop from an entry the client prepended itself, so the endpoint
    # must not turn that single observation into an instruction.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")
    _observe(xff="192.0.2.1, 203.0.113.5, 198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "insufficient_data"
    assert payload["sample_complete"] is False
    assert payload["action_required"] is False
    assert "Set TRUSTED_PROXY_DEPTH=" not in payload["recommendation"]
    assert "TRUSTED_PROXY_DEPTH=1 unchanged" in payload["recommendation"]
    assert str(_DIAGNOSTIC_SAMPLE_TARGET) in payload["recommendation"]


def test_insufficient_data_explains_when_sampling_is_switched_off(client, monkeypatch):
    # CLIENT_IP_CHAIN_LOG=off stops collection entirely, so the sample never
    # fills and the verdict would sit at insufficient_data forever. Say so,
    # rather than telling the operator to wait for traffic that is not counted.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("CLIENT_IP_CHAIN_LOG", "off")
    for _ in range(_DIAGNOSTIC_SAMPLE_TARGET):
        _observe(xff="203.0.113.5, 198.51.100.7")

    payload = _fetch(client)

    assert payload["observations"] == 0
    assert payload["verdict"] == "insufficient_data"
    assert payload["chain_log_mode"] == "off"
    assert "CLIENT_IP_CHAIN_LOG=off" in payload["recommendation"]


def test_verdict_depth_mismatch_names_the_depth_to_set(client, monkeypatch):
    # The Cloudflare -> Render case: the true chain is "client, cloudflare" but
    # depth is configured to 1, so every limit keys off Cloudflare's egress IP.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")
    for index in range(_DIAGNOSTIC_SAMPLE_TARGET):
        forged = "192.0.2.1, " if index % 2 else ""
        _observe(xff=f"{forged}203.0.113.{index % 20}, 198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "depth_mismatch"
    assert payload["action_required"] is True
    assert payload["sample_complete"] is True
    assert payload["configured_depth"] == 1
    assert payload["suggested_depth"] == 2
    assert "Set TRUSTED_PROXY_DEPTH=2" in payload["recommendation"]


def test_verdict_collapsed_on_constant_chain_recommends_cf_connecting_ip(client, monkeypatch):
    # Depth matches the chain and yet every visitor resolves to one address, with
    # the chain length pinned at 1: the edge overwrites X-Forwarded-For instead of
    # appending, so no depth value can recover the visitor.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")
    for _ in range(_DIAGNOSTIC_SAMPLE_TARGET):
        _observe(xff="198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "collapsed"
    assert payload["action_required"] is True
    assert payload["distinct_resolved_ips"] == 1
    assert payload["min_chain_length"] == payload["max_chain_length"] == 1
    assert "TRUST_CF_CONNECTING_IP=1" in payload["recommendation"]
    assert "Set TRUSTED_PROXY_DEPTH=" not in payload["recommendation"]


def test_verdict_collapsed_with_varying_chain_points_at_the_logs(client, monkeypatch):
    # Same collapse, but the chain length varies, so "the edge overwrites it" is
    # not the explanation and the operator is sent to the raw chains instead.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "1")
    for index in range(_DIAGNOSTIC_SAMPLE_TARGET):
        forged = "192.0.2.1, " if index % 2 else ""
        _observe(xff=f"{forged}198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "collapsed"
    assert payload["min_chain_length"] == 1
    assert payload["max_chain_length"] == 2
    assert "CLIENT_IP_CHAIN_LOG=always" in payload["recommendation"]


def test_verdict_ok_when_depth_matches(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_DEPTH", "2")
    for index in range(_DIAGNOSTIC_SAMPLE_TARGET):
        _observe(xff=f"203.0.113.{index % 20}, 198.51.100.7")

    payload = _fetch(client)

    assert payload["verdict"] == "ok"
    assert payload["action_required"] is False
    assert payload["suggested_depth"] == 2
    assert payload["distinct_resolved_ips"] == 20
    assert "No change needed" in payload["recommendation"]


def test_verdict_ok_under_cf_connecting_ip_warns_about_origin_exposure(client, monkeypatch):
    # Depth arithmetic no longer applies, but the header is only trustworthy while
    # direct origin access stays blocked — the recommendation has to say that.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUST_CF_CONNECTING_IP", "1")
    assert _observe(xff="192.0.2.1, 203.0.113.5, 198.51.100.7", cf="1.2.3.4") == "1.2.3.4"

    payload = _fetch(client)

    assert payload["verdict"] == "ok"
    assert payload["trust_cf_connecting_ip"] is True
    assert payload["action_required"] is False
    assert "direct origin access blocked" in payload["recommendation"]


# --------------------------------------------------------------------------- #
# Chain length distribution
# --------------------------------------------------------------------------- #


def test_chain_length_histogram_reports_the_observed_distribution(client, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    _observe()  # no X-Forwarded-For at all
    for _ in range(2):
        _observe(xff="198.51.100.7")
    for _ in range(3):
        _observe(xff="203.0.113.5, 198.51.100.7")

    payload = _fetch(client)

    assert payload["chain_length_histogram"] == {"0": 1, "1": 2, "2": 3}
    assert payload["observations"] == 6


def test_chain_length_histogram_buckets_absurd_client_supplied_chains(client, monkeypatch):
    # A client controls how many entries it prepends, so the number of histogram
    # buckets must not follow its input.
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("CLIENT_IP_CHAIN_LOG", "always")
    for length in range(1, 40):
        chain = ", ".join(f"192.0.2.{index % 250 + 1}" for index in range(length))
        _observe(xff=f"{chain}, 198.51.100.7")

    payload = _fetch(client)

    histogram = payload["chain_length_histogram"]
    assert len(histogram) <= 9
    assert "8+" in histogram
    assert histogram["8+"] == 33  # chains of 9..40 entries all collapse into one bucket
