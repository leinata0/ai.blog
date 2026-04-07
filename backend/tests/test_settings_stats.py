def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def test_get_settings(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["author_name"] == "极客新生"
    assert "announcement" in data


def test_update_settings(client):
    token = _login(client)
    resp = client.put("/api/settings", json={"author_name": "新名字"}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["author_name"] == "新名字"
    # verify persistence
    resp2 = client.get("/api/settings")
    assert resp2.json()["author_name"] == "新名字"


def test_update_settings_requires_auth(client):
    resp = client.put("/api/settings", json={"author_name": "Hacker"})
    assert resp.status_code in (401, 403)


def test_get_stats(client, seeded_db):
    resp = client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["post_count"] == 4
    assert data["tag_count"] == 8
    assert "category_count" not in data
