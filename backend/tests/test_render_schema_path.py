"""What a Render startup actually applies to an existing database.

Render runs with `ENABLE_STARTUP_SCHEMA_SYNC=0` (render.yaml), so
`bootstrap.initialize_runtime()` takes the `ensure_runtime_required_schema()`
branch and never calls `ensure_schema_compat()`. Every other schema test in this
suite asserts against `ensure_schema_compat()` directly — which proves the
function is correct and proves nothing about production, where it does not run.
That gap is how three anti-abuse indexes and two visitor-account columns could be
"added" and still be absent from the deployed database.

These tests drive the production decision (`should_enable_startup_schema_sync()`
returning False) against a hand-built degraded database, because conftest's
autouse `_reset_tables` calls `create_all()` before every test and a table that is
born complete cannot demonstrate a backfill. Same reasoning as `_legacy_engine()`
in test_schema_compat.py.
"""

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import bootstrap
from app.schema_compat import (
    COMMENT_COLUMNS,
    LEGACY_CORE_TABLES,
    POST_COLUMNS,
    POST_LIKE_COLUMNS,
    ensure_legacy_core_tables,
    ensure_runtime_required_schema,
    ensure_schema_compat,
)

# Indexes that only ever exist because some code path issued an explicit
# CREATE INDEX: they were added to the models after their tables shipped, so
# create_all(checkfirst=True) skips them on every deployed database.
RENDER_REQUIRED_INDEXES = {
    "post_tags": {"ix_post_tags_tag_id"},
    "comments": {"ix_comments_ip_created_at", "ix_comments_user_id"},
    "post_likes": {"ix_post_likes_post_user"},
    "view_logs": {"ix_view_logs_post_ip_created_at"},
    "posts": {
        "ix_posts_public_published_created_at",
        "ix_posts_public_published_content_type_created_at",
        "ix_posts_public_published_topic_key_created_at",
        "ix_posts_public_published_series_slug_created_at",
    },
}


def _degraded_production_engine():
    """A database that looks like production before the visitor-account release.

    The core tables exist (create_all made them, long ago) but predate the columns
    and indexes the current models declare. `create_all(checkfirst=True)` will not
    touch them again, so only an explicit ALTER can repair them.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE posts (id INTEGER PRIMARY KEY, title VARCHAR(200) NOT NULL, "
            "slug VARCHAR(200) NOT NULL UNIQUE, summary VARCHAR(300) NOT NULL DEFAULT '', "
            "content_md TEXT NOT NULL DEFAULT '', created_at DATETIME)"
        ))
        conn.execute(text(
            "INSERT INTO posts (id, title, slug, summary, content_md) "
            "VALUES (1, 'legacy', 'legacy-post', 'legacy summary', '# legacy')"
        ))
        conn.execute(text("CREATE TABLE site_settings (id INTEGER PRIMARY KEY, author_name VARCHAR(100))"))
        conn.execute(text("INSERT INTO site_settings (id, author_name) VALUES (1, 'legacy')"))
        conn.execute(text("CREATE TABLE tags (id INTEGER PRIMARY KEY, name VARCHAR(80), slug VARCHAR(80))"))
        conn.execute(text("CREATE TABLE post_tags (post_id INTEGER, tag_id INTEGER)"))
        # No user_id: comments and post_likes are pre-visitor-account tables.
        conn.execute(text(
            "CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, "
            "nickname VARCHAR(50), content TEXT, ip_address VARCHAR(50), "
            "is_approved BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME)"
        ))
        conn.execute(text(
            "INSERT INTO comments (id, post_id, nickname, content, ip_address) "
            "VALUES (1, 1, 'legacy reader', 'legacy comment', '203.0.113.7')"
        ))
        conn.execute(text(
            "CREATE TABLE post_likes (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, "
            "ip_address VARCHAR, created_at DATETIME)"
        ))
        conn.execute(text(
            "CREATE TABLE view_logs (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, "
            "ip_address VARCHAR, created_at DATETIME)"
        ))
    return engine


def _index_names(engine, table_name):
    return {index["name"] for index in inspect(engine).get_indexes(table_name)}


def _column_names(engine, table_name):
    return {column["name"] for column in inspect(engine).get_columns(table_name)}


@pytest.fixture
def render_runtime(monkeypatch):
    """Point bootstrap at a degraded database with Render's schema flags."""
    engine = _degraded_production_engine()
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # Exactly what render.yaml sets. Setting RENDER instead would also flip
    # env.is_production_env(), which demands a production secret set that this
    # suite deliberately does not have; the flag is the same decision either way
    # and test_bootstrap.py covers the RENDER-detection half.
    monkeypatch.setenv("ENABLE_STARTUP_SCHEMA_SYNC", "0")
    monkeypatch.setattr(bootstrap.db_mod, "engine", engine)
    monkeypatch.setattr(bootstrap.db_mod, "SessionLocal", session_factory)
    monkeypatch.setattr(bootstrap, "is_r2_enabled", lambda: True)
    monkeypatch.setattr(
        bootstrap.db_mod.Base.metadata,
        "create_all",
        lambda bind=None: pytest.fail("Render must not run create_all at startup"),
    )
    return engine


def test_render_startup_takes_the_no_sync_branch(render_runtime):
    """The premise of every assertion below."""
    assert bootstrap.should_enable_startup_schema_sync() is False


def test_render_startup_backfills_visitor_account_columns_on_legacy_tables(render_runtime):
    """comments.user_id and post_likes.user_id shipped with the visitor-account
    batch, onto tables that already existed. Without a backfill on this path every
    comment and like query on Render answers 500 with "no such column"."""
    engine = render_runtime
    assert "user_id" not in _column_names(engine, "comments")
    assert "user_id" not in _column_names(engine, "post_likes")

    bootstrap.initialize_runtime(seed_on_empty=False)

    assert _column_names(engine, "comments") == set(COMMENT_COLUMNS)
    assert _column_names(engine, "post_likes") == set(POST_LIKE_COLUMNS)
    # The pre-existing row survives and reads back through the new column.
    with engine.connect() as conn:
        assert conn.execute(text("SELECT user_id FROM comments WHERE id = 1")).scalar_one() is None


def test_render_startup_creates_the_anti_abuse_indexes(render_runtime):
    """These are the three indexes the previous round claimed to add. They lived
    only in ensure_schema_compat(), which Render never calls."""
    engine = render_runtime
    for table_name in RENDER_REQUIRED_INDEXES:
        assert _index_names(engine, table_name) == set(), table_name

    bootstrap.initialize_runtime(seed_on_empty=False)

    for table_name, expected in RENDER_REQUIRED_INDEXES.items():
        assert expected <= _index_names(engine, table_name), table_name


def test_render_startup_backfills_the_posts_table(render_runtime):
    """The ORM SELECTs every mapped column; a legacy posts table missing
    quality_score/reading_time/topic_key breaks every public read. It is also a
    precondition for the composite indexes above — an index on (is_published,
    content_type, created_at) cannot be built before content_type exists."""
    engine = render_runtime
    bootstrap.initialize_runtime(seed_on_empty=False)

    assert set(POST_COLUMNS) <= _column_names(engine, "posts")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT content_type FROM posts WHERE id = 1")).scalar_one() == "post"


def test_render_startup_is_idempotent(render_runtime):
    """Every restart re-runs this. The second pass must be a no-op, not an error."""
    engine = render_runtime
    bootstrap.initialize_runtime(seed_on_empty=False)
    bootstrap.initialize_runtime(seed_on_empty=False)

    for table_name, expected in RENDER_REQUIRED_INDEXES.items():
        assert expected <= _index_names(engine, table_name), table_name
    assert _column_names(engine, "comments") == set(COMMENT_COLUMNS)


def test_healed_database_costs_no_ddl_on_the_next_startup():
    """The startup-cost gate for the backfill this file exists to add.

    `ensure_runtime_required_schema` runs on *every* boot and Render cold starts
    are already the slow path here. Steady state must be catalog reads only: no
    ALTER, no CREATE INDEX, and therefore no lock taken on posts or comments while
    the content pipeline may be writing to them.
    """
    engine = _degraded_production_engine()
    ensure_legacy_core_tables(engine)

    executed = []
    def _record(_conn, _cursor, statement, _params, _context, _many):
        executed.append(" ".join(str(statement or "").split()))

    event.listen(engine, "before_cursor_execute", _record)
    try:
        ensure_legacy_core_tables(engine)
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    ddl = [sql for sql in executed if sql.upper().startswith(("ALTER", "CREATE", "DROP"))]
    assert ddl == [], f"a healed database still issues DDL on every startup: {ddl}"
    # One probe per legacy table plus a single index-name lookup for all of them.
    assert len(executed) <= 2 * len(LEGACY_CORE_TABLES) + 2, executed


def test_no_sync_path_and_full_sync_path_agree_on_the_legacy_core_tables():
    """The drift gate.

    The bug this file was written for was not a wrong migration, it was two schema
    paths describing different schemas — the tested one and the deployed one. Both
    now walk LEGACY_CORE_TABLES, and this fails the moment they stop agreeing.
    """
    full_sync_engine = _degraded_production_engine()
    render_engine = _degraded_production_engine()

    ensure_schema_compat(full_sync_engine)
    ensure_runtime_required_schema(render_engine)

    for table_name, _columns, _indexes in LEGACY_CORE_TABLES:
        assert _column_names(render_engine, table_name) == _column_names(
            full_sync_engine, table_name
        ), f"{table_name}: columns differ between the production and full-sync paths"
        assert _index_names(render_engine, table_name) == _index_names(
            full_sync_engine, table_name
        ), f"{table_name}: indexes differ between the production and full-sync paths"
