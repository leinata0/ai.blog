"""Tests for account-bound likes and comments on posts."""
import pytest
from sqlalchemy import delete, select, update

from app.models import Post, PostLike, User


def _register(client, db_session, email="liker@example.com", password="secret123", nickname="Liker"):
    resp = client.post(
        "/api/users/register",
        json={"email": email, "password": password, "nickname": nickname},
    )
    assert resp.status_code == 200, resp.text
    # Verify the email so account-bound writes (comment/like) aren't soft-blocked.
    user = db_session.execute(select(User).where(User.email == email)).scalar_one()
    user.email_verified = True
    db_session.commit()
    return resp.json()["access_token"]


@pytest.fixture
def published_slug(client, db_session):
    """The lifespan seeds posts; grab a published slug to act on."""
    resp = client.get("/api/posts")
    items = resp.json()["items"]
    assert items, "expected seeded posts"
    return items[0]["slug"]


def test_logged_in_like_toggles(client, db_session, published_slug):
    token = _register(client, db_session)
    headers = {"Authorization": f"Bearer {token}"}

    # initial state: not liked
    state = client.get(f"/api/posts/{published_slug}/like-state", headers=headers).json()
    assert state["liked"] is False
    base = state["like_count"]

    # like
    r1 = client.post(f"/api/posts/{published_slug}/like", headers=headers).json()
    assert r1["liked"] is True
    assert r1["like_count"] == base + 1

    # unlike (toggle off) — count returns to base
    r2 = client.post(f"/api/posts/{published_slug}/like", headers=headers).json()
    assert r2["liked"] is False
    assert r2["like_count"] == base

    # state reflects unliked
    state2 = client.get(f"/api/posts/{published_slug}/like-state", headers=headers).json()
    assert state2["liked"] is False


def test_concurrent_unlike_does_not_decrement_twice(
    client, db_session, published_slug, monkeypatch
):
    token = _register(client, db_session)
    headers = {"Authorization": f"Bearer {token}"}
    initial = client.get(f"/api/posts/{published_slug}/like-state", headers=headers).json()
    client.post(f"/api/posts/{published_slug}/like", headers=headers)

    from app.routers import posts as posts_router

    def concurrent_winner(db, like_id):
        result = db.execute(delete(PostLike).where(PostLike.id == like_id))
        assert result.rowcount == 1
        db.execute(
            update(Post)
            .where(Post.slug == published_slug)
            .values(like_count=Post.like_count - 1)
        )
        return False

    monkeypatch.setattr(posts_router, "_delete_registered_like", concurrent_winner)
    response = client.post(f"/api/posts/{published_slug}/like", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"like_count": initial["like_count"], "liked": False}
    assert db_session.execute(
        select(PostLike).join(Post).where(Post.slug == published_slug)
    ).scalar_one_or_none() is None


def test_anonymous_like_not_cancellable(client, published_slug):
    r1 = client.post(f"/api/posts/{published_slug}/like")
    assert r1.status_code == 200
    assert r1.json()["liked"] is True
    # second anonymous like from same IP rejected
    r2 = client.post(f"/api/posts/{published_slug}/like")
    assert r2.status_code == 400


def test_logged_in_comment_uses_account_nickname(client, db_session, published_slug):
    token = _register(client, db_session, nickname="RealName")
    headers = {"Authorization": f"Bearer {token}"}
    # body nickname is ignored for logged-in users
    resp = client.post(
        f"/api/posts/{published_slug}/comments",
        json={"nickname": "FakeName", "content": "hello from account"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["nickname"] == "RealName"
    assert data["is_registered"] is True
    assert data["user_id"] is not None


def test_anonymous_comment_requires_nickname(client, published_slug):
    resp = client.post(
        f"/api/posts/{published_slug}/comments",
        json={"content": "no nickname"},
    )
    assert resp.status_code == 400


def test_anonymous_comment_with_nickname_ok(client, published_slug):
    resp = client.post(
        f"/api/posts/{published_slug}/comments",
        json={"nickname": "Guest", "content": "anon comment"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["nickname"] == "Guest"
    assert data["is_registered"] is False
    assert data["user_id"] is None
