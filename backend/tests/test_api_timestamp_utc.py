"""Every timestamp that leaves the API carries an explicit UTC marker.

The DateTime columns are naive and hold UTC. A bare "2026-07-20T23:30:00" is parsed as
*local* time by ECMA-262, so a UTC+8 reader saw every 账号中心 / 关注 / 阅读历史 / 归档 /
后台面板 timestamp 8 hours early and day-grouped views landed on the wrong date.

`app/routers/posts.py` was fixed for the public article routes; admin.py carried a
same-named-different-behavior `_serialize_datetime` that dropped the offset, and users.py
had no serialization hook at all. These tests pin the whole surface, not one router.
"""
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import (
    AdminImageGenerationJob,
    AdminTextGenerationJob,
    Comment,
    FollowedTopic,
    Post,
    PostLike,
    PublishingRun,
    ReadingHistory,
    Series,
    User,
)


def _is_utc_marked(value) -> bool:
    """True when an ISO string carries an explicit UTC marker ("Z" or "+00:00")."""
    return isinstance(value, str) and (value.endswith("Z") or value.endswith("+00:00"))


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _register(client, db_session, email="clock@example.com"):
    response = client.post(
        "/api/users/register",
        json={"email": email, "password": "secret123", "nickname": "Clock Reader"},
    )
    assert response.status_code == 200, response.text
    user = db_session.execute(select(User).where(User.email == email)).scalar_one()
    user.email_verified = True  # liking/commenting is gated on a verified mailbox
    db_session.commit()
    return response.json()["access_token"], user


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(client):
    response = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


# ── the shared helper itself ──────────────────────

def test_serialization_helpers_normalize_naive_and_aware_input():
    from app.serialization import as_utc, iso_utc

    naive = datetime(2026, 7, 25, 23, 30, 0)
    assert iso_utc(naive) == "2026-07-25T23:30:00+00:00"
    assert as_utc(naive) == datetime(2026, 7, 25, 23, 30, 0, tzinfo=timezone.utc)

    shanghai = timezone(timedelta(hours=8))
    aware = datetime(2026, 7, 26, 7, 30, 0, tzinfo=shanghai)
    assert iso_utc(aware) == "2026-07-25T23:30:00+00:00"

    assert iso_utc(None) is None
    assert as_utc(None) is None


def test_routers_share_one_timestamp_serializer():
    """No router or service may grow its own copy again.

    This repo has repeatedly ended up with N implementations of one helper (admin login
    ×8, waitForImageGenerationJob ×2, stripMarkdown ×2). The admin/posts split is exactly
    how the offset got dropped on half the API, and home.py kept a fourth copy of
    ``_iso_utc`` alive for a whole round after the other three converged.
    """
    from app import serialization
    from app.routers import admin, home, posts, users
    from app.services import image_generation_jobs, text_generation_jobs

    assert posts.iso_utc is serialization.iso_utc
    assert admin.iso_utc is serialization.iso_utc
    assert users.iso_utc is serialization.iso_utc
    assert home.iso_utc is serialization.iso_utc
    assert image_generation_jobs.as_utc is serialization.as_utc
    assert text_generation_jobs.as_utc is serialization.as_utc
    for module in (
        admin,
        home,
        posts,
        users,
        image_generation_jobs,
        text_generation_jobs,
    ):
        assert not hasattr(module, "_serialize_datetime")
        assert not hasattr(module, "_iso_utc")
        assert not hasattr(module, "_as_aware")


# ── /api/users: followed topics ───────────────────

def test_followed_topics_carry_utc_marker(client, db_session):
    token, user = _register(client, db_session, "topics-clock@example.com")
    headers = _headers(token)

    client.post("/api/users/me/topics", json={"topic_key": "llm", "display_title": "大模型"}, headers=headers)

    # Pin the stored value so the assertion is about the *instant*, not just the suffix.
    row = db_session.execute(select(FollowedTopic).where(FollowedTopic.user_id == user.id)).scalar_one()
    row.followed_at = datetime(2026, 7, 25, 23, 30, 0)
    db_session.commit()

    payload = client.get("/api/users/me/topics", headers=headers).json()
    assert len(payload) == 1
    assert _is_utc_marked(payload[0]["followed_at"]), payload[0]
    assert _instant(payload[0]["followed_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    # The write endpoints echo the same list — they must not bypass the serializer.
    echoed = client.post(
        "/api/users/me/topics", json={"topic_key": "llm", "display_title": "大模型"}, headers=headers
    ).json()
    assert _is_utc_marked(echoed[0]["followed_at"])
    merged = client.post(
        "/api/users/me/topics/merge",
        json={"topics": [{"topic_key": "agents", "display_title": "智能体"}]},
        headers=headers,
    ).json()
    assert all(_is_utc_marked(item["followed_at"]) for item in merged)


# ── /api/users: reading history ───────────────────

def test_reading_history_carries_utc_marker(client, db_session):
    token, user = _register(client, db_session, "history-clock@example.com")
    headers = _headers(token)

    recorded = client.post(
        "/api/users/me/history", json={"slug": "post-a", "title": "A"}, headers=headers
    ).json()
    assert _is_utc_marked(recorded[0]["visited_at"]), recorded[0]

    row = db_session.execute(select(ReadingHistory).where(ReadingHistory.user_id == user.id)).scalar_one()
    row.visited_at = datetime(2026, 7, 25, 23, 30, 0)
    db_session.commit()

    listed = client.get("/api/users/me/history", headers=headers).json()
    assert _instant(listed[0]["visited_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    merged = client.post(
        "/api/users/me/history/merge",
        json={"items": [{"slug": "post-b", "title": "B"}]},
        headers=headers,
    ).json()
    assert all(_is_utc_marked(item["visited_at"]) for item in merged)


# ── /api/users: account centre surfaces ───────────

def test_account_profile_and_dashboard_carry_utc_markers(client, db_session):
    token, user = _register(client, db_session, "dashboard-clock@example.com")
    headers = _headers(token)
    post = db_session.execute(select(Post)).scalars().first()
    post.topic_key = "agents"
    post.created_at = datetime(2026, 7, 25, 23, 30, 0)
    user.last_login_at = datetime(2026, 7, 25, 22, 0, 0)
    db_session.commit()

    client.post("/api/users/me/topics", json={"topic_key": "agents", "display_title": "智能体"}, headers=headers)
    client.post(
        "/api/users/me/history",
        json={"slug": post.slug, "title": post.title, "topic_key": "agents"},
        headers=headers,
    )

    me = client.get("/api/users/me", headers=headers).json()
    assert _is_utc_marked(me["created_at"]), me
    assert _is_utc_marked(me["last_login_at"]), me
    assert _instant(me["last_login_at"]) == datetime(2026, 7, 25, 22, 0, tzinfo=timezone.utc)

    dashboard = client.get("/api/users/me/dashboard", headers=headers).json()
    assert _is_utc_marked(dashboard["security"]["last_login_at"]), dashboard["security"]
    assert _is_utc_marked(dashboard["recent_history"][0]["occurred_at"]), dashboard["recent_history"][0]

    update = dashboard["followed_updates"][0]
    assert _is_utc_marked(update["followed_at"]), update
    assert _is_utc_marked(update["latest_post"]["published_at"]), update
    assert _instant(update["latest_post"]["published_at"]) == datetime(
        2026, 7, 25, 23, 30, tzinfo=timezone.utc
    )


def test_account_library_export_comments_and_likes_carry_utc_markers(client, db_session):
    token, user = _register(client, db_session, "library-clock@example.com")
    headers = _headers(token)
    post = db_session.execute(select(Post)).scalars().first()
    slug = post.slug

    client.post("/api/users/me/history", json={"slug": slug, "title": post.title}, headers=headers)
    client.post(f"/api/posts/{slug}/like", headers=headers)
    client.post(f"/api/posts/{slug}/comments", json={"content": "值得继续关注"}, headers=headers)

    db_session.execute(select(PostLike)).scalars().one().created_at = datetime(2026, 7, 25, 23, 30, 0)
    db_session.execute(select(Comment)).scalars().one().created_at = datetime(2026, 7, 25, 23, 45, 0)
    db_session.commit()

    library = client.get("/api/users/me/library", headers=headers).json()
    assert library["items"]
    for item in library["items"]:
        assert _is_utc_marked(item["occurred_at"]), item

    my_comments = client.get("/api/users/me/comments", headers=headers).json()
    assert _instant(my_comments[0]["created_at"]) == datetime(2026, 7, 25, 23, 45, tzinfo=timezone.utc)
    my_likes = client.get("/api/users/me/likes", headers=headers).json()
    assert _instant(my_likes[0]["created_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    export = client.get("/api/users/me/export", headers=headers).json()
    assert _is_utc_marked(export["exported_at"]), export["exported_at"]
    assert _is_utc_marked(export["profile"]["created_at"]), export["profile"]
    assert all(_is_utc_marked(item["followed_at"]) for item in export["followed_topics"])
    for bucket in ("reading_history", "likes", "comments"):
        for item in export[bucket]:
            assert _is_utc_marked(item["occurred_at"]), (bucket, item)


# ── /api/admin ────────────────────────────────────

def test_admin_posts_comments_and_users_carry_utc_markers(client, db_session):
    headers = _admin_headers(client)
    token, user = _register(client, db_session, "admin-view-clock@example.com")
    post = db_session.execute(select(Post)).scalars().first()
    post.created_at = datetime(2026, 7, 25, 23, 30, 0)
    post.updated_at = datetime(2026, 7, 25, 23, 40, 0)
    user.created_at = datetime(2026, 7, 25, 20, 0, 0)
    user.last_login_at = datetime(2026, 7, 25, 21, 0, 0)
    db_session.commit()
    post_id = post.id

    client.post(f"/api/posts/{post.slug}/comments", json={"content": "很有价值"}, headers=_headers(token))
    db_session.execute(select(Comment)).scalars().one().created_at = datetime(2026, 7, 25, 23, 50, 0)
    db_session.commit()

    listed = client.get("/api/admin/posts", headers=headers).json()["items"][0]
    assert _is_utc_marked(listed["created_at"]), listed
    assert _is_utc_marked(listed["updated_at"]), listed

    detail = client.get(f"/api/admin/posts/{post_id}", headers=headers).json()
    assert _instant(detail["created_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    comments = client.get("/api/admin/comments", headers=headers).json()["items"]
    assert _instant(comments[0]["created_at"]) == datetime(2026, 7, 25, 23, 50, tzinfo=timezone.utc)

    users = client.get("/api/admin/users", headers=headers).json()["items"]
    row = next(item for item in users if item["email"] == "admin-view-clock@example.com")
    assert _instant(row["created_at"]) == datetime(2026, 7, 25, 20, 0, tzinfo=timezone.utc)
    assert _instant(row["last_login_at"]) == datetime(2026, 7, 25, 21, 0, tzinfo=timezone.utc)


def test_admin_series_and_topic_panels_carry_utc_markers(client, db_session):
    headers = _admin_headers(client)
    post = db_session.execute(select(Post)).scalars().first()
    post.topic_key = "agents"
    post.series_slug = "ai-daily-brief"
    post.is_published = True
    post.created_at = datetime(2026, 7, 25, 23, 30, 0)
    series = db_session.execute(
        select(Series).where(Series.slug == "ai-daily-brief")
    ).scalar_one_or_none()
    if series is None:
        series = Series(slug="ai-daily-brief", title="AI 日报")
        db_session.add(series)
    series.created_at = datetime(2026, 7, 20, 1, 0, 0)
    series.updated_at = datetime(2026, 7, 21, 2, 0, 0)
    db_session.commit()

    series = client.get("/api/admin/series", headers=headers).json()
    entry = next(item for item in series if item["slug"] == "ai-daily-brief")
    assert _is_utc_marked(entry["created_at"]), entry
    assert _is_utc_marked(entry["updated_at"]), entry
    assert _instant(entry["latest_post_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    # AdminTopicHealth.jsx renders latest_post_at; it used to arrive unserialized.
    health = client.get("/api/admin/topic-health", headers=headers).json()["items"]
    agents = next(item for item in health if item["topic_key"] == "agents")
    assert _is_utc_marked(agents["latest_post_at"]), agents
    assert _instant(agents["latest_post_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    # AdminTopicProfiles.jsx renders latest_post_at / created_at / updated_at.
    created = client.post(
        "/api/admin/topic-profiles",
        json={"topic_key": "agents", "display_title": "智能体"},
        headers=headers,
    )
    assert created.status_code in (200, 201), created.text
    profiles = client.get("/api/admin/topic-profiles", headers=headers).json()
    profile = next(item for item in profiles if item["topic_key"] == "agents")
    assert _is_utc_marked(profile["created_at"]), profile
    assert _is_utc_marked(profile["updated_at"]), profile
    assert _instant(profile["latest_post_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)


# ── /api/home ─────────────────────────────────────

def test_home_modules_carry_utc_markers(client, db_session):
    """home.py used to carry a fourth private copy of the serializer; it renders the
    same 发布时间 strings the article cards do."""
    post = db_session.execute(select(Post)).scalars().first()
    post.content_type = "daily_brief"
    post.is_published = True
    post.created_at = datetime(2026, 7, 25, 23, 30, 0)
    post.updated_at = datetime(2026, 7, 25, 23, 40, 0)
    db_session.commit()

    payload = client.get("/api/home/modules").json()
    daily = payload["latest_daily"]
    assert daily, payload
    assert _is_utc_marked(daily[0]["created_at"]), daily[0]
    assert _is_utc_marked(daily[0]["updated_at"]), daily[0]
    assert _instant(daily[0]["created_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)


# ── /api/admin generation jobs ────────────────────

def _seed_generation_jobs(db_session):
    """Two terminal job rows with pinned naive-UTC timestamps, written straight to the
    tables so no LLM/image provider is touched."""
    image_job = AdminImageGenerationJob(
        job_type="post_cover",
        target_id=1,
        status="succeeded",
        result_image_url="https://cdn.example.test/cover.png",
        created_at=datetime(2026, 7, 25, 23, 30, 0),
        updated_at=datetime(2026, 7, 25, 23, 32, 0),
        started_at=datetime(2026, 7, 25, 23, 30, 30),
        finished_at=datetime(2026, 7, 25, 23, 32, 0),
    )
    text_job = AdminTextGenerationJob(
        status="succeeded",
        result_content="摘要草稿",
        provider="siliconflow",
        model="deepseek-v3",
        created_at=datetime(2026, 7, 25, 22, 30, 0),
        updated_at=datetime(2026, 7, 25, 22, 31, 0),
        started_at=datetime(2026, 7, 25, 22, 30, 10),
        finished_at=datetime(2026, 7, 25, 22, 31, 0),
    )
    db_session.add_all([image_job, text_job])
    db_session.commit()
    return image_job.id, text_job.id


def test_generation_job_polling_endpoints_carry_utc_markers(client, db_session):
    """job_to_dict fed raw ORM datetimes into the response model, so the admin 生成历史
    panel received naive strings that a UTC+8 browser read 8 hours early."""
    headers = _admin_headers(client)
    image_id, text_id = _seed_generation_jobs(db_session)

    image = client.get(f"/api/admin/image-generation-jobs/{image_id}", headers=headers).json()
    for field in ("created_at", "updated_at", "started_at", "finished_at"):
        assert _is_utc_marked(image[field]), (field, image)
    assert _instant(image["created_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)

    text = client.get(f"/api/admin/text-generation-jobs/{text_id}", headers=headers).json()
    for field in ("created_at", "updated_at", "started_at", "finished_at"):
        assert _is_utc_marked(text[field]), (field, text)
    assert _instant(text["finished_at"]) == datetime(2026, 7, 25, 22, 31, tzinfo=timezone.utc)


def test_generation_history_carries_utc_markers_and_stays_sortable(client, db_session):
    """The merged history dock sorts image and text rows against one another, so these
    values must stay comparable datetimes as well as UTC-marked on the wire."""
    headers = _admin_headers(client)
    _seed_generation_jobs(db_session)

    items = client.get("/api/admin/generation-jobs?limit=40", headers=headers).json()["items"]
    assert {item["kind"] for item in items} == {"image_generation", "text_generation"}
    for item in items:
        for field in ("created_at", "updated_at", "finished_at"):
            assert _is_utc_marked(item[field]), (item["kind"], field, item)

    # Newest first: the image job (23:30) outranks the text job (22:30).
    assert items[0]["kind"] == "image_generation"


# ── /api/admin: timestamps persisted inside a JSON blob ──

def test_legacy_publishing_run_payload_is_reserialized_with_utc_marker(client, db_session):
    """``publishing_runs.payload_json`` is the one place a *stored* timestamp string
    reaches the wire. Rows written before ``_normalize_topic_payload`` moved to
    ``iso_utc`` hold a bare "2026-07-25T23:30:00", and no router hook can reach them —
    the PublishingTopicOut field serializer is what normalizes them.
    """
    headers = _admin_headers(client)
    run = PublishingRun(
        workflow_key="daily_auto",
        external_run_id="legacy-run-1",
        run_mode="auto",
        status="success",
        published_count=1,
        # Exactly what the old offset-dropping _serialize_datetime persisted.
        payload_json=json.dumps(
            {
                "published_topics": [
                    {"topic_key": "llm", "title": "大模型", "published_at": "2026-07-25T23:30:00"}
                ]
            },
            ensure_ascii=False,
        ),
        started_at=datetime(2026, 7, 25, 23, 0, 0),
        finished_at=datetime(2026, 7, 25, 23, 35, 0),
        updated_at=datetime(2026, 7, 25, 23, 35, 0),
    )
    db_session.add(run)
    db_session.commit()

    payload = client.get(f"/api/admin/publishing-runs/{run.id}", headers=headers).json()
    assert _is_utc_marked(payload["started_at"]), payload
    topic = payload["published_topics"][0]
    assert _is_utc_marked(topic["published_at"]), topic
    assert _instant(topic["published_at"]) == datetime(2026, 7, 25, 23, 30, tzinfo=timezone.utc)
