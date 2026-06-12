"""Tests for client IP resolution and forwarded-header trust.

These guard the anti-abuse fix: the like/comment/view limits all key off the
resolved client IP, so it must NOT honor forged headers unless the deployment
has explicitly opted into trusting its proxy.
"""

from app.client_ip import resolve_client_ip


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


def test_prefers_cf_connecting_ip_when_trusted():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        cf_connecting_ip="1.2.3.4",
        forwarded_for="5.6.7.8",
        trust_proxy=True,
    )
    assert resolved == "1.2.3.4"


def test_uses_rightmost_xff_entry_by_proxy_depth_when_trusted():
    # X-Forwarded-For grows left-to-right as hops append. With one trusted hop the
    # real client is the right-most entry — NOT the left-most, which a client can
    # forge by sending its own header that the proxy then appends to.
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="forged.value, 198.51.100.7",
        trust_proxy=True,
        proxy_depth=1,
    )
    assert resolved == "198.51.100.7"


def test_proxy_depth_two_takes_second_from_right():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="client.real, 198.51.100.7, 203.0.113.2",
        trust_proxy=True,
        proxy_depth=2,
    )
    assert resolved == "198.51.100.7"


def test_depth_larger_than_chain_clamps_to_leftmost():
    resolved = resolve_client_ip(
        peer_ip="10.0.0.1",
        forwarded_for="only.one",
        trust_proxy=True,
        proxy_depth=3,
    )
    assert resolved == "only.one"


def test_trusted_but_no_headers_uses_peer():
    resolved = resolve_client_ip(
        peer_ip="203.0.113.9",
        trust_proxy=True,
    )
    assert resolved == "203.0.113.9"
