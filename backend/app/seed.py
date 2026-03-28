from app.models import Post, Tag


def seed_data(db_session):
    tag_react = Tag(name="React", slug="react")
    tag_fastapi = Tag(name="FastAPI", slug="fastapi")
    tag_ai = Tag(name="AI", slug="ai")

    post1 = Post(
        title="Hello React",
        slug="hello-react",
        summary="A post about React",
        content_md="# Hello React\n\nThis is a post about React.",
    )
    post1.tags.append(tag_react)

    post2 = Post(
        title="FastAPI Guide",
        slug="fastapi-guide",
        summary="A guide to FastAPI",
        content_md="# FastAPI Guide\n\nLearn FastAPI.",
    )
    post2.tags.append(tag_fastapi)

    post3 = Post(
        title="AI and React",
        slug="ai-and-react",
        summary="Using AI with React",
        content_md="# AI and React\n\nCombining AI with React.",
    )
    post3.tags.extend([tag_ai, tag_react])

    db_session.add_all([post1, post2, post3])
    db_session.commit()
