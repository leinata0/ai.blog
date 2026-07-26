"""Tests for the visitor user auth API (register / login / profile)."""

from jose import jwt

from app import auth as auth_mod


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
    assert jwt.get_unverified_claims(data["access_token"])["ver"] == 0
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


def test_register_reports_409_when_the_unique_index_wins_the_race(client, monkeypatch):
    """Two simultaneous submits both pass the existence check; the loser must get 409, not 500."""
    from app.routers import users as users_mod

    original = users_mod._find_user_by_email
    calls = {"n": 0}

    def _blind_first_lookup(db, email):
        calls["n"] += 1
        if calls["n"] == 1:
            # Simulate the competing transaction committing after our SELECT.
            original_user = original(db, email)
            if original_user is not None:
                return None
        return original(db, email)

    assert _register(client).status_code == 200

    monkeypatch.setattr(users_mod, "_find_user_by_email", _blind_first_lookup)
    resp = _register(client)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "该邮箱已注册"


def test_followed_topics_and_history_sync_are_idempotent(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    topic = {"topic_key": "agent-runtime", "display_title": "Agent 运行时"}

    for _ in range(2):
        resp = client.post("/api/users/me/topics", json=topic, headers=headers)
        assert resp.status_code == 200, resp.text
    assert [item["topic_key"] for item in resp.json()] == ["agent-runtime"]

    merge = client.post(
        "/api/users/me/topics/merge",
        json={"topics": [topic, topic]},
        headers=headers,
    )
    assert merge.status_code == 200
    assert len(merge.json()) == 1

    entry = {
        "slug": "agent-runtime-weekly",
        "title": "Agent 运行时周报",
        "topic_key": "agent-runtime",
        "topic_display_title": "Agent 运行时",
        "content_type": "weekly_review",
        "coverage_date": "2026-07-20",
    }
    for _ in range(2):
        resp = client.post("/api/users/me/history", json=entry, headers=headers)
        assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1


def test_topic_sync_recovers_from_unique_constraint_race(client, monkeypatch):
    """uq_user_topic violations must resolve into the idempotent result, not a 500."""
    from app.models import FollowedTopic
    from app.routers import users as users_mod

    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    topic = {"topic_key": "agent-runtime", "display_title": "Agent 运行时"}
    assert client.post("/api/users/me/topics", json=topic, headers=headers).status_code == 200

    original = users_mod._upsert_followed_topic
    calls = {"n": 0}

    def _racing_upsert(db, user_id, item):
        calls["n"] += 1
        if calls["n"] == 1:
            # Stand in for a concurrent request that inserted the row after our SELECT.
            row = FollowedTopic(
                user_id=user_id,
                topic_key=item.topic_key.strip(),
                display_title=item.display_title.strip(),
            )
            db.add(row)
            return row
        return original(db, user_id, item)

    monkeypatch.setattr(users_mod, "_upsert_followed_topic", _racing_upsert)
    resp = client.post("/api/users/me/topics", json=topic, headers=headers)
    assert resp.status_code == 200, resp.text
    assert calls["n"] == 2, "the commit must be retried after the unique-constraint failure"
    assert [item["topic_key"] for item in resp.json()] == ["agent-runtime"]


def test_register_invalid_email(client):
    resp = _register(client, email="not-an-email")
    assert resp.status_code == 400


def test_register_weak_password_rejected(client):
    resp = _register(client, password="short")
    assert resp.status_code == 422


def test_register_rejects_password_over_72_utf8_bytes(client):
    resp = _register(client, password="密" * 25)
    assert resp.status_code == 400
    assert "UTF-8" in resp.json()["detail"]
    assert "72" in resp.json()["detail"]


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
    # the token used to change the password is revoked immediately
    assert client.get("/api/users/me", headers=headers).status_code == 401
    # old password no longer works
    assert client.post("/api/users/login", json={"email": "visitor@example.com", "password": "secret123"}).status_code == 401
    # new password works
    assert client.post("/api/users/login", json={"email": "visitor@example.com", "password": "newsecret456"}).status_code == 200


def test_legacy_token_without_version_expires_on_password_change(client):
    registration = _register(client).json()
    user_id = registration["user"]["id"]
    current_token = registration["access_token"]
    legacy_token = auth_mod.create_access_token(
        data={"sub": str(user_id)},
        audience=auth_mod.USER_TOKEN_AUDIENCE,
    )
    legacy_headers = {"Authorization": f"Bearer {legacy_token}"}
    assert client.get("/api/users/me", headers=legacy_headers).status_code == 200

    response = client.post(
        "/api/users/me/password",
        json={"old_password": "secret123", "new_password": "newsecret456"},
        headers={"Authorization": f"Bearer {current_token}"},
    )
    assert response.status_code == 200
    assert client.get("/api/users/me", headers=legacy_headers).status_code == 401
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    assert client.get(
        f"/api/posts/{slug}/like-state",
        headers=legacy_headers,
    ).status_code == 401

    login = client.post(
        "/api/users/login",
        json={"email": "visitor@example.com", "password": "newsecret456"},
    )
    assert login.status_code == 200
    replacement_token = login.json()["access_token"]
    assert jwt.get_unverified_claims(replacement_token)["ver"] == 1
    assert client.get(
        "/api/users/me",
        headers={"Authorization": f"Bearer {replacement_token}"},
    ).status_code == 200


def test_change_password_rejects_new_password_over_72_utf8_bytes(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post(
        "/api/users/me/password",
        json={"old_password": "secret123", "new_password": "密" * 25},
        headers=headers,
    )
    assert response.status_code == 400
    assert "UTF-8" in response.json()["detail"]
    assert client.get("/api/users/me", headers=headers).status_code == 200
    assert client.post(
        "/api/users/login",
        json={"email": "visitor@example.com", "password": "secret123"},
    ).status_code == 200


def test_change_password_wrong_old(client):
    token = _register(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post(
        "/api/users/me/password",
        json={"old_password": "wrongold", "new_password": "newsecret456"},
        headers=headers,
    )
    assert resp.status_code == 400
