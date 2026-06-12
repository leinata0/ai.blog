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
        # Mirror httpx's response.extensions["network_stream"] so the proxy's
        # post-connect peer-IP check (DNS rebinding guard) can be exercised.
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

    def stream(self, method, url):
        self.calls.append((method, url))
        if not self.responses:
            raise AssertionError(f"Unexpected proxy fetch: {method} {url}")
        return self.responses.pop(0)


def test_proxy_image_rejects_invalid_scheme(client):
    response = client.get("/proxy-image", params={"url": "ftp://example.com/image.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"


def test_proxy_image_rejects_private_host_before_fetch(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: True)

    response = client.get("/proxy-image", params={"url": "http://127.0.0.1/image.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"
    assert fake_client.calls == []


def test_proxy_image_returns_successful_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"image-bytes"],
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == b"image-bytes"
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["cache-control"] == "public, max-age=86400, stale-while-revalidate=604800"
    assert response.headers["access-control-allow-origin"] == "*"
    assert fake_client.calls == [("GET", "https://example.com/image.png")]


def test_proxy_image_rejects_non_image_upstream(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "text/html"},
            chunks=[b"<html></html>"],
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/page"})

    assert response.status_code == 502
    assert response.text == "Upstream image unavailable"


def test_proxy_image_rejects_declared_oversize_image(client, monkeypatch):
    import app.main as main_mod

    upstream = FakeStreamResponse(
        headers={
            "content-type": "image/png",
            "content-length": str(main_mod.MAX_PROXY_IMAGE_BYTES + 1),
        },
        chunks=[b"not-read"],
    )
    fake_client = FakeHttpClient([upstream])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

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
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/large.png"})

    assert response.status_code == 502
    assert response.text == "Upstream image too large"


def test_proxy_image_rejects_redirect_to_private_host(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(status_code=302, headers={"location": "http://127.0.0.1/private.png"}),
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: hostname == "127.0.0.1")

    response = client.get("/proxy-image", params={"url": "https://example.com/redirect.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"
    assert fake_client.calls == [("GET", "https://example.com/redirect.png")]


def test_proxy_image_allows_redirect_to_public_image(client, monkeypatch):
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(status_code=302, headers={"location": "/cdn/image.png"}),
        FakeStreamResponse(headers={"content-type": "image/png"}, chunks=[b"redirect-image"]),
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/redirect.png"})

    assert response.status_code == 200
    assert response.content == b"redirect-image"
    assert fake_client.calls == [
        ("GET", "https://example.com/redirect.png"),
        ("GET", "https://example.com/cdn/image.png"),
    ]


def test_proxy_image_rejects_rebinding_to_private_peer(client, monkeypatch):
    """Hostname passes the pre-fetch check but the connection lands on a private
    IP (DNS rebinding). The post-connect peer check must reject it."""
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"should-not-be-served"],
            peer_ip="169.254.169.254",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    # Pre-fetch DNS check passes (attacker's name still resolves public here).
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 400
    assert response.text == "Invalid URL"


def test_proxy_image_allows_public_peer(client, monkeypatch):
    """A connection that lands on a public IP passes the post-connect check."""
    import app.main as main_mod

    fake_client = FakeHttpClient([
        FakeStreamResponse(
            headers={"content-type": "image/png"},
            chunks=[b"image-bytes"],
            peer_ip="93.184.216.34",
        )
    ])
    monkeypatch.setattr(main_mod, "_http_client", fake_client)
    monkeypatch.setattr(main_mod, "_is_private_hostname", lambda hostname: False)

    response = client.get("/proxy-image", params={"url": "https://example.com/image.png"})

    assert response.status_code == 200
    assert response.content == b"image-bytes"
