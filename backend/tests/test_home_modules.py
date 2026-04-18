from datetime import datetime, timezone

from app.models import Post


def test_home_modules_returns_renderable_sections(client, seeded_db):
    response = client.get("/api/home/modules")
    assert response.status_code == 200

    payload = response.json()
    assert {"hero", "latest_weekly", "latest_daily", "featured_series", "topic_pulse", "continue_reading", "subscription_cta"} <= payload.keys()
    assert payload["hero"]["preset"] == "site_hero"
    assert "art_direction_version" in payload["hero"]
    assert isinstance(payload["latest_weekly"], list)
    assert isinstance(payload["latest_daily"], list)
    assert isinstance(payload["featured_series"], list)
    assert isinstance(payload["topic_pulse"]["items"], list)
    assert payload["continue_reading"]["local_only"] is True
    assert payload["subscription_cta"]["primary_to"] == "/feeds"


def test_home_modules_handles_topic_posts_without_profile(client, db_session):
    db_session.add(
        Post(
            title="Unprofiled topic pulse",
            slug="unprofiled-topic-pulse",
            summary="Summary for a topic without a topic profile.",
            content_md="content",
            topic_key="unprofiled-topic",
            content_type="daily_brief",
            cover_image="https://img.example.com/unprofiled-topic.jpg",
            is_published=True,
            created_at=datetime.now(timezone.utc),
        )
    )
    db_session.commit()

    response = client.get("/api/home/modules")
    assert response.status_code == 200

    payload = response.json()
    matching = next(item for item in payload["topic_pulse"]["items"] if item["topic_key"] == "unprofiled-topic")
    assert matching["title"] == "Unprofiled topic pulse"
    assert matching["description"] == "Summary for a topic without a topic profile."
    assert matching["cover_image"] == "https://img.example.com/unprofiled-topic.jpg"
