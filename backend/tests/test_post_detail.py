def test_get_post_detail_by_slug(client, seeded_db):
    resp = client.get("/api/posts/python-automation-selenium-pandas")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "python-automation-selenium-pandas"
    assert "content_md" in body
    assert "series_slug" in body
    assert "source_count" in body
    assert "series" in body
    assert "sources" in body
    assert "source_summary" in body
    assert "same_series_posts" in body
    assert "same_topic_posts" in body
    assert "same_week_posts" in body
    assert isinstance(body["sources"], list)
    assert isinstance(body["same_series_posts"], list)
    assert isinstance(body["same_topic_posts"], list)
    assert isinstance(body["same_week_posts"], list)


def test_get_post_detail_not_found(client, seeded_db):
    resp = client.get("/api/posts/not-exist")
    assert resp.status_code == 404
