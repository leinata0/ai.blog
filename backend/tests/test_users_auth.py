"""Tests for the visitor user auth API (register / login / profile)."""


def _register(client, email="visitor@example.com", password="secret123", nickname=None):
    payload = {"email": email, "password": password}
    if nickname is not None:
        payload["nickname"] = nickname
    return client.post("/api/users/register", json=payload)


def test_register_success_returns_token_and_user(client):
    resp = _register(client, nickname="Visitor One")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["token_type"] == "bearer"
    assert data["access_token"]
    assert data["user"]["email"] == "visitor@example.com"
    assert data["user"]["nickname"] == "Visitor One"
    assert data["user"]["email_verified"] is False


def test_register_default_nickname_from_email(client):
    resp = _register(client, email="alice@example.com")
    assert resp.status_code == 200
    assert resp.json()["user"]["nickname"] == "alice"


def test_register_duplicate_email_conflict(client):
    assert _register(client).status_code == 200
    resp = _register(client)
    assert resp.status_code == 409


def test_register_invalid_email(client):
    resp = _register(client, email="not-an-email")
    assert resp.status_code == 400


def test_register_weak_password_rejected(client):
    resp = _register(client, password="short")
    assert resp.status_code == 422


def test_login_success(client):
    _register(client)
    resp = client.post("/api/users/login", json={"email": "visitor@example.com", "password": "secret123"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]


def test_login_wrong_password(client):
    _register(client)
    resp = client.post("/api/users/login", json={"email": "visitor@example.com", "password": "wrongpass"})
    assert resp.status_code == 401


def test_login_unknown_email(client):
    resp = client.post("/api/users/login", json={"email": "ghost@example.com", "password": "secret123"})
    assert resp.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/users/me").status_code in (401, 403)


def test_me_with_token(client):
    token = _register(client).json()["access_token"]
    resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "visitor@example.com"


def test_update_profile(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.put("/api/users/me", json={"nickname": "Renamed"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["nickname"] == "Renamed"


def test_change_password(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post(
        "/api/users/me/password",
        json={"old_password": "secret123", "new_password": "newsecret456"},
        headers=headers,
    )
    assert resp.status_code == 200
    # old password no longer works
    assert client.post("/api/users/login", json={"email": "visitor@example.com", "password": "secret123"}).status_code == 401
    # new password works
    assert client.post("/api/users/login", json={"email": "visitor@example.com", "password": "newsecret456"}).status_code == 200


def test_change_password_wrong_old(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post(
        "/api/users/me/password",
        json={"old_password": "wrongold", "new_password": "newsecret456"},
        headers=headers,
    )
    assert resp.status_code == 400
