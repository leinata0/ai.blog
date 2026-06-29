"""Tests for Cloudflare Turnstile gating on register/login."""


def _register_payload(email="turnstile@example.com", **extra):
    return {"email": email, "password": "secret123", **extra}


def test_register_skips_turnstile_when_unconfigured(client):
    # No TURNSTILE_SECRET_KEY in test env → verification skipped, register works.
    resp = client.post("/api/users/register", json=_register_payload())
    assert resp.status_code == 200, resp.text


def test_register_blocked_when_turnstile_fails(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-test")
    monkeypatch.setattr("app.routers.users.verify_turnstile", lambda token, ip: False)
    resp = client.post(
        "/api/users/register",
        json=_register_payload(turnstile_token="bad-token"),
    )
    assert resp.status_code == 400


def test_register_passes_when_turnstile_succeeds(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-test")
    monkeypatch.setattr("app.routers.users.verify_turnstile", lambda token, ip: True)
    resp = client.post(
        "/api/users/register",
        json=_register_payload(turnstile_token="good-token"),
    )
    assert resp.status_code == 200, resp.text


def test_login_blocked_when_turnstile_fails(client, monkeypatch):
    # register while unconfigured
    client.post("/api/users/register", json=_register_payload(email="li@example.com"))
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret-test")
    monkeypatch.setattr("app.routers.users.verify_turnstile", lambda token, ip: False)
    resp = client.post(
        "/api/users/login",
        json={"email": "li@example.com", "password": "secret123", "turnstile_token": "bad"},
    )
    assert resp.status_code == 400


def test_verify_turnstile_unit_unconfigured_returns_true(monkeypatch):
    from app.turnstile import verify_turnstile, turnstile_ready
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    assert turnstile_ready() is False
    assert verify_turnstile(None) is True  # unconfigured → pass-through
