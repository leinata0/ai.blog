"""请求体上限必须在 ASGI 层生效，而不是等 handler 去读。

`POST /api/admin/upload` 里的 `file.file.read(MAX_UPLOAD_SIZE + 1)` 只保护了内存：
Starlette 在调用 handler 之前就把整个 multipart 落到临时文件了，磁盘那一下已经发生。
uvicorn 没有自己的请求体上限，所以在中间件之前，一个请求就能把容器磁盘写满。

公开 JSON 端点（订阅、评论）同理，而且它们连认证都不需要。
"""

import io
import json

import pytest

from app.request_limits import (
    DEFAULT_MAX_REQUEST_BODY_BYTES,
    UPLOAD_BODY_LIMIT_SLACK_BYTES,
    RequestBodySizeLimitMiddleware,
)
from app.storage import MAX_UPLOAD_SIZE


def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _limit_middleware(client):
    """从跑起来的 app 里翻出中间件实例，确认它真的挂上去了。"""
    app = client.app
    for middleware in app.user_middleware:
        if middleware.cls is RequestBodySizeLimitMiddleware:
            return middleware
    raise AssertionError("RequestBodySizeLimitMiddleware is not installed on the app")


def test_the_body_limit_middleware_is_installed_with_per_route_limits(client):
    middleware = _limit_middleware(client)
    kwargs = middleware.kwargs

    assert kwargs["default_limit"] == DEFAULT_MAX_REQUEST_BODY_BYTES
    # 上传路由拿到的是图片上限 + multipart 开销，而不是默认的 JSON 上限
    assert kwargs["upload_limits"]["/api/admin/upload"] == MAX_UPLOAD_SIZE + UPLOAD_BODY_LIMIT_SLACK_BYTES
    assert kwargs["upload_limits"]["/api/admin/upload"] > DEFAULT_MAX_REQUEST_BODY_BYTES


def test_an_oversized_upload_is_refused_before_the_handler_runs(client, monkeypatch, upload_dir):
    """413 必须来自中间件：save_upload / validate_image_upload 一次都不能被调用。"""
    from app.routers import admin as admin_mod

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("the oversized body reached the upload handler")

    monkeypatch.setattr(admin_mod, "validate_image_upload", _fail_if_called)
    monkeypatch.setattr(admin_mod, "save_upload", _fail_if_called)

    token = _login(client)
    oversized = b"\xff\xd8\xff" + b"0" * (MAX_UPLOAD_SIZE + UPLOAD_BODY_LIMIT_SLACK_BYTES + 1)

    resp = client.post(
        "/api/admin/upload",
        files={"file": ("huge.jpg", io.BytesIO(oversized), "image/jpeg")},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 413
    assert resp.json()["code"] == "http_413"


def test_a_normal_upload_still_goes_through(client, upload_dir):
    """上限不能把正常上传一起挡掉。"""
    token = _login(client)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        + b"0" * 64
    )

    resp = client.post(
        "/api/admin/upload",
        files={"file": ("tiny.png", io.BytesIO(png), "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200
    assert resp.json()["url"]


def test_an_oversized_json_body_is_refused_on_a_public_endpoint(client):
    """公开端点没有认证，而 request.json() 会把整个 body 读进内存。"""
    payload = json.dumps({"email": "reader@example.com", "note": "x" * (DEFAULT_MAX_REQUEST_BODY_BYTES + 1)})

    resp = client.post(
        "/api/subscriptions/email",
        content=payload,
        headers={"Content-Type": "application/json"},
    )

    assert resp.status_code == 413


def test_a_normal_json_body_is_untouched(client):
    resp = client.post("/api/subscriptions/email", json={"email": "not-an-email"})
    assert resp.status_code == 400  # 业务校验，不是 413


def test_a_chunked_body_without_content_length_is_still_bounded(client):
    """光看 Content-Length 拦不住 chunked 请求：中间件必须一边收一边数。"""
    limit = DEFAULT_MAX_REQUEST_BODY_BYTES
    chunk = b"x" * 256 * 1024

    def _chunks():
        sent = 0
        while sent <= limit:
            yield chunk
            sent += len(chunk)

    resp = client.post(
        "/api/subscriptions/email",
        content=_chunks(),
        headers={"Content-Type": "application/json"},
    )

    assert resp.status_code == 413
    assert "content-length" not in {key.lower() for key in resp.request.headers}


@pytest.mark.parametrize("path,expected_key", [("/api/admin/upload", "/api/admin/upload"), ("/api/posts", None)])
def test_limit_for_falls_back_to_the_default(path, expected_key):
    middleware = RequestBodySizeLimitMiddleware(
        app=None, default_limit=100, upload_limits={"/api/admin/upload": 999}
    )
    assert middleware.limit_for(path) == (999 if expected_key else 100)
