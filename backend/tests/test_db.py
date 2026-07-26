import pytest
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from app.db import create_db_engine


def test_sqlite_connections_enable_foreign_keys_and_cascade_delete(tmp_path):
    engine = create_db_engine(f"sqlite:///{tmp_path / 'foreign-keys.db'}")

    with engine.begin() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        connection.execute(text("CREATE TABLE parents (id INTEGER PRIMARY KEY)"))
        connection.execute(
            text(
                "CREATE TABLE children ("
                "id INTEGER PRIMARY KEY, "
                "parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE"
                ")"
            )
        )
        connection.execute(text("INSERT INTO parents (id) VALUES (1)"))
        connection.execute(text("INSERT INTO children (id, parent_id) VALUES (1, 1)"))

    engine.dispose()

    with engine.begin() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        connection.execute(text("DELETE FROM parents WHERE id = 1"))
        assert connection.execute(text("SELECT COUNT(*) FROM children")).scalar_one() == 0

    engine.dispose()


def test_invalid_timing_threshold_falls_back_instead_of_raising(monkeypatch):
    """The threshold is resolved at import time; letting float() raise there makes
    the whole process unstartable instead of just disabling slow-query logging."""
    import app.db as db_mod

    monkeypatch.setenv("DB_TIMING_LOG_MIN_MS", "not-a-number")
    assert db_mod._timing_threshold_ms() == 30.0

    monkeypatch.setenv("DB_TIMING_LOG_MIN_MS", "")
    assert db_mod._timing_threshold_ms() == 30.0

    monkeypatch.setenv("DB_TIMING_LOG_MIN_MS", "250")
    assert db_mod._timing_threshold_ms() == 250.0


def test_invalid_pool_settings_fall_back_to_defaults(monkeypatch):
    import app.db as db_mod

    monkeypatch.setenv("DB_POOL_SIZE", "oops")
    assert db_mod._pool_int("DB_POOL_SIZE", 5) == 5

    monkeypatch.setenv("DB_POOL_SIZE", "12")
    assert db_mod._pool_int("DB_POOL_SIZE", 5) == 12

    monkeypatch.delenv("DB_POOL_SIZE", raising=False)
    assert db_mod._pool_int("DB_POOL_SIZE", 5) == 5


def test_failed_statements_do_not_leak_query_timing_entries(tmp_path):
    """after_cursor_execute never runs for a failing statement, so without the
    handle_error listener the pushed timestamp stays on the pooled connection
    forever and the list grows without bound."""
    import app.db as db_mod

    engine = create_db_engine(f"sqlite:///{tmp_path / 'timing.db'}")
    db_mod.register_query_timing_listeners(engine)

    with engine.connect() as connection:
        for _ in range(5):
            with pytest.raises(DatabaseError):
                connection.execute(text("SELECT * FROM table_that_does_not_exist"))
            connection.rollback()
        assert not connection.info.get("query_start_time")

    engine.dispose()


def test_non_sqlite_engines_recycle_connections_for_neon(monkeypatch):
    """Neon drops idle server connections; pool_pre_ping alone still hands out a
    socket that has been closed on the other end since the last checkout."""
    captured = {}

    def _fake_create_engine(url, **kwargs):
        captured.update(kwargs)
        captured["url"] = url
        return object()

    monkeypatch.setattr("app.db.create_engine", _fake_create_engine)
    create_db_engine("postgresql+psycopg://user:pw@example.test/db")

    assert captured["pool_pre_ping"] is True
    assert captured["pool_recycle"] == 300
    # Small resident floor (what keeps a Neon compute endpoint awake and costs money at
    # idle) + elastic burst (closed on return, free between spikes). The ceiling is what
    # 138 sync `def` handlers on anyio's 40-thread limiter contend for, so the headroom
    # belongs in overflow, not in pool_size. See the rationale in app/db.py.
    assert captured["pool_size"] == 5
    assert captured["max_overflow"] == 10
    assert captured["pool_timeout"] == 30
