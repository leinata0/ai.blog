"""Account signal-hub dashboard, library, and self-service action contracts."""
import io

from sqlalchemy import select

from app.models import Post, User


def _register(client, db_session, email: str):
    response = client.post(
        "/api/users/register",
        json={"email": email, "password": "secret123", "nickname": "Signal Reader"},
    )
    assert response.status_code == 200, response.text
    user = db_session.execute(select(User).where(User.email == email)).scalar_one()
    user.email_verified = True
    db_session.commit()
    return response.json()["access_token"]


def _headers(token: str):
    return {"Authorization": f"Bearer {token}"}


def _png_bytes():
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def test_dashboard_returns_real_counts_recent_history_and_followed_update(client, db_session):
    token = _register(client, db_session, "dashboard@example.com")
    headers = _headers(token)
    post_payload = client.get("/api/posts").json()["items"][0]
    post = db_session.execute(select(Post).where(Post.slug == post_payload["slug"])).scalar_one()
    post.topic_key = "agents"
    db_session.commit()

    client.post(
        "/api/users/me/topics",
        json={"topic_key": "agents", "display_title": "智能体"},
        headers=headers,
    )
    client.post(
        "/api/users/me/history",
        json={"slug": post.slug, "title": post.title, "topic_key": "agents"},
        headers=headers,
    )
    client.post(f"/api/posts/{post.slug}/like", headers=headers)
    client.post(f"/api/posts/{post.slug}/comments", json={"content": "值得继续关注"}, headers=headers)

    response = client.get("/api/users/me/dashboard", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["counts"] == {"following": 1, "history": 1, "comments": 1, "likes": 1}
    assert payload["recent_history"][0]["slug"] == post.slug
    assert payload["recent_history"][0]["available"] is True
    assert payload["followed_updates"][0]["topic_key"] == "agents"
    assert payload["followed_updates"][0]["latest_post"]["slug"] == post.slug
    assert payload["security"]["email_verified"] is True


def test_library_supports_kind_search_pagination_and_unavailable_history(client, db_session):
    token = _register(client, db_session, "library@example.com")
    headers = _headers(token)
    for index in range(3):
        client.post(
            "/api/users/me/history",
            json={"slug": f"missing-{index}", "title": f"离线资料 {index}"},
            headers=headers,
        )

    first = client.get(
        "/api/users/me/library?kind=history&q=离线资料&page=1&page_size=2",
        headers=headers,
    )
    assert first.status_code == 200, first.text
    payload = first.json()
    assert payload["total"] == 3
    assert len(payload["items"]) == 2
    assert all(item["kind"] == "history" for item in payload["items"])
    assert all(item["available"] is False for item in payload["items"])

    second = client.get(
        "/api/users/me/library?kind=history&q=离线资料&page=2&page_size=2",
        headers=headers,
    ).json()
    assert len(second["items"]) == 1
    assert client.get("/api/users/me/library?kind=invalid", headers=headers).status_code == 422


def test_library_actions_are_owned_and_like_removal_is_idempotent(client, db_session):
    owner_token = _register(client, db_session, "owner@example.com")
    other_token = _register(client, db_session, "other@example.com")
    owner_headers = _headers(owner_token)
    other_headers = _headers(other_token)
    slug = client.get("/api/posts").json()["items"][0]["slug"]
    post = db_session.execute(select(Post).where(Post.slug == slug)).scalar_one()
    initial_count = post.like_count

    client.post(f"/api/posts/{slug}/like", headers=owner_headers)
    comment_response = client.post(
        f"/api/posts/{slug}/comments",
        json={"content": "只能由本人删除"},
        headers=owner_headers,
    )
    assert comment_response.status_code == 200
    comment_id = client.get("/api/users/me/comments", headers=owner_headers).json()[0]["id"]

    assert client.delete(f"/api/users/me/comments/{comment_id}", headers=other_headers).status_code == 404
    assert client.delete(f"/api/users/me/comments/{comment_id}", headers=owner_headers).status_code == 200

    removed = client.delete(f"/api/users/me/likes/{slug}", headers=owner_headers)
    assert removed.status_code == 200
    assert removed.json()["removed"] is True
    repeated = client.delete(f"/api/users/me/likes/{slug}", headers=owner_headers)
    assert repeated.json()["removed"] is False
    db_session.expire_all()
    assert db_session.execute(select(Post.like_count).where(Post.slug == slug)).scalar_one() == initial_count


def test_history_clear_avatar_remove_and_export(client, db_session):
    token = _register(client, db_session, "export@example.com")
    headers = _headers(token)
    client.post(
        "/api/users/me/history",
        json={"slug": "exported", "title": "被导出的阅读记录"},
        headers=headers,
    )
    avatar = client.post(
        "/api/users/me/avatar",
        files={"file": ("avatar.png", io.BytesIO(_png_bytes()), "image/png")},
        headers=headers,
    )
    assert avatar.json()["avatar_url"]
    assert client.delete("/api/users/me/avatar", headers=headers).json()["avatar_url"] == ""

    export = client.get("/api/users/me/export", headers=headers)
    assert export.status_code == 200, export.text
    assert export.headers["cache-control"] == "no-store"
    assert "attachment" in export.headers["content-disposition"]
    assert export.json()["profile"]["email"] == "export@example.com"
    assert export.json()["reading_history"][0]["slug"] == "exported"
    assert export.json()["likes"] == []
    assert export.json()["comments"] == []

    cleared = client.delete("/api/users/me/history", headers=headers)
    assert cleared.json()["removed_count"] == 1
    assert client.get("/api/users/me/library?kind=history", headers=headers).json()["total"] == 0


def test_account_hub_endpoints_require_auth(client):
    for path in ("/api/users/me/dashboard", "/api/users/me/library", "/api/users/me/export"):
        assert client.get(path).status_code in (401, 403)
