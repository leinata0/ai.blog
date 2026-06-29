"""Tests for account-center features: bio, avatar, my comments/likes, delete account."""
import io

from sqlalchemy import select

from app.models import User


def _register(client, db_session, email="acct@example.com", verified=True):
    resp = client.post("/api/users/register", json={"email": email, "password": "secret123"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    if verified:
        user = db_session.execute(select(User).where(User.email == email)).scalar_one()
        user.email_verified = True
        db_session.commit()
    return data


def _ah(token):
    return {"Authorization": f"Bearer {token}"}


def _png_bytes():
    # Minimal valid PNG magic header + filler (enough for magic-byte detection).
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_update_bio(client, db_session):
    token = _register(client, db_session)["access_token"]
    resp = client.put("/api/users/me", json={"bio": "你好，我是访客"}, headers=_ah(token))
    assert resp.status_code == 200
    assert resp.json()["bio"] == "你好，我是访客"


def test_upload_avatar(client, db_session):
    token = _register(client, db_session)["access_token"]
    files = {"file": ("avatar.png", io.BytesIO(_png_bytes()), "image/png")}
    resp = client.post("/api/users/me/avatar", files=files, headers=_ah(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar_url"]


def test_upload_avatar_rejects_non_image(client, db_session):
    token = _register(client, db_session)["access_token"]
    files = {"file": ("note.txt", io.BytesIO(b"not an image"), "text/plain")}
    resp = client.post("/api/users/me/avatar", files=files, headers=_ah(token))
    assert resp.status_code == 400


def test_my_comments_lists_account_comments(client, db_session):
    token = _register(client, db_session)["access_token"]
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(f"/api/posts/{slug}/comments", json={"content": "my comment"}, headers=_ah(token))

    resp = client.get("/api/users/me/comments", headers=_ah(token))
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["post_slug"] == slug
    assert items[0]["content"] == "my comment"
    assert items[0]["post_title"]


def test_my_likes_lists_account_likes(client, db_session):
    token = _register(client, db_session)["access_token"]
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(f"/api/posts/{slug}/like", headers=_ah(token))

    resp = client.get("/api/users/me/likes", headers=_ah(token))
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["post_slug"] == slug


def test_comment_list_includes_avatar(client, db_session):
    token = _register(client, db_session)["access_token"]
    # set avatar
    files = {"file": ("avatar.png", io.BytesIO(_png_bytes()), "image/png")}
    avatar_url = client.post("/api/users/me/avatar", files=files, headers=_ah(token)).json()["avatar_url"]
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(f"/api/posts/{slug}/comments", json={"content": "with avatar"}, headers=_ah(token))

    comments = client.get(f"/api/posts/{slug}/comments").json()
    assert comments[0]["avatar_url"] == avatar_url


def test_delete_account(client, db_session):
    reg = _register(client, db_session)
    token = reg["access_token"]
    user_id = reg["user"]["id"]
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(f"/api/posts/{slug}/comments", json={"content": "bye"}, headers=_ah(token))

    resp = client.delete("/api/users/me", headers=_ah(token))
    assert resp.status_code == 200
    # user gone → token no longer resolves
    assert client.get("/api/users/me", headers=_ah(token)).status_code == 401
    assert db_session.get(User, user_id) is None
    # comment anonymized but kept
    comments = client.get(f"/api/posts/{slug}/comments").json()
    assert len(comments) == 1
    assert comments[0]["user_id"] is None


def test_anonymous_comment_has_empty_avatar(client):
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    client.post(f"/api/posts/{slug}/comments", json={"nickname": "Guest", "content": "hi"})
    comments = client.get(f"/api/posts/{slug}/comments").json()
    assert comments[0]["avatar_url"] == ""
