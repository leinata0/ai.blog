import sys
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db import Base
from app.models import Post, Tag, SiteSettings


# Create a shared test engine/session factory used by all fixtures
_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


@pytest.fixture(autouse=True)
def _patch_runtime_env(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_SECRET_KEY", "test-dev-secret-key")
    monkeypatch.setenv("DEV_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("DEV_ADMIN_PASSWORD", "admin123")
    monkeypatch.setenv("PUBLIC_SITE_URL", "https://example.test")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RENDER_SERVICE_ID", raising=False)


@pytest.fixture(autouse=True)
def _reset_tables():
    """Create fresh tables before each test, drop after."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture(autouse=True)
def _patch_db(monkeypatch):
    """Redirect the app's engine and SessionLocal to the in-memory test DB
    so that the lifespan (create_all, seed) also uses the test database."""
    import app.db as db_mod
    monkeypatch.setattr(db_mod, "engine", _test_engine)
    monkeypatch.setattr(db_mod, "SessionLocal", _TestingSessionLocal)


@pytest.fixture
def db_session():
    session = _TestingSessionLocal()
    yield session
    session.close()


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    from app import uploads as uploads_mod

    test_upload_dir = tmp_path / "uploads"
    test_upload_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(uploads_mod, "UPLOADS_DIR", test_upload_dir)
    return test_upload_dir


@pytest.fixture
def seeded_db(db_session):
    """Marker fixture — the lifespan already seeds data when Post table is empty.
    This fixture just ensures the client fixture has run (which triggers lifespan seed).
    For tests that need seeded data, depend on both `client` and `seeded_db`."""
    return db_session


@pytest.fixture
def client(db_session, upload_dir):
    from app.main import app
    from app.routers import posts as posts_router_mod
    from app.routers import admin as admin_router_mod
    import app.main as main_mod

    def _get_test_db():
        yield db_session

    # Seed default SiteSettings for tests
    if db_session.query(SiteSettings).count() == 0:
        db_session.add(SiteSettings(id=1))
        db_session.commit()

    app.dependency_overrides[posts_router_mod.get_db] = _get_test_db
    app.dependency_overrides[admin_router_mod.get_db] = _get_test_db
    app.dependency_overrides[main_mod.get_db] = _get_test_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
