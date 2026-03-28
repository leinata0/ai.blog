def test_get_post_detail_by_slug(client, seeded_db):
    resp = client.get("/api/posts/python-automation-selenium-pandas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "python-automation-selenium-pandas"
    assert body["title"] == "Python 自动化实战：Selenium 与 Pandas 结合"
    assert "content_md" in body


def test_get_post_detail_not_found(client, seeded_db):
    resp = client.get("/api/posts/not-exist")
    assert resp.status_code == 404
