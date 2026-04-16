def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_success(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_failure(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_no_token_returns_401_or_403(client):
    resp = client.post("/api/admin/posts", json={"title": "t", "slug": "s", "summary": "s", "content_md": "c"})
    assert resp.status_code in (401, 403)


def test_create_post(client):
    token = _login(client)
    resp = client.post("/api/admin/posts", json={
        "title": "Test Post",
        "slug": "test-post",
        "summary": "A test",
        "content_md": "# Hello",
        "content_type": "daily_brief",
        "topic_key": "openai-launches-x",
        "published_mode": "auto",
        "coverage_date": "2026-04-14",
        "series_slug": "ai-daily-brief",
        "series_order": 1,
        "editor_note": "editor note",
        "source_count": 4,
        "quality_score": 88.5,
        "reading_time": 12,
        "tags": ["python", "test"],
    }, headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Post"
    assert data["slug"] == "test-post"
    assert data["content_type"] == "daily_brief"
    assert data["topic_key"] == "openai-launches-x"
    assert data["published_mode"] == "auto"
    assert data["coverage_date"] == "2026-04-14"
    assert data["series_slug"] == "ai-daily-brief"
    assert data["series_order"] == 1
    assert data["editor_note"] == "editor note"
    assert data["source_count"] == 4
    assert data["quality_score"] == 88.5
    assert data["reading_time"] == 12
    assert len(data["tags"]) == 2
    assert data["id"] is not None


def test_create_post_duplicate_slug_returns_409(client):
    token = _login(client)
    payload = {
        "title": "Test Post",
        "slug": "test-post",
        "summary": "A test",
        "content_md": "# Hello",
    }

    first = client.post("/api/admin/posts", json=payload, headers=_auth(token))
    assert first.status_code == 200

    duplicate = client.post("/api/admin/posts", json=payload, headers=_auth(token))
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Post slug already exists"


def test_update_post(client):
    token = _login(client)
    create = client.post("/api/admin/posts", json={
        "title": "Original",
        "slug": "original",
        "summary": "s",
        "content_md": "c",
    }, headers=_auth(token))
    post_id = create.json()["id"]

    resp = client.put(f"/api/admin/posts/{post_id}", json={
        "title": "Updated",
        "content_type": "weekly_review",
        "published_mode": "manual",
        "series_slug": "ai-weekly-review",
        "source_count": 2,
        "quality_score": 90.0,
    }, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated"
    assert resp.json()["slug"] == "original"
    assert resp.json()["content_type"] == "weekly_review"
    assert resp.json()["published_mode"] == "manual"
    assert resp.json()["series_slug"] == "ai-weekly-review"
    assert resp.json()["source_count"] == 2
    assert resp.json()["quality_score"] == 90.0


def test_get_admin_post_by_id(client):
    token = _login(client)
    create = client.post("/api/admin/posts", json={
        "title": "Existing Post",
        "slug": "existing-post",
        "summary": "s",
        "content_md": "c",
        "tags": ["ai"],
    }, headers=_auth(token))
    assert create.status_code == 200
    post_id = create.json()["id"]

    resp = client.get(f"/api/admin/posts/{post_id}", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == post_id
    assert data["slug"] == "existing-post"
    assert len(data["tags"]) == 1


def test_upsert_and_fetch_publishing_status(client):
    token = _login(client)
    payload = {
        "workflow_key": "daily_auto",
        "external_run_id": "gha-123",
        "run_mode": "auto",
        "status": "success",
        "coverage_date": "2026-04-14",
        "message": "Published 2 posts, skipped 1 duplicate",
        "candidate_topics": [
            {
                "topic_key": "openai-api-update",
                "title": "OpenAI API update",
                "summary": "A new API launch",
                "source_count": 3,
                "source_names": ["OpenAI Blog", "TechCrunch"],
                "content_type": "daily_brief",
            }
        ],
        "published_topics": [
            {
                "topic_key": "openai-api-update",
                "title": "OpenAI API update",
                "post_slug": "openai-api-update",
                "published_mode": "auto",
                "content_type": "daily_brief",
            }
        ],
        "skipped_topics": [
            {
                "topic_key": "same-news",
                "title": "Same news from another source",
                "reason": "duplicate topic_key detected",
                "status": "skipped",
            }
        ],
    }

    create_resp = client.post(
        "/api/admin/publishing-status",
        json=payload,
        headers=_auth(token),
    )
    assert create_resp.status_code == 200
    data = create_resp.json()
    assert data["workflow_key"] == "daily_auto"
    assert data["summary"]["candidate_count"] == 1
    assert data["summary"]["published_count"] == 1
    assert data["summary"]["skipped_count"] == 1
    assert data["summary"]["auto_published_count"] == 1
    assert data["published_topics"][0]["post_slug"] == "openai-api-update"

    list_resp = client.get("/api/admin/publishing-status", headers=_auth(token))
    assert list_resp.status_code == 200
    status_data = list_resp.json()
    assert status_data["latest_runs"]["daily_auto"]["external_run_id"] == "gha-123"
    assert status_data["recent_runs"][0]["message"] == "Published 2 posts, skipped 1 duplicate"
    assert status_data["latest_runs"]["weekly_review"] is None

    run_id = data["id"]
    run_resp = client.get(f"/api/admin/publishing-runs/{run_id}", headers=_auth(token))
    assert run_resp.status_code == 200
    assert run_resp.json()["external_run_id"] == "gha-123"


def test_admin_series_crud(client):
    token = _login(client)

    list_resp = client.get("/api/admin/series", headers=_auth(token))
    assert list_resp.status_code == 200
    assert isinstance(list_resp.json(), list)
    assert len(list_resp.json()) >= 5

    create_resp = client.post(
        "/api/admin/series",
        json={
            "slug": "infra-playbook",
            "title": "Infra Playbook",
            "description": "infra",
            "content_types": ["post"],
            "is_featured": False,
            "sort_order": 99,
        },
        headers=_auth(token),
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["slug"] == "infra-playbook"

    update_resp = client.put(
        f"/api/admin/series/{created['id']}",
        json={"title": "Infra Playbook Updated", "is_featured": True},
        headers=_auth(token),
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["title"] == "Infra Playbook Updated"
    assert update_resp.json()["is_featured"] is True


def test_content_health_and_publishing_metadata_bridge(client):
    token = _login(client)
    create = client.post(
        "/api/admin/posts",
        json={
            "title": "Metadata Bridge Post",
            "slug": "metadata-bridge-post",
            "summary": "summary",
            "content_md": "content",
            "content_type": "daily_brief",
            "published_mode": "auto",
            "coverage_date": "2026-04-15",
        },
        headers=_auth(token),
    )
    assert create.status_code == 200
    post_id = create.json()["id"]

    bridge_resp = client.post(
        "/api/admin/posts/publishing-metadata",
        json={
            "post_id": post_id,
            "series_slug": "ai-daily-brief",
            "series_order": 10,
            "editor_note": "bridge-note",
            "quality_score": 92.5,
            "reading_time": 15,
            "sources": [
                {
                    "source_type": "official_blog",
                    "source_name": "OpenAI Blog",
                    "source_url": "https://openai.com/blog/sample",
                    "is_primary": True,
                },
                {
                    "source_type": "news",
                    "source_name": "Tech Media",
                    "source_url": "https://example.com/news/sample",
                    "is_primary": False,
                },
            ],
            "artifact": {
                "workflow_key": "daily_auto",
                "coverage_date": "2026-04-15",
                "research_pack_summary": "summary",
                "quality_gate_json": "{\"score\": 90}",
                "image_plan_json": "[]",
                "candidate_topics_json": "[{\"topic_key\": \"k\"}]",
                "failure_reason": "",
            },
        },
        headers=_auth(token),
    )
    assert bridge_resp.status_code == 200
    bridge_data = bridge_resp.json()
    assert bridge_data["post_id"] == post_id
    assert bridge_data["source_count"] == 2

    health_resp = client.get("/api/admin/content-health", headers=_auth(token))
    assert health_resp.status_code == 200
    health_data = health_resp.json()
    assert "summary" in health_data
    assert isinstance(health_data["items"], list)
    assert any(item["slug"] == "metadata-bridge-post" for item in health_data["items"])


def test_content_health_and_publishing_metadata_bridge_alias_contract(client):
    token = _login(client)
    create = client.post(
        "/api/admin/posts",
        json={
            "title": "Metadata Alias Post",
            "slug": "metadata-alias-post",
            "summary": "summary",
            "content_md": "content",
            "content_type": "weekly_review",
            "published_mode": "auto",
            "coverage_date": "2026-04-15",
        },
        headers=_auth(token),
    )
    assert create.status_code == 200

    bridge_resp = client.post(
        "/api/admin/publishing-metadata",
        json={
            "post_slug": "metadata-alias-post",
            "metadata": {
                "series_slug": "ai-weekly-review",
                "series_order": 20,
                "quality_score": 95.0,
                "reading_time": 22,
            },
            "post_sources": [
                {
                    "source_type": "official_blog",
                    "source_name": "Anthropic",
                    "source_url": "https://anthropic.com/news/sample",
                    "is_primary": True,
                }
            ],
            "publishing_artifact": {
                "workflow_key": "weekly_review",
                "coverage_date": "2026-04-15",
                "research_pack_summary": "alias summary",
                "quality_gate_json": "{\"score\": 95}",
                "image_plan_json": "[]",
                "candidate_topics_json": "[]",
                "failure_reason": "",
            },
        },
        headers=_auth(token),
    )
    assert bridge_resp.status_code == 200
    bridge_data = bridge_resp.json()
    assert bridge_data["post_slug"] == "metadata-alias-post"
    assert bridge_data["source_count"] == 1


def test_quality_endpoints_contract_and_null_compat(client):
    token = _login(client)
    create = client.post(
        "/api/admin/posts",
        json={
            "title": "Quality Contract Post",
            "slug": "quality-contract-post",
            "summary": "summary",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "quality-contract",
            "coverage_date": "2026-04-15",
        },
        headers=_auth(token),
    )
    assert create.status_code == 200
    post_id = create.json()["id"]

    detail_before = client.get(f"/api/admin/posts/{post_id}/quality", headers=_auth(token))
    assert detail_before.status_code == 200
    before_payload = detail_before.json()
    assert before_payload["post"]["id"] == post_id
    assert before_payload["quality_snapshot"] is None
    assert before_payload["quality_review"] is None

    snapshot_resp = client.put(
        f"/api/admin/posts/{post_id}/quality",
        json={
            "quality_snapshot": {
                "overall_score": 84,
                "structure_score": 88,
                "source_score": 80,
                "analysis_score": 82,
                "packaging_score": 76,
                "resonance_score": 34,
                "quality_score": 83,
                "source_count": 4,
                "reading_time": 7,
                "issues": ["missing_sources"],
                "strengths": ["complete_structure"],
                "notes": "quality snapshot contract",
            }
        },
        headers=_auth(token),
    )
    assert snapshot_resp.status_code == 200
    snapshot_payload = snapshot_resp.json()
    assert snapshot_payload["post_id"] == post_id
    assert snapshot_payload["overall_score"] == 84
    assert snapshot_payload["issues"] == ["missing_sources"]
    assert snapshot_payload["strengths"] == ["complete_structure"]

    review_resp = client.put(
        f"/api/admin/posts/{post_id}/quality-review",
        json={
            "editor_verdict": "solid",
            "editor_labels": ["结构稳定", "可继续跟进"],
            "editor_note": "manual review note",
            "followup_recommended": True,
        },
        headers=_auth(token),
    )
    assert review_resp.status_code == 200
    review_payload = review_resp.json()
    assert review_payload["post_id"] == post_id
    assert review_payload["editor_verdict"] == "solid"
    assert review_payload["followup_recommended"] is True
    assert len(review_payload["editor_labels"]) == 2

    inbox_resp = client.get("/api/admin/quality-inbox", headers=_auth(token))
    assert inbox_resp.status_code == 200
    inbox_payload = inbox_resp.json()
    assert "summary" in inbox_payload
    assert "items" in inbox_payload
    assert "total_posts" in inbox_payload["summary"]
    assert "with_snapshot_count" in inbox_payload["summary"]
    assert "reviewed_count" in inbox_payload["summary"]
    assert "followup_recommended_count" in inbox_payload["summary"]
    assert "avg_overall_score" in inbox_payload["summary"]
    target = next((item for item in inbox_payload["items"] if item["post_id"] == post_id), None)
    assert target is not None
    assert target["overall_score"] == 84
    assert target["editor_verdict"] == "solid"
    assert target["followup_recommended"] is True
    assert target["snapshot_updated_at"] is not None
    assert target["reviewed_at"] is not None


def test_topic_feedback_contract(client):
    token = _login(client)
    create = client.post(
        "/api/admin/posts",
        json={
            "title": "Topic Feedback Sample",
            "slug": "topic-feedback-sample",
            "summary": "summary",
            "content_md": "content",
            "content_type": "weekly_review",
            "topic_key": "agents",
            "series_slug": "ai-weekly-review",
            "coverage_date": "2026-04-15",
            "view_count": 120,
            "like_count": 8,
        },
        headers=_auth(token),
    )
    assert create.status_code == 200
    post_id = create.json()["id"]

    client.put(
        f"/api/admin/posts/{post_id}/quality-review",
        json={
            "editor_verdict": "excellent",
            "editor_labels": ["深度足够"],
            "editor_note": "keep tracking",
            "followup_recommended": True,
        },
        headers=_auth(token),
    )

    resp = client.get("/api/admin/topic-feedback", headers=_auth(token))
    assert resp.status_code == 200
    payload = resp.json()
    assert "summary" in payload
    assert "items" in payload
    assert "topic_count" in payload["summary"]
    assert "strong_topic_count" in payload["summary"]
    assert "weak_topic_count" in payload["summary"]
    assert isinstance(payload["items"], list)
    assert len(payload["items"]) >= 1
    first = payload["items"][0]
    assert "topic_key" in first
    assert "series_slug" in first
    assert "content_type" in first
    assert "post_count" in first
    assert "avg_overall_score" in first
    assert "avg_structure_score" in first
    assert "avg_source_score" in first
    assert "avg_analysis_score" in first
    assert "avg_packaging_score" in first
    assert "avg_resonance_score" in first
    assert "avg_views" in first
    assert "avg_likes" in first
    assert "followup_rate" in first
    assert "dominant_issues" in first
    assert "latest_post_title" in first
    assert "latest_post_slug" in first
    assert "recommendation" in first


def test_admin_topic_profiles_topic_health_and_search_insights(client):
    token = _login(client)

    create_profile = client.post(
        "/api/admin/topic-profiles",
        json={
            "topic_key": "agent-runtime",
            "title": "Agent Runtime",
            "display_title": "Agent Runtime",
            "description": "runtime topic profile",
            "cover_image": "",
            "aliases": ["agents-runtime", "agent-orchestration"],
            "focus_points": ["latency", "quality"],
            "content_types": ["daily_brief", "weekly_review"],
            "series_slug": "tooling-workflow",
            "is_featured": True,
            "sort_order": 10,
            "is_active": True,
            "priority": 50,
        },
        headers=_auth(token),
    )
    assert create_profile.status_code == 200
    profile_payload = create_profile.json()
    assert profile_payload["topic_key"] == "agent-runtime"
    assert profile_payload["display_title"] == "Agent Runtime"
    assert profile_payload["aliases"] == ["agents-runtime", "agent-orchestration"]
    assert profile_payload["is_featured"] is True
    assert profile_payload["sort_order"] == 10
    profile_id = profile_payload["id"]

    list_profile = client.get("/api/admin/topic-profiles", headers=_auth(token))
    assert list_profile.status_code == 200
    profile_item = next(item for item in list_profile.json() if item["topic_key"] == "agent-runtime")
    assert profile_item["profile_exists"] is True
    assert profile_item["is_virtual"] is False
    assert "display_title_source" in profile_item
    assert "source_count" in profile_item
    assert "latest_post_title" in profile_item
    assert "latest_post_slug" in profile_item

    update_profile = client.put(
        f"/api/admin/topic-profiles/{profile_id}",
        json={
            "display_title": "Agent Runtime Updated",
            "cover_image": "https://img.example.com/topic-cover.png",
            "aliases": ["agent-runtime-v2"],
            "priority": 80,
        },
        headers=_auth(token),
    )
    assert update_profile.status_code == 200
    assert update_profile.json()["display_title"] == "Agent Runtime Updated"
    assert update_profile.json()["cover_image"] == "https://img.example.com/topic-cover.png"
    assert update_profile.json()["aliases"] == ["agent-runtime-v2"]
    assert update_profile.json()["priority"] == 80

    topic_cover_resp = client.post(
        f"/api/admin/topic-profiles/{profile_id}/generate-cover",
        json={"image_url": "https://img.example.com/topic-generate.png"},
        headers=_auth(token),
    )
    assert topic_cover_resp.status_code == 200
    assert topic_cover_resp.json()["generated"] is True
    assert topic_cover_resp.json()["cover_image"] == "https://img.example.com/topic-generate.png"

    topic_cover_noop = client.post(
        f"/api/admin/topic-profiles/{profile_id}/generate-cover",
        json={},
        headers=_auth(token),
    )
    assert topic_cover_noop.status_code == 200
    assert topic_cover_noop.json()["generated"] is False
    assert topic_cover_noop.json()["error_code"] == "cover_exists"

    create_post = client.post(
        "/api/admin/posts",
        json={
            "title": "Agent Runtime Post",
            "slug": "agent-runtime-post",
            "summary": "summary",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "agent-runtime",
            "series_slug": "tooling-workflow",
            "quality_score": 89,
            "is_published": True,
        },
        headers=_auth(token),
    )
    assert create_post.status_code == 200

    search_hit = client.get("/api/search?q=agent runtime")
    assert search_hit.status_code == 200
    search_short = client.get("/api/search?q=a")
    assert search_short.status_code == 200

    topic_health = client.get("/api/admin/topic-health", headers=_auth(token))
    assert topic_health.status_code == 200
    health_payload = topic_health.json()
    assert "items" in health_payload
    assert "total" in health_payload
    assert any(item["topic_key"] == "agent-runtime" for item in health_payload["items"])

    insights = client.get("/api/admin/search-insights", headers=_auth(token))
    assert insights.status_code == 200
    insights_payload = insights.json()
    assert "items" in insights_payload
    assert "total" in insights_payload
    assert any(item["query"] == "agent runtime" for item in insights_payload["items"])
    assert all(len(item["query"]) >= 2 for item in insights_payload["items"])


def test_admin_topic_profiles_include_virtual_topics_from_published_posts(client):
    token = _login(client)
    create_post = client.post(
        "/api/admin/posts",
        json={
            "title": "OpenAI 发布新一代智能体编排能力",
            "slug": "openai-agent-orchestration-update",
            "summary": "围绕新一代智能体编排能力，观察产品化落地与生态变化。",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "openai-agent-orchestration",
            "source_count": 6,
            "is_published": True,
        },
        headers=_auth(token),
    )
    assert create_post.status_code == 200

    list_profile = client.get("/api/admin/topic-profiles", headers=_auth(token))
    assert list_profile.status_code == 200
    items = list_profile.json()
    virtual = next(item for item in items if item["topic_key"] == "openai-agent-orchestration")
    assert virtual["profile_exists"] is False
    assert virtual["is_virtual"] is True
    assert virtual["post_count"] >= 1
    assert virtual["source_count"] >= 6
    assert virtual["latest_post_slug"] == "openai-agent-orchestration-update"
    assert virtual["display_title_source"] in {"bridged", "derived", "raw"}


def test_admin_series_generate_cover(client):
    token = _login(client)
    list_resp = client.get("/api/admin/series", headers=_auth(token))
    assert list_resp.status_code == 200
    series_id = list_resp.json()[0]["id"]

    generated = client.post(
        f"/api/admin/series/{series_id}/generate-cover",
        json={"image_url": "https://img.example.com/series-cover.png"},
        headers=_auth(token),
    )
    assert generated.status_code == 200
    assert generated.json()["generated"] is True
    assert generated.json()["cover_image"] == "https://img.example.com/series-cover.png"

    no_image = client.post(
        f"/api/admin/series/{series_id}/generate-cover",
        json={"prompt": "no-url"},
        headers=_auth(token),
    )
    assert no_image.status_code == 200
    assert no_image.json()["generated"] is False
    assert no_image.json()["error_code"] == "cover_exists"


def test_cover_generation_status_reports_backend_env(client, monkeypatch):
    from app.routers import admin as admin_mod

    token = _login(client)
    monkeypatch.setattr(admin_mod, "clean_env", lambda key: "")

    response = client.get("/api/admin/cover-generation-status", headers=_auth(token))
    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "grok"
    assert payload["has_xai_api_key"] is False
    assert payload["can_generate"] is False
    assert "Render" in payload["message"]


def test_admin_series_generate_cover_reports_missing_backend_env(client, monkeypatch):
    from app.routers import admin as admin_mod

    token = _login(client)
    created = client.post(
        "/api/admin/series",
        json={
            "slug": "ai-topic-observer",
            "title": "AI 主题观察",
            "description": "跟踪重要 AI 主线的系列。",
            "content_types": ["daily_brief"],
        },
        headers=_auth(token),
    )
    assert created.status_code == 200
    series_id = created.json()["id"]

    monkeypatch.setattr(admin_mod, "clean_env", lambda key: "")

    response = client.post(
        f"/api/admin/series/{series_id}/generate-cover",
        json={},
        headers=_auth(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["generated"] is False
    assert payload["error_code"] == "missing_backend_env"
    assert "Render" in payload["error"]


def test_admin_topic_profile_generate_cover_with_grok(client, monkeypatch):
    from app.routers import admin as admin_mod

    token = _login(client)
    created = client.post(
        "/api/admin/topic-profiles",
        json={
            "topic_key": "agent-memory",
            "display_title": "智能体记忆",
            "description": "聚焦智能体长期记忆、上下文管理和状态持久化。",
        },
        headers=_auth(token),
    )
    assert created.status_code == 200
    profile_id = created.json()["id"]

    client.post(
        "/api/admin/posts",
        json={
            "title": "智能体记忆正在从上下文窗口走向产品能力",
            "slug": "agent-memory-post",
            "summary": "讨论记忆层、检索层与工具调用如何配合。",
            "content_md": "content",
            "content_type": "daily_brief",
            "topic_key": "agent-memory",
            "is_published": True,
        },
        headers=_auth(token),
    )

    captured = {}

    def fake_generate_cover_asset(prompt, filename_hint):
        captured["prompt"] = prompt
        captured["filename_hint"] = filename_hint
        return "https://img.example.com/topic-auto.png"

    monkeypatch.setattr(admin_mod, "_generate_cover_asset", fake_generate_cover_asset)

    response = client.post(
        f"/api/admin/topic-profiles/{profile_id}/generate-cover",
        json={},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["generated"] is True
    assert response.json()["cover_image"] == "https://img.example.com/topic-auto.png"
    assert "智能体记忆" in captured["prompt"]
    assert captured["filename_hint"] == "topic-agent-memory.png"


def test_admin_series_generate_cover_with_grok(client, monkeypatch):
    from app.routers import admin as admin_mod

    token = _login(client)
    create_series = client.post(
        "/api/admin/series",
        json={
            "slug": "ai-agent-ops",
            "title": "智能体运营",
            "description": "覆盖智能体生产化、监控和运营方法。",
            "content_types": ["daily_brief", "weekly_review"],
        },
        headers=_auth(token),
    )
    assert create_series.status_code == 200
    series_id = create_series.json()["id"]

    client.post(
        "/api/admin/posts",
        json={
            "title": "智能体运营开始进入指标和流程双优化阶段",
            "slug": "ai-agent-ops-post",
            "summary": "观察智能体监控、回溯与评估体系。",
            "content_md": "content",
            "content_type": "weekly_review",
            "series_slug": "ai-agent-ops",
            "is_published": True,
        },
        headers=_auth(token),
    )

    captured = {}

    def fake_generate_cover_asset(prompt, filename_hint):
        captured["prompt"] = prompt
        captured["filename_hint"] = filename_hint
        return "https://img.example.com/series-auto.png"

    monkeypatch.setattr(admin_mod, "_generate_cover_asset", fake_generate_cover_asset)

    response = client.post(
        f"/api/admin/series/{series_id}/generate-cover",
        json={},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["generated"] is True
    assert response.json()["cover_image"] == "https://img.example.com/series-auto.png"
    assert "智能体运营" in captured["prompt"]
    assert captured["filename_hint"] == "series-ai-agent-ops.png"


def test_delete_post(client):
    token = _login(client)
    create = client.post("/api/admin/posts", json={
        "title": "To Delete",
        "slug": "to-delete",
        "summary": "s",
        "content_md": "c",
    }, headers=_auth(token))
    post_id = create.json()["id"]

    resp = client.delete(f"/api/admin/posts/{post_id}", headers=_auth(token))
    assert resp.status_code == 200

    resp = client.delete(f"/api/admin/posts/{post_id}", headers=_auth(token))
    assert resp.status_code == 404


def test_upload_requires_auth(client):
    resp = client.post(
        "/api/admin/upload",
        files={"file": ("demo.png", b"png-bytes", "image/png")},
    )
    assert resp.status_code in (401, 403)


def test_upload_image_success(client, upload_dir):
    token = _login(client)
    resp = client.post(
        "/api/admin/upload",
        files={"file": ("demo.png", b"png-bytes", "image/png")},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["url"].startswith("/uploads/")
    saved_name = data["url"].split("/")[-1]
    assert saved_name != "demo.png"
    assert (upload_dir / saved_name).exists()
    fetch_resp = client.get(data["url"])
    assert fetch_resp.status_code == 200
    assert fetch_resp.content == b"png-bytes"


def test_upload_image_success_with_r2(client, monkeypatch):
    token = _login(client)

    class FakeBody:
        def read(self):
            return b"image-bytes"

    class FakeR2Client:
        def put_object(self, **kwargs):
            return None

        def list_objects_v2(self, **kwargs):
            return {"Contents": [{"Key": "stored.png", "Size": 11}], "IsTruncated": False}

        def head_object(self, **kwargs):
            return {}

        def get_object(self, **kwargs):
            return {"Body": FakeBody(), "ContentType": "image/png"}

        def delete_object(self, **kwargs):
            return None

    monkeypatch.setenv("R2_ACCOUNT_ID", "test-account")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET_NAME", "blog-images")
    monkeypatch.setenv("R2_PUBLIC_BASE_URL", "https://img.example.com")

    from app import storage as storage_mod

    monkeypatch.setattr(storage_mod, "build_r2_client", lambda: FakeR2Client())

    resp = client.post(
        "/api/admin/upload",
        files={"file": ("demo.png", b"png-bytes", "image/png")},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["url"].startswith("https://img.example.com/")

    list_resp = client.get("/api/admin/images", headers=_auth(token))
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["url"].startswith("https://img.example.com/")


def test_upload_rejects_non_image(client):
    token = _login(client)
    resp = client.post(
        "/api/admin/upload",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers=_auth(token),
    )
    assert resp.status_code == 400


def test_subscription_health_reports_missing_envs(client, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_FROM", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("WEB_PUSH_VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("WEB_PUSH_SUBJECT", raising=False)
    monkeypatch.delenv("WECOM_WEBHOOK_URLS", raising=False)

    token = _login(client)
    resp = client.get("/api/admin/subscription-health", headers=_auth(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"]["configured"] is False
    assert "RESEND_API_KEY" in data["email"]["missing_env"]
    assert data["web_push"]["configured"] is False
    assert "WEB_PUSH_VAPID_PUBLIC_KEY" in data["web_push"]["missing_env"]
    assert data["web_push"]["has_public_key"] is False
    assert data["wecom"]["configured"] is False
    assert "WECOM_WEBHOOK_URLS" in data["wecom"]["missing_env"]


def test_subscription_health_reports_ready_channels(client, monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "resend_test")
    monkeypatch.setenv("EMAIL_FROM", "AI 资讯观察 <noreply@example.com>")
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "public-key")
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-key")
    monkeypatch.setenv("WEB_PUSH_SUBJECT", "mailto:owner@example.com")
    monkeypatch.setenv("WECOM_WEBHOOK_URLS", "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test")

    token = _login(client)
    resp = client.get("/api/admin/subscription-health", headers=_auth(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["email"]["configured"] is True
    assert data["email"]["missing_env"] == []
    assert data["web_push"]["configured"] is True
    assert data["web_push"]["has_public_key"] is True
    assert data["wecom"]["configured"] is True
