import sys
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import app
from app.db import Base
from app.models import Post, Tag


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def seeded_db(db_session, monkeypatch):
    """Seed test data and patch app to use in-memory DB."""
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

    def _get_test_db():
        yield db_session

    from app.routers import posts as posts_router_mod
    monkeypatch.setattr(posts_router_mod, "get_db", _get_test_db)

    return db_session


@pytest.fixture
def client(seeded_db):
    return TestClient(app)
