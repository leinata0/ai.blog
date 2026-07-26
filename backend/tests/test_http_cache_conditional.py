"""Conditional-request (ETag / Last-Modified) semantics for public cached endpoints.

Regression cover for the 304 bug: `public_json_response` OR-ed the two validators, so a
browser or CDN replaying both got a 304 whenever If-Modified-Since matched — even after an
edit had changed the ETag. Most endpoints derive Last-Modified from post timestamps that a
content edit barely moves, so stale bodies stuck around indefinitely.
"""

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

from sqlalchemy import select

from app.models import Post


def _login(client):
    return client.post("/api/admin/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_if_none_match_wins_over_if_modified_since(client, seeded_db):
    """RFC 9110 §13.1.3: with If-None-Match present, If-Modified-Since must be ignored."""
    first = client.get("/api/archive")
    assert first.status_code == 200
    stale_etag = first.headers["ETag"]
    last_modified = first.headers["Last-Modified"]

    # Replaying both validators unchanged is still a legitimate 304.
    unchanged = client.get(
        "/api/archive",
        headers={"If-None-Match": stale_etag, "If-Modified-Since": last_modified},
    )
    assert unchanged.status_code == 304

    # Edit a title: the body (and therefore the ETag) changes.
    post = seeded_db.execute(select(Post).where(Post.is_published == True)).scalars().first()
    post.title = f"{post.title} 修订版"
    seeded_db.commit()

    revalidated = client.get(
        "/api/archive",
        headers={"If-None-Match": stale_etag, "If-Modified-Since": last_modified},
    )
    assert revalidated.status_code == 200, "stale ETag + matching If-Modified-Since must not win a 304"
    assert revalidated.headers["ETag"] != stale_etag
    assert "修订版" in revalidated.text


def test_if_modified_since_still_honored_without_if_none_match(client, seeded_db):
    first = client.get("/api/archive")
    assert first.status_code == 200

    future = format_datetime(datetime.now(timezone.utc) + timedelta(days=1), usegmt=True)
    assert client.get("/api/archive", headers={"If-Modified-Since": future}).status_code == 304

    past = format_datetime(datetime.now(timezone.utc) - timedelta(days=365), usegmt=True)
    assert client.get("/api/archive", headers={"If-Modified-Since": past}).status_code == 200


def test_unmatched_if_none_match_returns_fresh_body(client, seeded_db):
    response = client.get("/api/archive", headers={"If-None-Match": 'W/"not-the-current-digest"'})
    assert response.status_code == 200
    assert response.json()


def test_archive_last_modified_tracks_edits_not_only_creation(client, seeded_db):
    """last_modified must fold in updated_at — editing never moves created_at."""
    before = client.get("/api/archive")
    assert before.status_code == 200
    before_last_modified = before.headers["Last-Modified"]

    post = seeded_db.execute(select(Post).where(Post.is_published == True)).scalars().first()
    post.title = f"{post.title} 时间戳修订"
    post.updated_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=2)
    seeded_db.commit()

    after = client.get("/api/archive")
    assert after.status_code == 200
    assert after.headers["Last-Modified"] != before_last_modified

    # A client holding the pre-edit Last-Modified must be served the new body.
    assert client.get(
        "/api/archive", headers={"If-Modified-Since": before_last_modified}
    ).status_code == 200


def test_feed_conditional_request_follows_etag(client, seeded_db):
    first = client.get("/api/feeds/all.xml")
    assert first.status_code == 200
    etag = first.headers["ETag"]
    last_modified = first.headers["Last-Modified"]

    assert client.get(
        "/api/feeds/all.xml",
        headers={"If-None-Match": etag, "If-Modified-Since": last_modified},
    ).status_code == 304

    token = _login(client)
    created = client.post(
        "/api/admin/posts",
        json={
            "title": "Feed Cache Probe",
            "slug": "feed-cache-probe",
            "summary": "probe",
            "content_md": "probe body",
            "is_published": True,
        },
        headers=_auth(token),
    )
    assert created.status_code == 200, created.text

    refreshed = client.get(
        "/api/feeds/all.xml",
        headers={"If-None-Match": etag, "If-Modified-Since": last_modified},
    )
    assert refreshed.status_code == 200
    assert "feed-cache-probe" in refreshed.text
