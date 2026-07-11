"""Tests for shared outbound URL / host safety helpers."""

from app.url_safety import is_blocked_ip, is_public_http_url, is_private_hostname


def test_blocks_loopback_and_private_ips():
    assert is_blocked_ip("127.0.0.1") is True
    assert is_blocked_ip("10.0.0.5") is True
    assert is_blocked_ip("192.168.1.1") is True
    assert is_blocked_ip("169.254.169.254") is True
    assert is_blocked_ip("8.8.8.8") is False


def test_rejects_non_http_and_private_literal_hosts():
    assert is_public_http_url("javascript:alert(1)", resolve_dns=False) is False
    assert is_public_http_url("ftp://example.com/a.png", resolve_dns=False) is False
    assert is_public_http_url("http://127.0.0.1/a.png", resolve_dns=False) is False
    assert is_public_http_url("http://169.254.169.254/latest/meta-data", resolve_dns=False) is False
    assert is_public_http_url("https://example.com/cover.png", resolve_dns=False) is True
    assert is_public_http_url("https://localhost/cover.png", resolve_dns=False) is False


def test_private_hostname_literal():
    assert is_private_hostname("127.0.0.1") is True
    assert is_private_hostname("10.1.2.3") is True
