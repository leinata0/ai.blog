"""Tests for shared outbound URL / host safety helpers.

These cover the SSRF-critical seams: which addresses a host is allowed to
resolve to, how a validated URL is pinned to a literal IP while preserving
Host/SNI, magic-byte content sniffing, and the redirect-revalidating download
path used by admin cover fetches. Nothing here touches the network — DNS and
the HTTP client are both replaced with stubs.

The shared CIDR/hostname classification table lives in
``test_url_safety_vectors.py`` and is kept in sync with the JS guard in
``scripts/lib/url-guard.mjs``.
"""

import socket
import types

import httpx
import pytest

from app import url_safety
from app.url_safety import (
    MAX_IMAGE_DOWNLOAD_BYTES,
    MAX_REDIRECTS,
    build_pinned_http_targets,
    download_public_image_bytes,
    is_blocked_ip,
    is_private_hostname,
    is_public_http_url,
    resolve_public_host_addresses,
    sniff_raster_image_content_type,
)
from test_url_safety_vectors import install_stub_resolver

PNG = b"\x89PNG\r\n\x1a\n" + b"pixels"
JPEG = b"\xff\xd8\xff\xe0" + b"jfif-payload"
GIF87 = b"GIF87a" + b"frames"
GIF89 = b"GIF89a" + b"frames"
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"vp8 data"

PUBLIC_V4 = "93.184.216.34"


def fixed_resolver(*addresses):
    """A resolver that answers every lookup with the same address list."""
    return lambda host, port: list(addresses)


# ---------------------------------------------------------------------------
# Stub HTTP client
# ---------------------------------------------------------------------------


class StubResponse:
    def __init__(self, status_code=200, headers=None, chunks=()):
        self.status_code = status_code
        self.headers = headers or {}
        self.chunks = list(chunks)
        self.consumed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def iter_bytes(self):
        self.consumed = True
        yield from self.chunks


class StubClient:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []
        self.init_kwargs = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, headers=None, extensions=None):
        self.calls.append((method, url, headers, extensions))
        if not self.outcomes:
            raise AssertionError(f"unexpected request: {method} {url}")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def install_stub_http(monkeypatch, outcomes, *, url_factory=httpx.URL):
    """Replace ``url_safety.httpx`` so no socket is ever opened."""
    client = StubClient(outcomes)

    def make_client(**kwargs):
        client.init_kwargs = kwargs
        return client

    monkeypatch.setattr(
        url_safety,
        "httpx",
        types.SimpleNamespace(
            Client=make_client,
            Limits=httpx.Limits,
            URL=url_factory,
            HTTPError=httpx.HTTPError,
            InvalidURL=httpx.InvalidURL,
        ),
    )
    return client


# ---------------------------------------------------------------------------
# is_blocked_ip / is_private_hostname
# ---------------------------------------------------------------------------


def test_blocks_loopback_and_private_ips():
    assert is_blocked_ip("127.0.0.1") is True
    assert is_blocked_ip("10.0.0.5") is True
    assert is_blocked_ip("192.168.1.1") is True
    assert is_blocked_ip("169.254.169.254") is True
    assert is_blocked_ip("8.8.8.8") is False


def test_blocked_ip_rejects_unparseable_values():
    for value in ("", "not-an-ip", "999.1.1.1", "127.0.0.1:80", "::ffff:zz"):
        assert is_blocked_ip(value) is True, value


def test_blocked_ip_rejects_shared_address_space():
    """RFC 6598 CGNAT space is routable inside many hosting networks.

    Python 3.13 stopped reporting 100.64.0.0/10 as ``is_private``, so this is a
    regression guard on the ``is_global`` fallback rather than on stdlib flags.
    """
    assert is_blocked_ip("100.64.0.1") is True
    assert is_blocked_ip("100.127.255.255") is True
    assert is_blocked_ip("100.128.0.1") is False


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


def test_private_hostname_uses_resolver(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    assert is_private_hostname("cdn.example.com") is False

    install_stub_resolver(monkeypatch, fixed_resolver("10.0.0.9"))
    assert is_private_hostname("cdn.example.com") is True


def test_is_public_http_url_survives_idna_hostile_hosts():
    """getaddrinfo raises UnicodeError (not OSError) on empty/over-long labels."""
    assert is_public_http_url("http://foo..bar/a.png", resolve_dns=True) is False
    assert is_public_http_url("http://" + "a" * 300 + ".example/a.png", resolve_dns=True) is False


# ---------------------------------------------------------------------------
# resolve_public_host_addresses
# ---------------------------------------------------------------------------


def test_resolve_returns_every_public_answer(monkeypatch):
    calls = install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "93.184.216.5"))

    assert resolve_public_host_addresses("cdn.example.com", 443) == ("93.184.216.34", "93.184.216.5")
    assert calls == [("cdn.example.com", 443)]


def test_resolve_orders_ipv4_before_ipv6(monkeypatch):
    """Many egress networks are IPv4-only; the security posture is identical."""
    install_stub_resolver(monkeypatch, fixed_resolver("2606:2800::1", PUBLIC_V4))

    assert resolve_public_host_addresses("cdn.example.com") == (PUBLIC_V4, "2606:2800::1")


def test_resolve_deduplicates_repeated_answers(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, PUBLIC_V4))

    assert resolve_public_host_addresses("cdn.example.com") == (PUBLIC_V4,)


def test_resolve_rejects_when_every_answer_is_private(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver("10.0.0.1", "192.168.0.2"))

    assert resolve_public_host_addresses("intranet.example.com") == ()


def test_resolve_fails_closed_on_mixed_public_and_private_answers(monkeypatch):
    """A single private answer poisons the whole set.

    Returning only the public subset would leave the attacker one resolver
    retry away from the private peer, so the guard must refuse outright.
    """
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "127.0.0.1"))

    assert resolve_public_host_addresses("rebind.example.com") == ()


def test_resolve_fails_closed_on_private_ipv6_answer(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "::1"))

    assert resolve_public_host_addresses("rebind.example.com") == ()


def test_resolve_strips_zone_id_before_classifying(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver("fe80::1%eth0"))

    assert resolve_public_host_addresses("router.example.com") == ()


def test_resolve_handles_nxdomain_and_empty_answers(monkeypatch):
    install_stub_resolver(monkeypatch, lambda host, port: socket.gaierror("nxdomain"))
    assert resolve_public_host_addresses("missing.example.com") == ()

    install_stub_resolver(monkeypatch, lambda host, port: OSError("network down"))
    assert resolve_public_host_addresses("missing.example.com") == ()

    install_stub_resolver(monkeypatch, fixed_resolver())
    assert resolve_public_host_addresses("empty.example.com") == ()


def test_resolve_skips_dns_for_literal_ips(monkeypatch):
    def explode(host, port):
        raise AssertionError("literal IPs must not be resolved")

    install_stub_resolver(monkeypatch, explode)

    assert resolve_public_host_addresses(PUBLIC_V4) == (PUBLIC_V4,)
    assert resolve_public_host_addresses("127.0.0.1") == ()
    assert resolve_public_host_addresses("") == ()


def test_resolve_normalizes_trailing_dot_before_blocklist(monkeypatch):
    def explode(host, port):
        raise AssertionError("blocked names must not be resolved")

    install_stub_resolver(monkeypatch, explode)

    assert resolve_public_host_addresses("localhost.") == ()
    assert resolve_public_host_addresses("metadata.google.internal.") == ()
    assert resolve_public_host_addresses("metadata") == ()
    assert resolve_public_host_addresses("api.localhost") == ()


# ---------------------------------------------------------------------------
# build_pinned_http_targets
# ---------------------------------------------------------------------------


def test_pins_hostname_to_resolved_ip_and_preserves_host_and_sni(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    targets = build_pinned_http_targets("https://cdn.example.com/a.png?v=1")

    assert len(targets) == 1
    assert targets[0].fetch_url == f"https://{PUBLIC_V4}/a.png?v=1"
    assert targets[0].host_header == "cdn.example.com"
    assert targets[0].sni_hostname == "cdn.example.com"


def test_plain_http_carries_no_sni(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    (target,) = build_pinned_http_targets("http://cdn.example.com/a.png")

    assert target.sni_hostname is None
    assert target.host_header == "cdn.example.com"


def test_one_target_per_public_answer(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "93.184.216.5"))

    targets = build_pinned_http_targets("https://cdn.example.com/a.png")

    assert [t.fetch_url for t in targets] == [
        f"https://{PUBLIC_V4}/a.png",
        "https://93.184.216.5/a.png",
    ]
    assert {t.host_header for t in targets} == {"cdn.example.com"}
    assert {t.sni_hostname for t in targets} == {"cdn.example.com"}


def test_mixed_dns_answer_produces_no_targets(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "169.254.169.254"))

    assert build_pinned_http_targets("https://rebind.example.com/a.png") == ()


@pytest.mark.parametrize(
    "url",
    [
        "https://user:pass@cdn.example.com/a.png",
        "https://user@cdn.example.com/a.png",
        "https://:pass@cdn.example.com/a.png",
    ],
)
def test_rejects_urls_carrying_credentials(url, monkeypatch):
    """Userinfo would either leak a secret upstream or confuse Host/redirects."""
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    assert build_pinned_http_targets(url) == ()


def test_ipv6_literal_host_header_is_bracketed_and_sni_omitted(monkeypatch):
    def explode(host, port):
        raise AssertionError("literal IPs must not be resolved")

    install_stub_resolver(monkeypatch, explode)

    (target,) = build_pinned_http_targets("https://[2606:2800:220:1:248:1893:25c8:1946]/a.png")

    assert target.fetch_url == "https://[2606:2800:220:1:248:1893:25c8:1946]/a.png"
    assert target.host_header == "[2606:2800:220:1:248:1893:25c8:1946]"
    # RFC 6066: SNI carries a DNS name; a literal address must not be sent.
    assert target.sni_hostname is None


def test_ipv4_literal_omits_sni(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    (target,) = build_pinned_http_targets(f"https://{PUBLIC_V4}/a.png")

    assert target.sni_hostname is None
    assert target.host_header == PUBLIC_V4


@pytest.mark.parametrize(
    "url,expected_host_header",
    [
        ("https://cdn.example.com:8443/a.png", "cdn.example.com:8443"),
        ("http://cdn.example.com:8080/a.png", "cdn.example.com:8080"),
        # Default ports stay implicit so the Host header matches what a browser
        # would send and virtual-host routing keeps working.
        ("https://cdn.example.com:443/a.png", "cdn.example.com"),
        ("http://cdn.example.com:80/a.png", "cdn.example.com"),
        ("https://cdn.example.com/a.png", "cdn.example.com"),
    ],
)
def test_host_header_port_handling(url, expected_host_header, monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    (target,) = build_pinned_http_targets(url)

    assert target.host_header == expected_host_header


def test_ipv6_literal_with_non_default_port(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    (target,) = build_pinned_http_targets("https://[2606:2800::1]:8443/a.png")

    assert target.host_header == "[2606:2800::1]:8443"
    assert target.fetch_url == "https://[2606:2800::1]:8443/a.png"


def test_idn_host_is_punycoded_in_host_header_and_sni(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    (target,) = build_pinned_http_targets("https://例え.テスト/a.png")

    assert target.host_header == "xn--r8jz45g.xn--zckzah"
    assert target.sni_hostname == "xn--r8jz45g.xn--zckzah"
    assert target.fetch_url == f"https://{PUBLIC_V4}/a.png"


@pytest.mark.parametrize(
    "url",
    [
        # urlparse raises ValueError("Invalid IPv6 URL") — this reached
        # /proxy-image as a 500 with a stack trace before it was contained.
        "http://ex[ample.com:1/img.png",
        "http://[fe80::1/img.png",
        "http://cdn.example.com:99999/a.png",
        "http://cdn.example.com:notaport/a.png",
        "",
        "   ",
        None,
    ],
)
def test_malformed_urls_yield_no_targets_instead_of_raising(url, monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    assert build_pinned_http_targets(url) == ()


def test_httpx_invalid_url_is_not_a_value_error():
    """Guards the except-tuple: catching ValueError alone would miss this."""
    assert not issubclass(httpx.InvalidURL, ValueError)


@pytest.mark.parametrize(
    "url",
    [
        "http://exa\x00mple.com/a.png",
        "http://" + "é" * 70 + ".example/a.png",
    ],
)
def test_urls_rejected_by_httpx_yield_no_targets(url, monkeypatch):
    """These pass urlparse and DNS, then blow up inside httpx.URL."""
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    assert build_pinned_http_targets(url) == ()


def test_invalid_url_raised_by_httpx_is_contained(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))

    def raising_url(_value):
        raise httpx.InvalidURL("nope")

    install_stub_http(monkeypatch, [], url_factory=raising_url)

    assert build_pinned_http_targets("https://cdn.example.com/a.png") == ()


# ---------------------------------------------------------------------------
# sniff_raster_image_content_type
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body,expected",
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (GIF87, "image/gif"),
        (GIF89, "image/gif"),
        (WEBP, "image/webp"),
    ],
    ids=["png", "jpeg", "gif87a", "gif89a", "webp"],
)
def test_sniff_recognizes_allowed_raster_formats(body, expected):
    assert sniff_raster_image_content_type(body) == expected


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"<html><body>hi</body></html>",
        b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>",
        b"%PDF-1.7",
        b"GIF88a-not-a-real-signature",
        b"RIFF\x00\x00\x00\x00WAVEfmt ",
        b"\x89PNG",
        b"\x89PNG\r\n\x1a",
        b"\xff\xd8",
        b"RIFF\x00\x00\x00\x00WEB",
        b"\x00" + PNG,
    ],
    ids=[
        "empty",
        "html",
        "svg-active-content",
        "pdf",
        "near-miss-gif",
        "riff-but-wave",
        "truncated-png-4",
        "truncated-png-7",
        "truncated-jpeg",
        "truncated-webp",
        "signature-not-at-offset-zero",
    ],
)
def test_sniff_rejects_non_raster_and_truncated_bodies(body):
    assert sniff_raster_image_content_type(body) is None


def test_sniff_ignores_declared_content_type():
    """A body served as image/png but containing HTML must still be refused."""
    assert sniff_raster_image_content_type(b"<html>not an image</html>") is None


# ---------------------------------------------------------------------------
# download_public_image_bytes
# ---------------------------------------------------------------------------


def _ok_png(**overrides):
    kwargs = {"headers": {"content-type": "image/png"}, "chunks": [PNG]}
    kwargs.update(overrides)
    return StubResponse(**kwargs)


def test_download_returns_body_and_sniffed_type(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    client = install_stub_http(monkeypatch, [_ok_png()])

    body, content_type = download_public_image_bytes("https://cdn.example.com/a.png")

    assert body == PNG
    assert content_type == "image/png"
    method, url, headers, extensions = client.calls[0]
    assert (method, url) == ("GET", f"https://{PUBLIC_V4}/a.png")
    assert headers == {"Host": "cdn.example.com"}
    assert extensions == {"sni_hostname": "cdn.example.com"}


def test_download_client_is_isolated_and_does_not_pool_connections(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    client = install_stub_http(monkeypatch, [_ok_png()])

    download_public_image_bytes("https://cdn.example.com/a.png", user_agent="UA/9")

    assert client.init_kwargs["follow_redirects"] is False
    assert client.init_kwargs["trust_env"] is False
    assert client.init_kwargs["headers"] == {"User-Agent": "UA/9"}
    assert client.init_kwargs["limits"].max_keepalive_connections == 0


def test_download_sends_no_sni_extension_over_plain_http(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    client = install_stub_http(monkeypatch, [_ok_png()])

    download_public_image_bytes("http://cdn.example.com/a.png")

    assert client.calls[0][3] is None


def test_download_accepts_octet_stream_when_body_is_a_real_image(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(
        monkeypatch,
        [StubResponse(headers={"content-type": "application/octet-stream"}, chunks=[JPEG])],
    )

    body, content_type = download_public_image_bytes("https://cdn.example.com/a.bin")

    assert (body, content_type) == (JPEG, "image/jpeg")


def test_download_rejects_body_that_is_not_a_raster_image(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(
        monkeypatch,
        [StubResponse(headers={"content-type": "image/png"}, chunks=[b"<html></html>"])],
    )

    with pytest.raises(ValueError, match="not a supported raster image"):
        download_public_image_bytes("https://cdn.example.com/fake.png")


def test_download_rejects_disallowed_content_type(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(
        monkeypatch,
        [StubResponse(headers={"content-type": "image/svg+xml"}, chunks=[b"<svg/>"])],
    )

    with pytest.raises(ValueError, match="unsupported content-type"):
        download_public_image_bytes("https://cdn.example.com/a.svg")


def test_download_rejects_non_200_status(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(monkeypatch, [StubResponse(status_code=404, headers={})])

    with pytest.raises(ValueError, match="upstream http 404"):
        download_public_image_bytes("https://cdn.example.com/missing.png")


def test_download_rejects_declared_oversize_without_reading_body(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    response = StubResponse(
        headers={
            "content-type": "image/png",
            "content-length": str(MAX_IMAGE_DOWNLOAD_BYTES + 1),
        },
        chunks=[PNG],
    )
    install_stub_http(monkeypatch, [response])

    with pytest.raises(ValueError, match="image too large"):
        download_public_image_bytes("https://cdn.example.com/huge.png")
    assert response.consumed is False


def test_download_rejects_malformed_content_length(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(
        monkeypatch,
        [StubResponse(headers={"content-type": "image/png", "content-length": "abc"})],
    )

    with pytest.raises(ValueError, match="invalid content-length"):
        download_public_image_bytes("https://cdn.example.com/a.png")


def test_download_rejects_body_exceeding_cap_mid_stream(monkeypatch):
    """A lying/absent content-length must not defeat the size cap."""
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(
        monkeypatch,
        [
            StubResponse(
                headers={"content-type": "image/png"},
                chunks=[PNG, b"x" * 64, b"y" * 64],
            )
        ],
    )

    with pytest.raises(ValueError, match="image too large"):
        download_public_image_bytes("https://cdn.example.com/a.png", max_bytes=100)


@pytest.mark.parametrize("url", ["", "   ", None])
def test_download_rejects_empty_url(url):
    with pytest.raises(ValueError, match="empty image url"):
        download_public_image_bytes(url)


def test_download_rejects_private_target_before_any_request(monkeypatch):
    client = install_stub_http(monkeypatch, [])

    with pytest.raises(ValueError, match="not a public http"):
        download_public_image_bytes("http://169.254.169.254/latest/meta-data")

    assert client.calls == []


def test_download_follows_redirect_after_revalidating(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    client = install_stub_http(
        monkeypatch,
        [
            StubResponse(status_code=302, headers={"location": "/cdn/real.png"}),
            _ok_png(),
        ],
    )

    body, _ = download_public_image_bytes("https://cdn.example.com/a.png")

    assert body == PNG
    assert [call[1] for call in client.calls] == [
        f"https://{PUBLIC_V4}/a.png",
        f"https://{PUBLIC_V4}/cdn/real.png",
    ]


def test_download_revalidates_cross_host_redirect_and_rejects_private_hop(monkeypatch):
    """The whole point of hop-by-hop revalidation: a 302 into the metadata IP."""
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    client = install_stub_http(
        monkeypatch,
        [
            StubResponse(
                status_code=302,
                headers={"location": "http://169.254.169.254/latest/meta-data"},
            )
        ],
    )

    with pytest.raises(ValueError, match="not a public http"):
        download_public_image_bytes("https://cdn.example.com/a.png")

    assert len(client.calls) == 1


def test_download_rejects_redirect_without_location(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    install_stub_http(monkeypatch, [StubResponse(status_code=302, headers={})])

    with pytest.raises(ValueError, match="redirect without location"):
        download_public_image_bytes("https://cdn.example.com/a.png")


def test_download_stops_after_the_redirect_budget(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4))
    hops = [
        StubResponse(status_code=302, headers={"location": f"/hop{i}.png"})
        for i in range(MAX_REDIRECTS + 1)
    ]
    client = install_stub_http(monkeypatch, hops)

    with pytest.raises(ValueError, match="failed to download image"):
        download_public_image_bytes("https://cdn.example.com/a.png")

    assert len(client.calls) == MAX_REDIRECTS + 1


def test_download_tries_the_next_pinned_address_on_transport_error(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "93.184.216.5"))
    client = install_stub_http(monkeypatch, [httpx.ConnectError("refused"), _ok_png()])

    body, _ = download_public_image_bytes("https://cdn.example.com/a.png")

    assert body == PNG
    assert [call[1] for call in client.calls] == [
        f"https://{PUBLIC_V4}/a.png",
        "https://93.184.216.5/a.png",
    ]


def test_download_reraises_transport_error_when_every_address_fails(monkeypatch):
    install_stub_resolver(monkeypatch, fixed_resolver(PUBLIC_V4, "93.184.216.5"))
    install_stub_http(
        monkeypatch,
        [httpx.ConnectError("refused"), httpx.ConnectTimeout("timeout")],
    )

    with pytest.raises(httpx.ConnectTimeout):
        download_public_image_bytes("https://cdn.example.com/a.png")


def test_download_rejects_malformed_url_as_non_public(monkeypatch):
    client = install_stub_http(monkeypatch, [])

    with pytest.raises(ValueError, match="not a public http"):
        download_public_image_bytes("http://ex[ample.com:1/a.png")

    assert client.calls == []
