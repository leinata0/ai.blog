from app.url_safety import PinnedHttpTarget


PNG_BYTES = b"\x89PNG\r\n\x1a\nimage-bytes"


class _FakeNetworkStream:
    def __init__(self, server_addr):
        self._server_addr = server_addr

    def get_extra_info(self, name):
        if name == "server_addr":
            return self._server_addr
        return None


class FakeStreamResponse:
    def __init__(self, status_code=200, headers=None, chunks=None, peer_ip=None):
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks or []
        self.consumed = False
        # Mirror httpx's response shape. DNS pinning no longer depends on this
        # optional transport-specific extension.
        self.extensions = {}
        if peer_ip is not None:
            self.extensions["network_stream"] = _FakeNetworkStream((peer_ip, 443))

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def aiter_bytes(self):
        self.consumed = True
        for chunk in self._chunks:
            yield chunk


class FakeHttpClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url))
        self.last_options = kwargs
        if not self.responses:
            raise AssertionError(f"Unexpected proxy fetch: {method} {url}")
        return self.responses.pop(0)


def _pin_example_url(url):
    return (
        PinnedHttpTarget(
            fetch_url=url.replace("example.com", "93.184.216.34"),
            host_header="example.com",
            sni_hostname="example.com" if url.startswith("https://") else None,
        ),
    )


def test_proxy_image_rejects_invalid_scheme(client):
    response = client.get("/proxy-image", params={"url": "ftp://example.com/image.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"


def test_proxy_image_rejects_private_host_before_fetch(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", lambda url: ())

    response = client.get("/proxy-image", params={"url": "http://127.0.0.1/image.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"
    assert fake_client.calls == []


def test_proxy_image_returns_successful_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[PNG_BYTES],
            peer_ip="93.184.216.34",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["cache-control"] == "public, max-age=86400, stale-while-revalidate=604800"
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert fake_client.calls == [("GET", "https://93.184.216.34/image.png")]
    assert fake_client.last_options == {
        "headers": {"Host": "example.com"},
        "extensions": {"sni_hostname": "example.com"},
    }


def test_proxy_image_client_does_not_reuse_tls_connections_across_pinned_hosts():
    import app.main as main_mod

    pool = main_mod._http_client._transport._pool

    assert pool._max_keepalive_connections == 0


def test_proxy_image_rejects_non_image_upstream(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "text/html"},
            chunks=[b"<html></html>"],
            peer_ip="93.184.216.34",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/page"})

    assert response.status_code == 502
    assert response.text == "Upstream image unavailable"


def test_proxy_image_accepts_octet_stream_when_body_is_a_real_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "application/octet-stream"},
            chunks=[PNG_BYTES],
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.bin"})

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"].startswith("image/png")


def test_proxy_image_rejects_spoofed_image_content_type(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"<html>not an image</html>"],
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/fake.png"})

    assert response.status_code == 502
    assert response.text == "Upstream image unavailable"


def test_proxy_image_resolves_ordinary_hostname_and_pins_public_ip(client, monkeypatch):
    """Regression: non-IP hostnames must not be treated as blocked literals."""
    import socket

    import app.main as main_mod
    import app.url_safety as url_safety

    fake_client = FakeHttpClient([
        FakeStreamResponse(headers={"content-type": "image/png"}, chunks=[PNG_BYTES])
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(
        url_safety.socket,
        "getaddrinfo",
        lambda host, port, type: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 443))
        ],
    )

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert fake_client.calls == [("GET", "https://93.184.216.34/image.png")]


def test_proxy_image_rejects_declared_oversize_image(client, monkeypatch):
    import app.main as main_mod

    upstream = FakeStreamResponse(
        headers={
            "content-type": "image/png",
            "content-length": str(main_mod.MAX_PROXY_IMAGE_BYTES + 1),
        },
        chunks=[b"not-read"],
        peer_ip="93.184.216.34",
    )
    fake_client = FakeHttpClient([upstream])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/large.png"})

    assert response.status_code == 502
    assert response.text == "Upstream image too large"
    assert upstream.consumed is False


def test_proxy_image_rejects_streamed_oversize_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"x" * main_mod.MAX_PROXY_IMAGE_BYTES, b"x"],
            peer_ip="93.184.216.34",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/large.png"})

    assert response.status_code == 502
    assert response.text == "Upstream image too large"


def test_proxy_image_rejects_redirect_to_private_host(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            status_code=302,
            headers={"location": "http://127.0.0.1/private.png"},
            peer_ip="93.184.216.34",
        ),
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(
        main_mod,
        "_resolve_proxy_targets",
        lambda url: () if "127.0.0.1" in url else _pin_example_url(url),
    )

    response = client.get("/proxy-image", params={"url": "https://example.com/redirect.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"
    assert fake_client.calls == [("GET", "https://93.184.216.34/redirect.png")]


def test_proxy_image_allows_redirect_to_public_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            status_code=302,
            headers={"location": "/cdn/image.png"},
            peer_ip="93.184.216.34",
        ),
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"\x89PNG\r\n\x1a\nredirect-image"],
            peer_ip="93.184.216.34",
        ),
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/redirect.png"})

    assert response.status_code == 200
    assert response.content == b"\x89PNG\r\n\x1a\nredirect-image"
    assert fake_client.calls == [
        ("GET", "https://93.184.216.34/redirect.png"),
        ("GET", "https://93.184.216.34/cdn/image.png"),
    ]


def test_proxy_image_pins_dns_result_to_prevent_rebinding(client, monkeypatch):
    """The fetch must use the pre-resolved public IP, not resolve the hostname again."""
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[PNG_BYTES],
            peer_ip="169.254.169.254",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert fake_client.calls == [("GET", "https://93.184.216.34/image.png")]


def test_proxy_image_does_not_depend_on_transport_peer_extension(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[PNG_BYTES],
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == PNG_BYTES


def test_proxy_image_allows_public_transport_peer_metadata(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[PNG_BYTES],
            peer_ip="93.184.216.34",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_resolve_proxy_targets", _pin_example_url)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == PNG_BYTES
