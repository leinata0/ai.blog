from datetime import datetime, timezone

from sqlalchemy import select

from app.models import Post, PostQualityReview, PostQualitySnapshot


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
