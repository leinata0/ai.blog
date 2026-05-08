from fastapi import HTTPException
from jose import jwt

from app.auth import ALGORITHM, SECRET_KEY, TOKEN_AUDIENCE, TOKEN_ISSUER


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_api_health_endpoint_alias(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_unknown_route_keeps_framework_404_shape(client):
    resp = client.get("/api/does-not-exist")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Not Found"}


def test_http_exception_handler_returns_code_field(client):
    resp = client.get("/api/posts/not-a-real-slug")
    assert resp.status_code == 404
    assert resp.json()["code"] == "http_404"
    assert resp.json()["detail"]


def test_invalid_admin_token_returns_json_error(client):
    resp = client.get(
        "/api/admin/posts",
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid token", "code": "http_401"}


def test_admin_token_requires_expected_issuer_and_audience(client):
    token = jwt.encode(
        {
            "sub": "admin",
            "iss": f"{TOKEN_ISSUER}-wrong",
            "aud": f"{TOKEN_AUDIENCE}-wrong",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    resp = client.get(
        "/api/admin/posts",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid token", "code": "http_401"}
