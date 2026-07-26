def test_list_posts_returns_items(client, seeded_db):
    resp = client.get("/api/posts")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) >= 1
    assert {"title", "slug", "summary", "tags"}.issubset(body["items"][0].keys())
    assert {"series_slug", "source_count", "quality_score", "reading_time"}.issubset(body["items"][0].keys())
    assert "content_md" not in body["items"][0]


def test_list_posts_filter_by_tag(client, seeded_db):
    resp = client.get("/api/posts", params={"tag": "python"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) >= 1
    assert all(any(t["slug"] == "python" for t in p["tags"]) for p in body["items"])


def test_post_tag_relationship(db_session):
    from app.models import Post, Tag

    tag = Tag(name="fastapi", slug="fastapi")
    post = Post(title="Hello", slug="hello", summary="s", content_md="c")
    post.tags.append(tag)

    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)

    assert len(post.tags) == 1
    assert post.tags[0].slug == "fastapi"


def test_list_posts_treats_like_wildcards_as_literals(client, seeded_db):
    """`q=%` must search for a literal percent sign, not match every row."""
    baseline = client.get("/api/posts").json()["total"]
    assert baseline >= 1

    wildcard = client.get("/api/posts", params={"q": "%"}).json()
    assert wildcard["total"] == 0
    assert wildcard["items"] == []

    underscore = client.get("/api/posts", params={"q": "_"}).json()
    assert underscore["total"] == 0


def test_search_returns_zero_result_rescue_metadata(client, seeded_db):
    client.get("/api/search", params={"q": "agent runtime"})
    client.get("/api/search", params={"q": "model launches"})

    resp = client.get("/api/search", params={"q": "totally missing signal"})
    assert resp.status_code == 200

    payload = resp.json()
    assert "series_suggestions" in payload
    assert "popular_queries" in payload
    assert isinstance(payload["series_suggestions"], list)
    assert isinstance(payload["popular_queries"], list)
