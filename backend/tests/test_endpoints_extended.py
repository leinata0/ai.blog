"""Extended tests for endpoints that previously had no coverage:
likes, comments, archive, tags, friends, RSS, sitemap, related posts.
"""


def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ── Like ──

def test_like_post(client, seeded_db):
    resp = client.post("/api/posts/python-automation-selenium-pandas/like")
    assert resp.status_code == 200
    assert resp.json()["like_count"] >= 1


def test_like_post_duplicate(client, seeded_db):
    client.post("/api/posts/python-automation-selenium-pandas/like")
    resp = client.post("/api/posts/python-automation-selenium-pandas/like")
    assert resp.status_code == 400


def test_like_post_not_found(client, seeded_db):
    resp = client.post("/api/posts/nonexistent-slug/like")
    assert resp.status_code == 404


# ── Comments ──

def test_create_and_list_comments(client, seeded_db):
    slug = "python-automation-selenium-pandas"
    resp = client.post(f"/api/posts/{slug}/comments", json={
        "nickname": "Tester",
        "content": "Great post!",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["nickname"] == "Tester"
    assert data["content"] == "Great post!"

    resp2 = client.get(f"/api/posts/{slug}/comments")
    assert resp2.status_code == 200
    assert len(resp2.json()) >= 1


def test_comment_on_nonexistent_post(client, seeded_db):
    resp = client.post("/api/posts/nonexistent/comments", json={
        "nickname": "Tester",
        "content": "Hello",
    })
    assert resp.status_code == 404


def test_comment_validation(client, seeded_db):
    slug = "python-automation-selenium-pandas"
    # empty nickname
    resp = client.post(f"/api/posts/{slug}/comments", json={
        "nickname": "",
        "content": "Hello",
    })
    assert resp.status_code == 422


def test_admin_approve_and_delete_comment(client, seeded_db):
    slug = "python-automation-selenium-pandas"
    token = _login(client)

    # create a comment
    client.post(f"/api/posts/{slug}/comments", json={
        "nickname": "User",
        "content": "Nice article",
    })

    # list comments as admin
    resp = client.get("/api/admin/comments", headers=_auth(token))
    assert resp.status_code == 200
    comments = resp.json()["items"]
    assert len(comments) >= 1
    comment_id = comments[0]["id"]

    # approve
    resp = client.put(f"/api/admin/comments/{comment_id}/approve", headers=_auth(token))
    assert resp.status_code == 200

    # delete
    resp = client.delete(f"/api/admin/comments/{comment_id}", headers=_auth(token))
    assert resp.status_code == 200


# ── Related Posts ──

def test_related_posts(client, seeded_db):
    resp = client.get("/api/posts/python-automation-selenium-pandas/related")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── Archive ──

def test_archive(client, seeded_db):
    resp = client.get("/api/archive")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "year" in data[0]
    assert "posts" in data[0]


# ── Tags ──

def test_tags_cloud(client, seeded_db):
    resp = client.get("/api/tags")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "name" in data[0]
    assert "slug" in data[0]
    assert "post_count" in data[0]


# ── Friends ──

def test_friends(client, seeded_db):
    resp = client.get("/api/friends")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── RSS Feed ──

def test_rss_feed(client, seeded_db):
    resp = client.get("/feed.xml")
    assert resp.status_code == 200
    assert "application/xml" in resp.headers["content-type"]
    assert "<rss" in resp.text
    assert "<title>AI 资讯观察</title>" in resp.text
    assert "聚焦值得持续追踪的消息、产品更新与产业线索" in resp.text
    assert "python-automation-selenium-pandas" in resp.text


# ── Sitemap ──

def test_sitemap(client, seeded_db):
    resp = client.get("/sitemap.xml")
    assert resp.status_code == 200
    assert "application/xml" in resp.headers["content-type"]
    assert "<urlset" in resp.text
    assert "python-automation-selenium-pandas" in resp.text


# ── Admin Stats ──

def test_admin_stats(client, seeded_db):
    token = _login(client)
    resp = client.get("/api/admin/stats", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert "total_posts" in data
    assert "total_views" in data


def test_series_endpoints(client, seeded_db):
    list_resp = client.get("/api/series")
    assert list_resp.status_code == 200
    series_items = list_resp.json()
    assert isinstance(series_items, list)
    assert len(series_items) >= 5
    slug = series_items[0]["slug"]

    featured_resp = client.get("/api/series?featured=true&limit=2")
    assert featured_resp.status_code == 200
    featured_items = featured_resp.json()
    assert len(featured_items) <= 2
    assert all(item["is_featured"] is True for item in featured_items)

    detail_resp = client.get(f"/api/series/{slug}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["slug"] == slug
    assert "posts" in detail


def test_discover_endpoint(client, seeded_db):
    resp = client.get("/api/discover")
    assert resp.status_code == 200
    payload = resp.json()
    assert "featured_series" in payload
    assert "latest_daily" in payload
    assert "latest_weekly" in payload
    assert "editor_picks" in payload
    assert "items" in payload
    assert "total" in payload


def test_discover_endpoint_filters(client):
    token = _login(client)
    client.post(
        "/api/admin/posts",
        json={
            "title": "Filtered Daily",
            "slug": "filtered-daily",
            "summary": "daily summary",
            "content_md": "daily content",
            "content_type": "daily_brief",
            "series_slug": "ai-daily-brief",
            "is_published": True,
        },
        headers=_auth(token),
    )
    client.post(
        "/api/admin/posts",
        json={
            "title": "Filtered Weekly",
            "slug": "filtered-weekly",
            "summary": "weekly summary",
            "content_md": "weekly content",
            "content_type": "weekly_review",
            "series_slug": "ai-weekly-review",
            "is_published": True,
        },
        headers=_auth(token),
    )

    resp = client.get("/api/discover?content_type=daily_brief&series=ai-daily-brief&q=Filtered")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["total"] >= 1
    assert all(item["content_type"] == "daily_brief" for item in payload["items"])
    assert all(item["series_slug"] == "ai-daily-brief" for item in payload["items"])


def test_discover_sections_support_partial_payload(client, seeded_db):
    partial_resp = client.get("/api/discover?sections=items,total")
    assert partial_resp.status_code == 200
    partial_payload = partial_resp.json()
    assert "items" in partial_payload
    assert "total" in partial_payload
    assert "featured_series" not in partial_payload
    assert "latest_daily" not in partial_payload

    fallback_resp = client.get("/api/discover?sections=unknown_section")
    assert fallback_resp.status_code == 200
    fallback_payload = fallback_resp.json()
    assert "featured_series" in fallback_payload
    assert "latest_daily" in fallback_payload
    assert "latest_weekly" in fallback_payload
    assert "editor_picks" in fallback_payload
    assert "items" in fallback_payload
    assert "total" in fallback_payload


def test_split_feeds(client):
    token = _login(client)
    client.post(
        "/api/admin/posts",
        json={
            "title": "Daily One",
            "slug": "daily-one",
            "summary": "daily",
            "content_md": "daily",
            "content_type": "daily_brief",
        },
        headers=_auth(token),
    )
    client.post(
        "/api/admin/posts",
        json={
            "title": "Weekly One",
            "slug": "weekly-one",
            "summary": "weekly",
            "content_md": "weekly",
            "content_type": "weekly_review",
        },
        headers=_auth(token),
    )

    all_feed = client.get("/api/feeds/all.xml")
    daily_feed = client.get("/api/feeds/daily.xml")
    weekly_feed = client.get("/api/feeds/weekly.xml")
    assert all_feed.status_code == 200
    assert daily_feed.status_code == 200
    assert weekly_feed.status_code == 200
    assert "<rss" in all_feed.text
    assert "<title>AI 资讯观察 - 全站更新</title>" in all_feed.text
    assert "daily-one" in daily_feed.text
    assert "<title>AI 资讯观察 - AI 日报</title>" in daily_feed.text
    assert "weekly-one" in weekly_feed.text
    assert "<title>AI 资讯观察 - AI 周报</title>" in weekly_feed.text


def test_search_topics_and_topic_feed_contract(client):
    token = _login(client)
    client.post(
        "/api/admin/posts",
        json={
            "title": "OpenAI Search Update",
            "slug": "openai-search-update",
            "summary": "Search stack improvements",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "openai-search",
            "series_slug": "ai-daily-brief",
            "quality_score": 91,
            "tags": ["search", "openai"],
            "is_published": True,
        },
        headers=_auth(token),
    )
    client.post(
        "/api/admin/posts",
        json={
            "title": "OpenAI Topic Deep Dive",
            "slug": "openai-topic-deep-dive",
            "summary": "Topic perspective",
            "content_md": "content",
            "content_type": "weekly_review",
            "topic_key": "openai-search",
            "series_slug": "ai-weekly-review",
            "quality_score": 87,
            "tags": ["topic"],
            "is_published": True,
        },
        headers=_auth(token),
    )

    search_resp = client.get("/api/search?q=openai")
    assert search_resp.status_code == 200
    search_payload = search_resp.json()
    assert search_payload["query"] == "openai"
    assert search_payload["total"] >= 2
    assert len(search_payload["items"]) >= 1
    assert "match_reason" in search_payload["items"][0]

    ignored_resp = client.get("/api/search?q=o")
    assert ignored_resp.status_code == 200

    topics_resp = client.get("/api/topics?q=openai")
    assert topics_resp.status_code == 200
    topics_payload = topics_resp.json()
    assert "items" in topics_payload
    assert "total" in topics_payload
    assert any(item["topic_key"] == "openai-search" for item in topics_payload["items"])

    topic_detail_resp = client.get("/api/topics/openai-search")
    assert topic_detail_resp.status_code == 200
    detail_payload = topic_detail_resp.json()
    assert detail_payload["topic_key"] == "openai-search"
    assert detail_payload["post_count"] >= 2
    assert len(detail_payload["recent_posts"]) >= 1

    topic_feed_resp = client.get("/api/feeds/topics/openai-search.xml")
    assert topic_feed_resp.status_code == 200
    assert "<rss" in topic_feed_resp.text
    assert "<title>AI 资讯观察 - 主题：openai-search</title>" in topic_feed_resp.text
    assert "openai-search-update" in topic_feed_resp.text


def test_topics_support_featured_limit_and_page_size_alias(client):
    token = _login(client)
    client.post(
        "/api/admin/posts",
        json={
            "title": "ModelOps Pipeline Update",
            "slug": "modelops-pipeline-update",
            "summary": "ModelOps topic summary",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "modelops-pipeline",
            "quality_score": 88,
            "is_published": True,
        },
        headers=_auth(token),
    )
    client.post(
        "/api/admin/posts",
        json={
            "title": "Open Search Runtime",
            "slug": "open-search-runtime",
            "summary": "Search runtime topic",
            "content_md": "content",
            "content_type": "weekly_review",
            "topic_key": "open-search-runtime",
            "quality_score": 90,
            "is_published": True,
        },
        headers=_auth(token),
    )
    create_profile = client.post(
        "/api/admin/topic-profiles",
        json={
            "topic_key": "modelops-pipeline",
            "title": "ModelOps 主线",
            "display_title": "ModelOps 主线",
            "description": "ModelOps 主题",
            "is_featured": True,
            "sort_order": 1,
            "priority": 50,
        },
        headers=_auth(token),
    )
    assert create_profile.status_code == 200

    featured_resp = client.get("/api/topics?featured=true&limit=1")
    assert featured_resp.status_code == 200
    featured_payload = featured_resp.json()
    assert featured_payload["total"] >= 1
    assert len(featured_payload["items"]) == 1
    assert featured_payload["items"][0]["topic_key"] == "modelops-pipeline"

    alias_resp = client.get("/api/topics?page_size=1&q=search")
    assert alias_resp.status_code == 200
    alias_payload = alias_resp.json()
    assert len(alias_payload["items"]) == 1
