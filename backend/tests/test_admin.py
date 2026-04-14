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
    assert len(data["tags"]) == 2
    assert data["id"] is not None


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
    }, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated"
    assert resp.json()["slug"] == "original"
    assert resp.json()["content_type"] == "weekly_review"
    assert resp.json()["published_mode"] == "manual"


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
