"""End-to-end tests for email-code authentication and session revocation."""

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app import auth as auth_mod
from app.models import AuthChallenge, User


LOGIN_PURPOSE = "login"
PASSWORD_RESET_PURPOSE = "password_reset"


@pytest.fixture
def auth_mailbox(monkeypatch):
    """Capture auth codes at the delivery boundary without weakening storage checks."""
    from app.routers import users as users_router

    deliveries = []

    def _send(email, code, purpose):
        deliveries.append({"email": email, "code": code, "purpose": purpose})
        return True

    monkeypatch.setattr(users_router, "email_delivery_ready", lambda: True)
    monkeypatch.setattr(users_router, "send_auth_code_email", _send)
    return deliveries


def _authorization(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, email="member@example.com", password="secret123"):
    response = client.post(
        "/api/users/register",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _request_code(client, auth_mailbox, email, purpose=LOGIN_PURPOSE):
    path = "/api/users/login-code/request"
    if purpose == PASSWORD_RESET_PURPOSE:
        path = "/api/users/password-reset/request"
    response = client.post(path, json={"email": email})
    assert response.status_code == 200, response.text
    delivery = next(
        item
        for item in reversed(auth_mailbox)
        if item["email"] == email.strip().lower() and item["purpose"] == purpose
    )
    return response.json(), delivery["code"]


def _verify_login_code(client, email, challenge_id, code):
    return client.post(
        "/api/users/login-code/verify",
        json={"email": email, "challenge_id": challenge_id, "code": code},
    )


def test_login_code_is_hmac_digest_and_resend_is_cooled_down(
    client, db_session, auth_mailbox
):
    dispatch, code = _request_code(client, auth_mailbox, "  Secure@Example.com ")

    challenge = db_session.get(AuthChallenge, dispatch["challenge_id"])
    assert challenge is not None
    assert challenge.email == "secure@example.com"
    assert challenge.purpose == LOGIN_PURPOSE
    assert challenge.code_digest != code
    assert code not in challenge.code_digest
    assert len(challenge.code_digest) == 64
    expected_digest = hmac.new(
        auth_mod.SECRET_KEY.encode("utf-8"),
        f"{challenge.id}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert challenge.code_digest == expected_digest

    retry = client.post(
        "/api/users/login-code/request",
        json={"email": "secure@example.com"},
    )
    assert retry.status_code == 429
    assert 1 <= int(retry.headers["Retry-After"]) <= 60
    assert len(auth_mailbox) == 1


def test_existing_user_can_log_in_with_code_and_code_is_single_use(
    client, db_session, auth_mailbox
):
    registered = _register(client)
    dispatch, code = _request_code(client, auth_mailbox, "member@example.com")

    response = _verify_login_code(
        client, "member@example.com", dispatch["challenge_id"], code
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["user"]["id"] == registered["user"]["id"]
    assert data["user"]["email_verified"] is True
    assert data["user"]["password_set"] is True
    assert client.get(
        "/api/users/me", headers=_authorization(data["access_token"])
    ).status_code == 200

    consumed = _verify_login_code(
        client, "member@example.com", dispatch["challenge_id"], code
    )
    assert consumed.status_code == 400
    assert "无效或已过期" in consumed.json()["detail"]
    db_session.expire_all()
    assert db_session.get(AuthChallenge, dispatch["challenge_id"]).consumed_at is not None


def test_wrong_code_is_counted_then_unregistered_email_creates_passwordless_user(
    client, db_session, auth_mailbox
):
    email = "new-user@example.com"
    dispatch, code = _request_code(client, auth_mailbox, email)
    wrong_code = "000000" if code != "000000" else "999999"

    wrong = _verify_login_code(client, email, dispatch["challenge_id"], wrong_code)
    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "验证码错误"
    db_session.expire_all()
    challenge = db_session.get(AuthChallenge, dispatch["challenge_id"])
    assert challenge.attempts == 1
    assert challenge.consumed_at is None

    verified = _verify_login_code(client, email, dispatch["challenge_id"], code)
    assert verified.status_code == 200, verified.text
    auth = verified.json()
    assert auth["user"]["email"] == email
    assert auth["user"]["email_verified"] is True
    assert auth["user"]["password_set"] is False
    db_session.expire_all()
    user = db_session.execute(select(User).where(User.email == email)).scalar_one()
    assert user.password_set is False

    password_login = client.post(
        "/api/users/login",
        json={"email": email, "password": "not-a-real-password"},
    )
    assert password_login.status_code == 400
    assert "验证码登录" in password_login.json()["detail"]


def test_expired_login_code_is_rejected_and_consumed(
    client, db_session, auth_mailbox
):
    email = "expired@example.com"
    dispatch, code = _request_code(client, auth_mailbox, email)
    challenge = db_session.get(AuthChallenge, dispatch["challenge_id"])
    challenge.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = _verify_login_code(client, email, dispatch["challenge_id"], code)

    assert response.status_code == 400
    assert "无效或已过期" in response.json()["detail"]
    db_session.expire_all()
    challenge = db_session.get(AuthChallenge, dispatch["challenge_id"])
    assert challenge.consumed_at is not None
    assert db_session.execute(select(User).where(User.email == email)).scalar_one_or_none() is None


def test_login_code_is_locked_after_five_consecutive_wrong_attempts(
    client, db_session, auth_mailbox
):
    email = "locked@example.com"
    dispatch, code = _request_code(client, auth_mailbox, email)
    wrong_code = "000000" if code != "000000" else "999999"

    for expected_attempts in range(1, 6):
        response = _verify_login_code(
            client, email, dispatch["challenge_id"], wrong_code
        )
        assert response.status_code == 400
        expected_detail = "验证码错误次数过多，请重新获取" if expected_attempts == 5 else "验证码错误"
        assert response.json()["detail"] == expected_detail
        db_session.expire_all()
        challenge = db_session.get(AuthChallenge, dispatch["challenge_id"])
        assert challenge.attempts == expected_attempts

    assert challenge.consumed_at is not None
    correct_after_lock = _verify_login_code(
        client, email, dispatch["challenge_id"], code
    )
    assert correct_after_lock.status_code == 400
    assert "无效或已过期" in correct_after_lock.json()["detail"]
    assert db_session.execute(select(User).where(User.email == email)).scalar_one_or_none() is None


def test_banned_user_cannot_log_in_with_email_code(
    client, db_session, auth_mailbox
):
    email = "banned@example.com"
    registered = _register(client, email=email)
    user = db_session.get(User, registered["user"]["id"])
    user.status = "banned"
    db_session.commit()
    dispatch, code = _request_code(client, auth_mailbox, email)

    response = _verify_login_code(client, email, dispatch["challenge_id"], code)

    assert response.status_code == 403
    assert response.json()["detail"] == "账号已被封禁"
    db_session.expire_all()
    user = db_session.get(User, registered["user"]["id"])
    assert user.last_login_at is None
    assert db_session.get(AuthChallenge, dispatch["challenge_id"]).consumed_at is not None


def test_passwordless_user_can_set_password_and_receives_replacement_token(
    client, auth_mailbox
):
    email = "passwordless@example.com"
    dispatch, code = _request_code(client, auth_mailbox, email)
    otp_auth = _verify_login_code(client, email, dispatch["challenge_id"], code).json()
    old_token = otp_auth["access_token"]

    changed = client.post(
        "/api/users/me/password",
        json={"new_password": "newsecret456"},
        headers=_authorization(old_token),
    )
    assert changed.status_code == 200, changed.text
    replacement = changed.json()
    assert replacement["access_token"] != old_token
    assert replacement["user"]["password_set"] is True
    assert client.get(
        "/api/users/me", headers=_authorization(old_token)
    ).status_code == 401
    assert client.get(
        "/api/users/me", headers=_authorization(replacement["access_token"])
    ).status_code == 200
    assert client.post(
        "/api/users/login",
        json={"email": email, "password": "newsecret456"},
    ).status_code == 200


def test_password_reset_revokes_old_token_and_returns_valid_new_session(
    client, auth_mailbox
):
    registered = _register(client, email="reset@example.com")
    old_token = registered["access_token"]
    dispatch, code = _request_code(
        client, auth_mailbox, "reset@example.com", PASSWORD_RESET_PURPOSE
    )

    reset = client.post(
        "/api/users/password-reset/confirm",
        json={
            "email": "reset@example.com",
            "challenge_id": dispatch["challenge_id"],
            "code": code,
            "new_password": "resetsecret456",
        },
    )
    assert reset.status_code == 200, reset.text
    new_token = reset.json()["access_token"]
    assert new_token != old_token
    assert client.get(
        "/api/users/me", headers=_authorization(old_token)
    ).status_code == 401
    assert client.get(
        "/api/users/me", headers=_authorization(new_token)
    ).status_code == 200
    assert client.post(
        "/api/users/login",
        json={"email": "reset@example.com", "password": "secret123"},
    ).status_code == 401
    assert client.post(
        "/api/users/login",
        json={"email": "reset@example.com", "password": "resetsecret456"},
    ).status_code == 200


def test_password_reset_request_does_not_reveal_whether_email_exists(
    client, db_session, auth_mailbox
):
    known_email = "known-reset@example.com"
    unknown_email = "unknown-reset@example.com"
    _register(client, email=known_email)

    known = client.post(
        "/api/users/password-reset/request", json={"email": known_email}
    )
    unknown = client.post(
        "/api/users/password-reset/request", json={"email": unknown_email}
    )

    assert known.status_code == unknown.status_code == 200
    known_body = known.json()
    unknown_body = unknown.json()
    assert set(known_body) == set(unknown_body)
    assert {
        key: value for key, value in known_body.items() if key != "challenge_id"
    } == {
        key: value for key, value in unknown_body.items() if key != "challenge_id"
    }
    assert "如果该邮箱已注册" in known_body["message"]
    reset_deliveries = [
        item for item in auth_mailbox if item["purpose"] == PASSWORD_RESET_PURPOSE
    ]
    assert {item["email"] for item in reset_deliveries} == {
        known_email,
        unknown_email,
    }
    assert db_session.get(AuthChallenge, known_body["challenge_id"]) is not None
    assert db_session.get(AuthChallenge, unknown_body["challenge_id"]) is not None


def test_password_reset_code_is_single_use(client, auth_mailbox):
    email = "single-reset@example.com"
    _register(client, email=email)
    dispatch, code = _request_code(
        client, auth_mailbox, email, PASSWORD_RESET_PURPOSE
    )
    payload = {
        "email": email,
        "challenge_id": dispatch["challenge_id"],
        "code": code,
        "new_password": "first-reset456",
    }

    first = client.post("/api/users/password-reset/confirm", json=payload)
    replay = client.post(
        "/api/users/password-reset/confirm",
        json={**payload, "new_password": "replayed-reset456"},
    )

    assert first.status_code == 200, first.text
    assert replay.status_code == 400
    assert "无效或已过期" in replay.json()["detail"]
    assert client.post(
        "/api/users/login",
        json={"email": email, "password": "first-reset456"},
    ).status_code == 200
    assert client.post(
        "/api/users/login",
        json={"email": email, "password": "replayed-reset456"},
    ).status_code == 401


def test_revoke_sessions_invalidates_calling_token(client):
    token = _register(client, email="revoke@example.com")["access_token"]

    response = client.post(
        "/api/users/me/revoke-sessions", headers=_authorization(token)
    )
    assert response.status_code == 200, response.text
    assert response.json()["message"] == "已退出所有设备"
    assert client.get(
        "/api/users/me", headers=_authorization(token)
    ).status_code == 401
