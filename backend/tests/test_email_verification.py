"""Tests for email soft-verification: token flow, resend, write soft-blocking."""
from sqlalchemy import select

from app.email_verification import issue_verify_token
from app.models import User


def _register(client, email="verify@example.com", password="secret123"):
    resp = client.post("/api/users/register", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ah(token):
    return {"Authorization": f"Bearer {token}"}


def _published_slug(client):
    return client.get("/api/posts").json()["items"][0]["slug"]


def test_new_user_starts_unverified(client):
    assert _register(client)["user"]["email_verified"] is False


def test_verify_email_with_valid_token(client, db_session):
    reg = _register(client)
    user_id = reg["user"]["id"]
    token = issue_verify_token(user_id)

    resp = client.post("/api/users/verify-email", json={"token": token})
    assert resp.status_code == 200, resp.text
    assert resp.json()["email_verified"] is True
    # persisted
    user = db_session.get(User, user_id)
    assert user.email_verified is True


def test_verify_email_with_invalid_token(client):
    _register(client)
    resp = client.post("/api/users/verify-email", json={"token": "garbage.token.here"})
    assert resp.status_code == 400


def test_unverified_user_cannot_comment(client):
    reg = _register(client)
    slug = _published_slug(client)
    resp = client.post(
        f"/api/posts/{slug}/comments",
        json={"content": "should be blocked"},
        headers=_ah(reg["access_token"]),
    )
    assert resp.status_code == 403


def test_unverified_user_cannot_like(client):
    reg = _register(client)
    slug = _published_slug(client)
    resp = client.post(f"/api/posts/{slug}/like", headers=_ah(reg["access_token"]))
    assert resp.status_code == 403


def test_verified_user_can_comment(client, db_session):
    reg = _register(client)
    user = db_session.get(User, reg["user"]["id"])
    user.email_verified = True
    db_session.commit()

    slug = _published_slug(client)
    resp = client.post(
        f"/api/posts/{slug}/comments",
        json={"content": "now allowed"},
        headers=_ah(reg["access_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_registered"] is True


def test_resend_verification_without_email_config_returns_503(client):
    # RESEND_API_KEY/EMAIL_FROM are unset in tests, so delivery is unavailable.
    reg = _register(client)
    resp = client.post("/api/users/resend-verification", headers=_ah(reg["access_token"]))
    assert resp.status_code == 503


def test_resend_verification_when_already_verified(client, db_session):
    reg = _register(client)
    user = db_session.get(User, reg["user"]["id"])
    user.email_verified = True
    db_session.commit()
    resp = client.post("/api/users/resend-verification", headers=_ah(reg["access_token"]))
    assert resp.status_code == 200


def test_verify_token_audience_isolation(client):
    # A login token (aud="user") must NOT work as a verification token.
    reg = _register(client)
    resp = client.post("/api/users/verify-email", json={"token": reg["access_token"]})
    assert resp.status_code == 400
