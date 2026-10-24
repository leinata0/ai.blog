from datetime import datetime, timezone

import pytest

from app.models import Post, TopicProfile


def _post(slug, topic_key, cover, day, *, published=True):
    return Post(
        title=slug,
        slug=slug,
        summary="Topic cover regression",
        content_md="Source content",
        topic_key=topic_key,
        cover_image=cover,
        is_published=published,
        created_at=datetime(2026, 7, day, tzinfo=timezone.utc),
    )


def _topic_item(client, topic_key):
    response = client.get("/api/topics", params={"q": topic_key})
    assert response.status_code == 200
    return next(item for item in response.json()["items"] if item["topic_key"] == topic_key)


def test_topics_prefer_trimmed_profile_cover_over_latest_post(client, db_session):
    key = "cover-priority-regression"
    db_session.add(TopicProfile(
        topic_key=key,
        title="Manual topic cover",
        cover_image="  https://images.example.test/manual.jpg  ",
    ))
    db_session.add(_post("cover-priority-latest", key, "https://images.example.test/latest.jpg", 20))
    db_session.commit()

    assert _topic_item(client, key)["cover_image"] == "https://images.example.test/manual.jpg"


@pytest.mark.parametrize("profile_cover", [None, "   "])
def test_topics_use_latest_published_cover_from_the_same_topic(client, db_session, profile_cover):
    key = "cover-fallback-regression"
    if profile_cover is not None:
        db_session.add(TopicProfile(topic_key=key, title="Topic without a custom cover", cover_image=profile_cover))
    db_session.add_all([
        _post("cover-fallback-older", key, "https://images.example.test/older.jpg", 10),
        _post("cover-fallback-latest", key, "https://images.example.test/same-topic.jpg", 20),
        _post("cover-fallback-draft", key, "https://images.example.test/draft.jpg", 25, published=False),
        _post("cover-fallback-unrelated", "different-cover-topic", "https://images.example.test/unrelated.jpg", 26),
    ])
    db_session.commit()

    assert _topic_item(client, key)["cover_image"] == "https://images.example.test/same-topic.jpg"


@pytest.mark.parametrize("has_post", [True, False])
def test_topics_without_a_cover_return_an_empty_string(client, db_session, has_post):
    key = "cover-missing-regression"
    db_session.add(TopicProfile(topic_key=key, title="Text topic edition", cover_image=""))
    db_session.add(_post("cover-missing-unrelated", "another-cover-topic", "https://images.example.test/unrelated.jpg", 26))
    if has_post:
        db_session.add(_post("cover-missing-latest", key, "", 20))
    db_session.commit()

    assert _topic_item(client, key)["cover_image"] == ""
