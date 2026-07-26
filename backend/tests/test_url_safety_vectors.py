"""Shared address/hostname vectors for the outbound URL safety guard.

This table is the Python half of a two-sided contract: the JS guard in
``scripts/lib/url-guard.mjs`` must classify exactly the same URLs the same way.
The two implementations had silently drifted on nine address classes — IETF
special-purpose IPv4 ranges (benchmark, protocol assignments, TEST-NET-1/2/3),
IPv6 multicast, the NAT64 well-known prefix, RFC 6598 shared address space,
trailing-dot FQDNs, bare ``metadata`` and ``*.localhost``. Pin the agreed answer
here so a future edit on either side has to update one table, not two lists.

Nothing here touches the network: every case is decided by scheme, literal-IP
class, or the hostname blocklist, all of which short-circuit before DNS. That
invariant is asserted directly in ``test_no_vector_consults_dns``.
"""

import socket as _socket
import types

import pytest

from app import url_safety
from app.url_safety import build_pinned_http_targets, is_public_http_url


def install_stub_resolver(monkeypatch, resolver, *, module=url_safety):
    """Swap ``url_safety.socket`` for a stub so tests never issue real DNS.

    ``resolver`` maps ``(host, port)`` to a list of literal addresses, or to an
    exception instance to simulate NXDOMAIN. Returns the call log so a test can
    assert whether DNS was consulted at all.
    """
    calls: list[tuple[str, int | None]] = []

    def fake_getaddrinfo(host, port, *args, **kwargs):
        calls.append((host, port))
        outcome = resolver(host, port)
        if isinstance(outcome, BaseException):
            raise outcome
        infos = []
        for address in outcome:
            if ":" in address:
                infos.append(
                    (
                        _socket.AF_INET6,
                        _socket.SOCK_STREAM,
                        _socket.IPPROTO_TCP,
                        "",
                        (address, port or 0, 0, 0),
                    )
                )
            else:
                infos.append(
                    (
                        _socket.AF_INET,
                        _socket.SOCK_STREAM,
                        _socket.IPPROTO_TCP,
                        "",
                        (address, port or 0),
                    )
                )
        return infos

    monkeypatch.setattr(
        module,
        "socket",
        types.SimpleNamespace(
            getaddrinfo=fake_getaddrinfo,
            gaierror=_socket.gaierror,
            SOCK_STREAM=_socket.SOCK_STREAM,
            AF_INET=_socket.AF_INET,
            AF_INET6=_socket.AF_INET6,
            IPPROTO_TCP=_socket.IPPROTO_TCP,
        ),
    )
    return calls


# --------------------------------------------------------------------------
# The shared table. (url, reason) — reason doubles as the pytest case id.
# --------------------------------------------------------------------------

BLOCKED_URL_VECTORS = (
    # IETF special-purpose IPv4 ranges (RFC 6890). The JS guard used to allow
    # every one of these because it only knew the classic RFC 1918 blocks.
    ("http://198.18.0.1/i.png", "benchmark-198.18.0.0-15"),
    ("http://198.19.255.255/i.png", "benchmark-upper-bound"),
    ("http://192.0.0.8/i.png", "ietf-protocol-assignments-192.0.0.0-24"),
    ("http://192.0.2.5/i.png", "test-net-1-192.0.2.0-24"),
    ("http://198.51.100.7/i.png", "test-net-2-198.51.100.0-24"),
    ("http://203.0.113.9/i.png", "test-net-3-203.0.113.0-24"),
    # RFC 6598 shared address space. Python 3.13 stopped reporting this as
    # ``is_private``, so the guard must not rely on that flag alone.
    ("http://100.64.0.1/i.png", "cgnat-shared-address-space-lower"),
    ("http://100.127.255.255/i.png", "cgnat-shared-address-space-upper"),
    # Classic private / loopback / metadata IPv4.
    ("http://127.0.0.1/i.png", "ipv4-loopback"),
    ("http://10.0.0.5/i.png", "ipv4-private-10-8"),
    ("http://172.16.0.1/i.png", "ipv4-private-172.16-12"),
    ("http://192.168.1.1/i.png", "ipv4-private-192.168-16"),
    ("http://169.254.169.254/latest/meta-data", "ipv4-link-local-cloud-metadata"),
    ("http://0.0.0.0/i.png", "ipv4-unspecified"),
    ("http://255.255.255.255/i.png", "ipv4-broadcast"),
    ("http://240.0.0.1/i.png", "ipv4-reserved-240-4"),
    ("http://224.0.0.1/i.png", "ipv4-multicast"),
    # IPv6.
    ("http://[::1]/i.png", "ipv6-loopback"),
    ("http://[::]/i.png", "ipv6-unspecified"),
    ("http://[fe80::1]/i.png", "ipv6-link-local"),
    ("http://[fd00::1]/i.png", "ipv6-unique-local"),
    ("http://[ff02::1]/i.png", "ipv6-link-local-multicast"),
    ("http://[ff00::2]/i.png", "ipv6-multicast"),
    ("http://[64:ff9b::7f00:1]/i.png", "nat64-well-known-prefix-wrapping-loopback"),
    ("http://[::ffff:127.0.0.1]/i.png", "ipv4-mapped-loopback"),
    ("http://[::ffff:169.254.169.254]/i.png", "ipv4-mapped-cloud-metadata"),
    # Host names, including the trailing-dot FQDN forms that bypassed the JS
    # blocklist because it compared against the un-normalized host.
    ("http://localhost/i.png", "localhost"),
    ("http://localhost./i.png", "localhost-trailing-dot"),
    ("http://LOCALHOST./i.png", "localhost-uppercase-trailing-dot"),
    ("http://localhost../i.png", "localhost-double-trailing-dot"),
    ("http://localhost.localdomain/i.png", "localhost-localdomain"),
    ("http://metadata.google.internal/", "gcp-metadata"),
    ("http://metadata.google.internal./", "gcp-metadata-trailing-dot"),
    # Python previously lacked these two names entirely; DNS resolution was the
    # only backstop, which the literal-IP fast path skips.
    ("http://metadata/", "bare-metadata-short-name"),
    ("http://api.localhost/", "wildcard-localhost-rfc-6761"),
    ("http://ip6-localhost/", "ip6-localhost"),
    ("http://ip6-loopback/", "ip6-loopback"),
    ("http://svc.internal/", "internal-suffix"),
    ("http://printer.local/", "mdns-local-suffix"),
    # Schemes and malformed input.
    ("javascript:alert(1)", "javascript-scheme"),
    ("ftp://example.com/a.png", "ftp-scheme"),
    ("file:///etc/passwd", "file-scheme"),
    ("data:image/png;base64,AAAA", "data-scheme"),
    ("", "empty-string"),
    ("   ", "whitespace-only"),
    ("http:///i.png", "no-host"),
    ("not a url at all", "unparseable"),
    ("http://ex[ample.com:1/i.png", "malformed-ipv6-literal"),
)

ALLOWED_URL_VECTORS = (
    ("https://example.com/cover.png", "ordinary-https-name"),
    ("http://example.com/cover.png", "ordinary-http-name"),
    ("https://example.com./cover.png", "public-name-trailing-dot-is-fine"),
    ("https://cdn.example.co.uk:8443/a.png", "non-default-port"),
    ("http://93.184.216.34/i.png", "public-ipv4-literal"),
    ("http://8.8.8.8/", "public-resolver-ipv4"),
    ("http://192.0.1.1/i.png", "just-below-test-net-1"),
    ("http://198.20.0.1/i.png", "just-above-benchmark-range"),
    ("http://100.128.0.1/i.png", "just-above-cgnat-range"),
    ("https://[2606:2800:220:1:248:1893:25c8:1946]/a.png", "public-ipv6-literal"),
    ("https://[2001:4860:4860::8888]/a.png", "public-ipv6-resolver"),
)


def _ids(vectors):
    return [reason for _, reason in vectors]


@pytest.mark.parametrize("url", [url for url, _ in BLOCKED_URL_VECTORS], ids=_ids(BLOCKED_URL_VECTORS))
def test_blocked_vectors_are_not_public(url):
    assert is_public_http_url(url, resolve_dns=False) is False


@pytest.mark.parametrize("url", [url for url, _ in ALLOWED_URL_VECTORS], ids=_ids(ALLOWED_URL_VECTORS))
def test_allowed_vectors_are_public(url):
    assert is_public_http_url(url, resolve_dns=False) is True


@pytest.mark.parametrize("url", [url for url, _ in BLOCKED_URL_VECTORS], ids=_ids(BLOCKED_URL_VECTORS))
def test_blocked_vectors_yield_no_pinned_target(url, monkeypatch):
    """The fetch path must refuse the same set, even if DNS says otherwise.

    The stub resolver answers every lookup with a public address, so any vector
    that still produces a target would be relying on DNS rather than on its own
    classification.
    """
    install_stub_resolver(monkeypatch, lambda host, port: ["93.184.216.34"])

    assert build_pinned_http_targets(url) == ()


@pytest.mark.parametrize("url", [url for url, _ in BLOCKED_URL_VECTORS], ids=_ids(BLOCKED_URL_VECTORS))
def test_no_blocked_vector_raises(url):
    """Malformed input is classified, never propagated as an exception.

    ``/proxy-image`` calls straight into these helpers, so a raised ValueError
    surfaces as a 500 with a stack trace instead of a 400.
    """
    is_public_http_url(url, resolve_dns=False)
    is_public_http_url(url, resolve_dns=True)
    build_pinned_http_targets(url)


def test_no_vector_consults_dns(monkeypatch):
    """Every table entry is decided before the resolver is reached."""

    def explode(host, port):
        raise AssertionError(f"unexpected DNS lookup for {host!r}")

    install_stub_resolver(monkeypatch, explode)

    for url, _ in BLOCKED_URL_VECTORS:
        assert is_public_http_url(url, resolve_dns=True) is False


# --------------------------------------------------------------------------
# DNS-dependent vectors: alternate integer notations parse as host names, not
# as literal IPs, so only the resolving path can classify them. These are the
# cases where ``resolve_dns=False`` deliberately answers True.
# --------------------------------------------------------------------------

OBFUSCATED_LOOPBACK_URLS = (
    ("http://2130706433/i.png", "decimal-loopback"),
    ("http://0177.0.0.1/i.png", "octal-loopback"),
    ("http://0x7f.1/i.png", "hex-loopback"),
    ("http://127.1/i.png", "short-form-loopback"),
)


@pytest.mark.parametrize(
    "url", [url for url, _ in OBFUSCATED_LOOPBACK_URLS], ids=_ids(OBFUSCATED_LOOPBACK_URLS)
)
def test_obfuscated_loopback_is_blocked_once_resolved(url, monkeypatch):
    install_stub_resolver(monkeypatch, lambda host, port: ["127.0.0.1"])

    assert build_pinned_http_targets(url) == ()
    assert is_public_http_url(url, resolve_dns=True) is False
