from datetime import datetime, timezone

from sqlalchemy import select

from app.models import Post, PostQualityReview, PostQualitySnapshot, ViewLog


def test_get_post_detail_by_slug(client, seeded_db):
    resp = client.get("/api/posts/python-automation-selenium-pandas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "python-automation-selenium-pandas"
    assert "content_md" in body
    assert "series_slug" in body
    assert "source_count" in body
    assert "series" in body
    assert "sources" in body
    assert "source_summary" in body
    assert "same_series_posts" in body
    assert "same_topic_posts" in body
    assert "same_week_posts" in body
    assert isinstance(body["sources"], list)
    assert isinstance(body["same_series_posts"], list)
    assert isinstance(body["same_topic_posts"], list)
    assert isinstance(body["same_week_posts"], list)


def test_get_post_detail_returns_incremented_view_count(client, seeded_db):
    post = seeded_db.execute(
        select(Post).where(Post.slug == "python-automation-selenium-pandas")
    ).scalar_one()
    post.view_count = 41
    seeded_db.query(ViewLog).filter(ViewLog.post_id == post.id).delete()
    seeded_db.commit()

    response = client.get(f"/api/posts/{post.slug}")

    assert response.status_code == 200
    assert response.json()["view_count"] == 42


def test_crawler_user_agent_does_not_inflate_view_count(client, seeded_db):
    post = seeded_db.execute(
        select(Post).where(Post.slug == "python-automation-selenium-pandas")
    ).scalar_one()
    post.view_count = 7
    seeded_db.query(ViewLog).filter(ViewLog.post_id == post.id).delete()
    seeded_db.commit()

    for user_agent in ("Googlebot/2.1 (+http://www.google.com/bot.html)", "node-fetch/1.0"):
        response = client.get(f"/api/posts/{post.slug}", headers={"User-Agent": user_agent})
        assert response.status_code == 200
        assert response.json()["view_count"] == 7

    assert seeded_db.query(ViewLog).filter(ViewLog.post_id == post.id).count() == 0


def test_post_detail_timestamps_carry_utc_offset(client, seeded_db):
    """Naive UTC columns must be serialized with an explicit offset.

    Without it `new Date(value)` parses the string as local time, so a UTC+8 reader sees
    a just-published post as 8 hours old and day-grouped views land on the wrong date.
    """
    body = client.get("/api/posts/python-automation-selenium-pandas").json()
    assert body["created_at"].endswith("+00:00")
    assert body["updated_at"].endswith("+00:00")

    listed = client.get("/api/posts").json()["items"][0]
    assert listed["created_at"].endswith("+00:00")

    archive = client.get("/api/archive").json()
    assert archive[0]["posts"][0]["created_at"].endswith("+00:00")


def test_get_post_detail_includes_quality_payload(client, seeded_db):
    post = seeded_db.execute(
        select(Post).where(Post.slug == "python-automation-selenium-pandas")
    ).scalar_one()
    seeded_db.add(
        PostQualitySnapshot(
            post_id=post.id,
            overall_score=86,
            structure_score=88,
            source_score=82,
            analysis_score=84,
            packaging_score=76,
            resonance_score=40,
            issues_json='["missing_official_source"]',
            strengths_json='["clear_structure"]',
            notes="Snapshot ready",
            generated_at=datetime.now(timezone.utc),
        )
    )
    seeded_db.add(
        PostQualityReview(
            post_id=post.id,
            editor_verdict="solid",
            editor_labels_json='["needs_followup"]',
            editor_note="Worth tracking",
            followup_recommended=True,
            reviewed_by="editor",
            reviewed_at=datetime.now(timezone.utc),
        )
    )
    seeded_db.commit()

    resp = client.get("/api/posts/python-automation-selenium-pandas")
    assert resp.status_code == 200
    body = resp.json()

    assert body["quality_snapshot"]["overall_score"] == 86
    assert body["quality_snapshot"]["issues"] == ["missing_official_source"]
    assert body["quality_review"]["editor_verdict"] == "solid"
    assert body["quality_review"]["followup_recommended"] is True


def test_get_post_detail_not_found(client, seeded_db):
    resp = client.get("/api/posts/not-exist")
    assert resp.status_code == 404


def test_unpublished_draft_is_hidden_from_public_slug_endpoints(client, db_session):
    """Drafts must not be readable via public slug routes (detail/like/related/comments)."""
    draft = Post(
        title="Secret draft",
        slug="secret-draft-p0",
        summary="should not leak",
        content_md="# Draft body that must stay private",
        cover_image="",
        content_type="post",
        topic_key="draft-topic",
        is_published=False,
        is_pinned=False,
    )
    db_session.add(draft)
    db_session.commit()

    slug = "secret-draft-p0"
    assert client.get(f"/api/posts/{slug}").status_code == 404
    assert client.get(f"/api/posts/{slug}/like-state").status_code == 404
    assert client.post(f"/api/posts/{slug}/like").status_code == 404
    assert client.get(f"/api/posts/{slug}/related").status_code == 404
    assert client.get(f"/api/posts/{slug}/comments").status_code == 404
    assert client.post(
        f"/api/posts/{slug}/comments",
        json={"nickname": "guest", "content": "should fail"},
    ).status_code == 404

    # Confirm the draft still exists in the DB (404 is intentional, not missing row).
    assert db_session.execute(select(Post).where(Post.slug == slug)).scalar_one_or_none() is not None
