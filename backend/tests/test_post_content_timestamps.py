"""Engagement counters must not masquerade as editorial content updates."""
from datetime import datetime
from xml.etree import ElementTree

import pytest
from sqlalchemy import select

from app.models import Post, User


EDITED_AT = datetime(2026, 1, 10, 8, 0)


@pytest.fixture
def article(client, db_session):
    post = Post(
        title="Timestamp regression",
        slug="timestamp-regression",
        summary="Editorial dates stay separate from reader activity.",
        content_md="Original article body",
        created_at=EDITED_AT,
        updated_at=EDITED_AT,
    )
    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)
    return post


def _admin_headers(client):
    response = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _member(client, db_session):
    response = client.post("/api/users/register", json={"email": "timestamp@example.com", "password": "secret123"})
    assert response.status_code == 200, response.text
    payload = response.json()
    user = db_session.get(User, payload["user"]["id"])
    user.email_verified = True
    db_session.commit()
    return user.id, {"Authorization": f"Bearer {payload['access_token']}"}


def _sitemap_lastmod(client, slug):
    response = client.get("/sitemap.xml")
    assert response.status_code == 200, response.text
    root = ElementTree.fromstring(response.content)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    for entry in root.findall("s:url", ns):
        if entry.findtext("s:loc", namespaces=ns).endswith(f"/posts/{slug}"):
            return entry.findtext("s:lastmod", namespaces=ns)
    raise AssertionError(f"Missing sitemap entry for {slug}")


def _assert_editorial_date_unchanged(client, db_session, post):
    db_session.refresh(post)
    assert post.updated_at == EDITED_AT
    assert _sitemap_lastmod(client, post.slug) == "2026-01-10"


def test_human_view_increments_counter_without_changing_content_date(client, db_session, article):
    response = client.get(f"/api/posts/{article.slug}", headers={"User-Agent": "Mozilla/5.0"})
    assert response.status_code == 200
    assert response.json()["view_count"] == 1
    assert response.json()["updated_at"] == "2026-01-10T08:00:00+00:00"
    _assert_editorial_date_unchanged(client, db_session, article)


def test_anonymous_like_preserves_content_date(client, db_session, article):
    response = client.post(f"/api/posts/{article.slug}/like")
    assert response.status_code == 200
    assert response.json()["like_count"] == 1
    _assert_editorial_date_unchanged(client, db_session, article)


def test_member_like_and_toggle_unlike_preserve_content_date(client, db_session, article):
    _, headers = _member(client, db_session)
    liked = client.post(f"/api/posts/{article.slug}/like", headers=headers)
    assert liked.status_code == 200
    assert liked.json() == {"like_count": 1, "liked": True}
    _assert_editorial_date_unchanged(client, db_session, article)

    unliked = client.post(f"/api/posts/{article.slug}/like", headers=headers)
    assert unliked.status_code == 200
    assert unliked.json() == {"like_count": 0, "liked": False}
    _assert_editorial_date_unchanged(client, db_session, article)


def test_account_library_unlike_preserves_content_date(client, db_session, article):
    _, headers = _member(client, db_session)
    assert client.post(f"/api/posts/{article.slug}/like", headers=headers).status_code == 200
    response = client.delete(f"/api/users/me/likes/{article.slug}", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"removed": True, "like_count": 0}
    _assert_editorial_date_unchanged(client, db_session, article)


@pytest.mark.parametrize("delete_as_admin", [False, True])
def test_account_deletion_decrements_likes_without_changing_content_date(
    client, db_session, article, delete_as_admin,
):
    user_id, headers = _member(client, db_session)
    assert client.post(f"/api/posts/{article.slug}/like", headers=headers).status_code == 200
    if delete_as_admin:
        response = client.delete(f"/api/admin/users/{user_id}", headers=_admin_headers(client))
    else:
        response = client.delete("/api/users/me", headers=headers)
    assert response.status_code == 200
    assert db_session.execute(select(Post.like_count).where(Post.id == article.id)).scalar_one() == 0
    _assert_editorial_date_unchanged(client, db_session, article)


def test_editorial_update_still_changes_content_date(client, db_session, article):
    response = client.put(
        f"/api/admin/posts/{article.id}",
        json={"content_md": "Revised article body", "suppress_notifications": True},
        headers=_admin_headers(client),
    )
    assert response.status_code == 200, response.text
    db_session.refresh(article)
    assert article.content_md == "Revised article body"
    assert article.updated_at > EDITED_AT
    assert _sitemap_lastmod(client, article.slug) == article.updated_at.strftime("%Y-%m-%d")
