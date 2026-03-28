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
