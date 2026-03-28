def test_list_posts_returns_items(client, seeded_db):
    resp = client.get("/api/posts")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) >= 1
    assert {"title", "slug", "summary", "tags"}.issubset(body["items"][0].keys())


def test_list_posts_filter_by_tag(client, seeded_db):
    resp = client.get("/api/posts", params={"tag": "react"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) >= 1
    assert all(any(t["slug"] == "react" for t in p["tags"]) for p in body["items"])


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
