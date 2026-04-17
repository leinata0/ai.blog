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
    calls = {"create_all": 0, "schema_compat": 0, "seed": 0, "uploads": 0}

    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: False)
    monkeypatch.setattr(bootstrap, "ensure_local_upload_dir", lambda: calls.__setitem__("uploads", calls["uploads"] + 1))
    monkeypatch.setattr(bootstrap.db_mod.Base.metadata, "create_all", lambda bind=None: calls.__setitem__("create_all", calls["create_all"] + 1))
    monkeypatch.setattr(bootstrap, "ensure_schema_compat", lambda bind=None: calls.__setitem__("schema_compat", calls["schema_compat"] + 1))
    monkeypatch.setattr(bootstrap, "seed_data", lambda db: calls.__setitem__("seed", calls["seed"] + 1))
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", lambda: _FakeSession(post_count=3, settings_count=1))

    bootstrap.initialize_runtime(sync_schema=False, seed_on_empty=False)

    assert calls["uploads"] == 1
    assert calls["create_all"] == 0
    assert calls["schema_compat"] == 0
    assert calls["seed"] == 0


def test_initialize_runtime_raises_helpful_error_without_schema_sync(monkeypatch):
    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: True)
    monkeypatch.setattr(bootstrap.db_mod.Base.metadata, "create_all", lambda bind=None: None)
    monkeypatch.setattr(bootstrap, "ensure_schema_compat", lambda bind=None: None)
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", lambda: _FakeSession(raise_error=True))

    try:
        bootstrap.initialize_runtime(sync_schema=False, seed_on_empty=False)
    except RuntimeError as exc:
        assert "python -m app.bootstrap" in str(exc)
    else:
        raise AssertionError("Expected initialize_runtime to raise a helpful RuntimeError")
