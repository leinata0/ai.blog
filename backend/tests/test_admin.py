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
        "tags": ["python", "test"],
    }, headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Post"
    assert data["slug"] == "test-post"
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
    }, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated"
    assert resp.json()["slug"] == "original"


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
