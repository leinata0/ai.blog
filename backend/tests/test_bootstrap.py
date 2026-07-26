import pytest
from sqlalchemy.exc import OperationalError

from app import bootstrap


class _FakeQuery:
    def __init__(self, count_value: int):
        self._count_value = count_value

    def count(self):
        return self._count_value


class _FakeSession:
    def __init__(self, *, post_count: int = 1, settings_count: int = 1, raise_error: bool = False):
        self.post_count = post_count
        self.settings_count = settings_count
        self.raise_error = raise_error
        self.added = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def query(self, model):
        if self.raise_error:
            raise OperationalError("select 1", {}, RuntimeError("missing table"))
        if model is bootstrap.Post:
            return _FakeQuery(self.post_count)
        if model is bootstrap.SiteSettings:
            return _FakeQuery(self.settings_count)
        return _FakeQuery(0)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.committed = True


def test_should_enable_startup_schema_sync_defaults(monkeypatch):
    monkeypatch.delenv("ENABLE_STARTUP_SCHEMA_SYNC", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RENDER_SERVICE_ID", raising=False)
    assert bootstrap.should_enable_startup_schema_sync() is True

    monkeypatch.setenv("RENDER", "true")
    assert bootstrap.should_enable_startup_schema_sync() is False

    monkeypatch.setenv("ENABLE_STARTUP_SCHEMA_SYNC", "1")
    assert bootstrap.should_enable_startup_schema_sync() is True


def test_initialize_runtime_skips_schema_sync_when_disabled(monkeypatch):
    calls = {"create_all": 0, "schema_compat": 0, "runtime_schema": 0, "seed": 0, "uploads": 0}

    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: False)
    monkeypatch.setattr(bootstrap, "ensure_local_upload_dir", lambda: calls.__setitem__("uploads", calls["uploads"] + 1))
    monkeypatch.setattr(bootstrap.db_mod.Base.metadata, "create_all", lambda bind=None: calls.__setitem__("create_all", calls["create_all"] + 1))
    monkeypatch.setattr(bootstrap, "ensure_schema_compat", lambda bind=None: calls.__setitem__("schema_compat", calls["schema_compat"] + 1))
    monkeypatch.setattr(bootstrap, "ensure_runtime_required_schema", lambda bind=None: calls.__setitem__("runtime_schema", calls["runtime_schema"] + 1))
    monkeypatch.setattr(bootstrap, "seed_data", lambda db: calls.__setitem__("seed", calls["seed"] + 1))
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", lambda: _FakeSession(post_count=3, settings_count=1))

    bootstrap.initialize_runtime(sync_schema=False, seed_on_empty=False)

    assert calls["uploads"] == 1
    assert calls["create_all"] == 0
    assert calls["schema_compat"] == 0
    assert calls["runtime_schema"] == 1
    assert calls["seed"] == 0


def test_initialize_runtime_raises_helpful_error_without_schema_sync(monkeypatch):
    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: True)
    monkeypatch.setattr(bootstrap.db_mod.Base.metadata, "create_all", lambda bind=None: None)
    monkeypatch.setattr(bootstrap, "ensure_schema_compat", lambda bind=None: None)
    monkeypatch.setattr(bootstrap, "ensure_runtime_required_schema", lambda bind=None: None)
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", lambda: _FakeSession(raise_error=True))

    try:
        bootstrap.initialize_runtime(sync_schema=False, seed_on_empty=False)
    except RuntimeError as exc:
        assert "python -m app.bootstrap" in str(exc)
    else:
        raise AssertionError("Expected initialize_runtime to raise a helpful RuntimeError")


def test_module_entrypoint_never_seeds_unless_asked(monkeypatch):
    """README tells operators to run `python -m app.bootstrap` from any shell they
    have. If that shell points DATABASE_URL at production, inheriting the
    AUTO_SEED_ON_EMPTY default (True) would write demo posts into it."""
    monkeypatch.delenv("AUTO_SEED_ON_EMPTY", raising=False)
    calls = []
    monkeypatch.setattr(
        bootstrap,
        "initialize_runtime",
        lambda **kwargs: calls.append(kwargs),
    )

    bootstrap.main([])
    assert calls == [{"sync_schema": True, "seed_on_empty": False}]

    calls.clear()
    bootstrap.main(["--seed"])
    assert calls == [{"sync_schema": True, "seed_on_empty": True}]


def test_initialize_runtime_seeds_only_when_the_caller_opts_in(monkeypatch):
    monkeypatch.setenv("AUTO_SEED_ON_EMPTY", "1")
    calls = {"seed": 0}

    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: True)
    monkeypatch.setattr(bootstrap.db_mod.Base.metadata, "create_all", lambda bind=None: None)
    monkeypatch.setattr(bootstrap, "ensure_schema_compat", lambda bind=None: None)
    monkeypatch.setattr(bootstrap, "seed_data", lambda db: calls.__setitem__("seed", calls["seed"] + 1))
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", lambda: _FakeSession(post_count=0, settings_count=1))

    bootstrap.initialize_runtime(sync_schema=True, seed_on_empty=False)
    assert calls["seed"] == 0

    bootstrap.initialize_runtime(sync_schema=True, seed_on_empty=True)
    assert calls["seed"] == 1


def test_seed_data_survives_leftover_tags(db_session):
    """Seeding is gated on posts being empty, not tags. Deleting every post locally
    and restarting used to abort on the tags.slug unique constraint."""
    from app.models import Post, Tag
    from app.seed import seed_data

    db_session.add(Tag(name="Python", slug="python"))
    db_session.add(Tag(name="AI", slug="ai"))
    db_session.commit()

    seed_data(db_session)

    assert db_session.query(Post).count() == 4
    assert db_session.query(Tag).filter(Tag.slug == "python").count() == 1
    assert db_session.query(Tag).filter(Tag.slug == "ai").count() == 1
    # The pre-existing tag rows are reused rather than duplicated.
    assert db_session.query(Tag).count() == 8


def test_uploads_dir_never_resolves_to_the_filesystem_root():
    """In the container __file__ is /app/app/uploads.py, so the old parents[2] walk
    produced "/uploads" — a directory the non-root appuser cannot create, while the
    Dockerfile actually prepares /app/uploads."""
    from pathlib import Path

    from app import uploads as uploads_mod

    resolved = uploads_mod._default_uploads_dir()
    assert resolved.name == "uploads"
    assert resolved.parent != Path(resolved.parent.anchor)


def test_uploads_dir_honours_the_environment_override(monkeypatch, tmp_path):
    from app import uploads as uploads_mod

    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "custom-uploads"))
    assert uploads_mod.get_uploads_dir() == tmp_path / "custom-uploads"

    monkeypatch.delenv("UPLOADS_DIR", raising=False)
    assert uploads_mod.get_uploads_dir() == uploads_mod.UPLOADS_DIR


def test_initialize_runtime_validates_storage_before_database_work(monkeypatch):
    monkeypatch.setattr(
        bootstrap,
        "validate_storage_configuration",
        lambda: (_ for _ in ()).throw(RuntimeError("storage configuration invalid")),
    )
    monkeypatch.setattr(
        bootstrap.db_mod.Base.metadata,
        "create_all",
        lambda bind=None: pytest.fail("database work must not start"),
    )

    with pytest.raises(RuntimeError, match="storage configuration invalid"):
        bootstrap.initialize_runtime(sync_schema=True, seed_on_empty=False)
