def test_get_post_detail_by_slug(client, seeded_db):
    resp = client.get("/api/posts/hello-react")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "hello-react"
    assert "content_md" in body


def test_get_post_detail_not_found(client, seeded_db):
    resp = client.get("/api/posts/not-exist")
    assert resp.status_code == 404
