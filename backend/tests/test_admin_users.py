"""Tests for admin user management + cross-token isolation."""

from sqlalchemy import select

from app.models import Post, User


def _admin_token(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _register_user(client, email="member@example.com", password="secret123"):
    resp = client.post("/api/users/register", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ah(token):
    return {"Authorization": f"Bearer {token}"}


def test_admin_list_users(client):
    _register_user(client, email="a@example.com")
    _register_user(client, email="b@example.com")
    resp = client.get("/api/admin/users", headers=_ah(_admin_token(client)))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    emails = {u["email"] for u in data["items"]}
    assert {"a@example.com", "b@example.com"} <= emails


def test_admin_list_users_search(client):
    _register_user(client, email="alice@example.com")
    _register_user(client, email="bob@example.com")
    resp = client.get("/api/admin/users?q=alice", headers=_ah(_admin_token(client)))
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1 and items[0]["email"] == "alice@example.com"


def test_ban_invalidates_existing_token_immediately(client):
    reg = _register_user(client)
    user_token = reg["access_token"]
    user_id = reg["user"]["id"]
    # token works before ban
    assert client.get("/api/users/me", headers=_ah(user_token)).status_code == 200

    ban = client.post(f"/api/admin/users/{user_id}/ban", headers=_ah(_admin_token(client)))
    assert ban.status_code == 200

    # the same token is now rejected (status checked per-request)
    assert client.get("/api/users/me", headers=_ah(user_token)).status_code == 401
    # and banned user cannot log in
    assert client.post(
        "/api/users/login", json={"email": "member@example.com", "password": "secret123"}
    ).status_code == 403


def test_unban_restores_login(client):
    reg = _register_user(client)
    user_id = reg["user"]["id"]
    admin = _admin_token(client)
    client.post(f"/api/admin/users/{user_id}/ban", headers=_ah(admin))
    client.post(f"/api/admin/users/{user_id}/unban", headers=_ah(admin))
    assert client.post(
        "/api/users/login", json={"email": "member@example.com", "password": "secret123"}
    ).status_code == 200


def test_delete_user_anonymizes_comments(client, db_session):
    reg = _register_user(client)
    user_token = reg["access_token"]
    user_id = reg["user"]["id"]
    # verify email so the account-bound comment isn't soft-blocked
    user = db_session.get(User, user_id)
    user.email_verified = True
    db_session.commit()
    # comment on a seeded post
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(
        f"/api/posts/{slug}/comments",
        json={"content": "by registered user"},
        headers=_ah(user_token),
    )
    like_response = client.post(f"/api/posts/{slug}/like", headers=_ah(user_token))
    assert like_response.status_code == 200
    post = db_session.execute(select(Post).where(Post.slug == slug)).scalar_one()
    # Exercise the lower bound too: legacy counters may already be inconsistent.
    post.like_count = 0
    db_session.commit()

    resp = client.delete(f"/api/admin/users/{user_id}", headers=_ah(_admin_token(client)))
    assert resp.status_code == 200

    # comment survives but is now anonymized (user_id NULL)
    comments = client.get(f"/api/posts/{slug}/comments").json()
    assert len(comments) == 1
    assert comments[0]["user_id"] is None
    assert comments[0]["is_registered"] is False
    db_session.expire_all()
    assert db_session.execute(select(Post.like_count).where(Post.slug == slug)).scalar_one() == 0


# ── cross-token isolation ──

def test_user_token_rejected_on_admin_endpoint(client):
    user_token = _register_user(client)["access_token"]
    resp = client.get("/api/admin/users", headers=_ah(user_token))
    assert resp.status_code == 401


def test_admin_token_rejected_on_user_endpoint(client):
    admin_token = _admin_token(client)
    resp = client.get("/api/users/me", headers=_ah(admin_token))
    assert resp.status_code == 401
