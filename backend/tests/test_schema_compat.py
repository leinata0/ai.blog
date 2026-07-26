import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.schema_compat import (
    ADMIN_IMAGE_GENERATION_JOB_COLUMNS,
    AI_MODEL_INSTANCE_COLUMNS,
    DEFAULT_SERIES_SEED,
    POST_COLUMNS,
    POST_METADATA_COLUMNS,
    POST_QUALITY_REVIEW_COLUMNS,
    POST_QUALITY_SNAPSHOT_COLUMNS,
    POST_SOURCE_COLUMNS,
    PUBLISHING_RUN_COLUMNS,
    READING_HISTORY_COLUMNS,
    SEARCH_INSIGHT_COLUMNS,
    SERIES_COLUMNS,
    SITE_SETTINGS_COLUMNS,
    TOPIC_PROFILE_COLUMNS,
    USER_COLUMNS,
    _add_missing_columns,
    _alter_ddl_for_dialect,
    _create_table_if_missing,
    ensure_runtime_required_schema,
    ensure_schema_compat,
)
from app.models import Post


def test_series_seed_uses_boolean_flags():
    assert DEFAULT_SERIES_SEED
    assert all(isinstance(item["is_featured"], bool) for item in DEFAULT_SERIES_SEED)
    assert any(item["title"] == "AI 日报简报" for item in DEFAULT_SERIES_SEED)
    assert any(item["title"] == "AI 周报综述" for item in DEFAULT_SERIES_SEED)


def test_boolean_defaults_are_postgres_friendly():
    assert SERIES_COLUMNS["is_featured"].endswith("DEFAULT FALSE")
    assert POST_SOURCE_COLUMNS["is_primary"].endswith("DEFAULT FALSE")


def test_quality_tables_contract_columns_exist():
    assert "post_id" in POST_QUALITY_SNAPSHOT_COLUMNS
    assert "overall_score" in POST_QUALITY_SNAPSHOT_COLUMNS
    assert "issues_json" in POST_QUALITY_SNAPSHOT_COLUMNS
    assert "strengths_json" in POST_QUALITY_SNAPSHOT_COLUMNS
    assert "post_id" in POST_QUALITY_REVIEW_COLUMNS
    assert "editor_verdict" in POST_QUALITY_REVIEW_COLUMNS
    assert "editor_labels_json" in POST_QUALITY_REVIEW_COLUMNS
    assert "followup_recommended" in POST_QUALITY_REVIEW_COLUMNS


def test_topic_search_tables_contract_columns_exist():
    assert "topic_key" in TOPIC_PROFILE_COLUMNS
    assert "cover_image" in TOPIC_PROFILE_COLUMNS
    assert "aliases_json" in TOPIC_PROFILE_COLUMNS
    assert "is_featured" in TOPIC_PROFILE_COLUMNS
    assert "sort_order" in TOPIC_PROFILE_COLUMNS
    assert "focus_points_json" in TOPIC_PROFILE_COLUMNS
    assert "content_types_json" in TOPIC_PROFILE_COLUMNS
    assert "query" in SEARCH_INSIGHT_COLUMNS
    assert "search_count" in SEARCH_INSIGHT_COLUMNS
    assert "last_searched_at" in SEARCH_INSIGHT_COLUMNS


def test_image_generation_job_schema_includes_v3_art_direction_metadata():
    assert ADMIN_IMAGE_GENERATION_JOB_COLUMNS["art_direction_json"] == "TEXT NOT NULL DEFAULT '{}'"


def test_post_model_declares_public_read_indexes():
    index_names = {index.name for index in Post.__table__.indexes}
    assert "ix_posts_public_published_created_at" in index_names
    assert "ix_posts_public_published_content_type_created_at" in index_names
    assert "ix_posts_public_published_topic_key_created_at" in index_names
    assert "ix_posts_public_published_series_slug_created_at" in index_names


def test_image_generation_stale_cleanup_creates_missing_job_table():
    from app.services import image_generation_jobs

    engine = create_engine("sqlite:///:memory:")
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        assert "admin_image_generation_jobs" not in inspect(engine).get_table_names()
        assert image_generation_jobs.mark_stale_running_failed(db) == 0
        assert "admin_image_generation_jobs" in inspect(engine).get_table_names()
    finally:
        db.close()


def test_image_generation_job_creation_backfills_v3_column_on_legacy_table():
    from sqlalchemy import text
    from app.services import image_generation_jobs

    engine = create_engine("sqlite:///:memory:")
    legacy_columns = {
        name: ddl
        for name, ddl in ADMIN_IMAGE_GENERATION_JOB_COLUMNS.items()
        if name != "art_direction_json"
    }
    column_sql = ", ".join(f"{name} {ddl}" for name, ddl in legacy_columns.items())
    with engine.begin() as connection:
        connection.execute(text(f"CREATE TABLE admin_image_generation_jobs ({column_sql})"))

    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        job = image_generation_jobs.create_job(
            db,
            job_type=image_generation_jobs.JOB_POST_COVER,
            target_id=1,
            body={"cover_brief": "legacy production table compatibility"},
        )
        columns = {column["name"] for column in inspect(engine).get_columns("admin_image_generation_jobs")}
        assert "art_direction_json" in columns
        assert job.art_direction_json == "{}"
        assert job.art_direction_version == "post-cover-v3"
    finally:
        db.close()


def test_users_security_columns_backfilled_on_existing_table():
    from sqlalchemy import text
    from app.schema_compat import ensure_schema_compat

    engine = create_engine("sqlite://")
    # Simulate a pre-bio users table (first-phase schema).
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, "
            "password_hash VARCHAR(255) NOT NULL, nickname VARCHAR(50) NOT NULL DEFAULT '', "
            "avatar_url VARCHAR(500) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'active', "
            "email_verified BOOLEAN NOT NULL DEFAULT 0, created_at DATETIME, updated_at DATETIME, "
            "last_login_at DATETIME)"
        ))
        conn.execute(text(
            "INSERT INTO users (id, email, password_hash) "
            "VALUES (1, 'legacy@example.com', 'legacy-hash')"
        ))
    ensure_schema_compat(engine)
    ensure_schema_compat(engine)  # idempotent
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert {"bio", "token_version", "password_set"} <= cols
    assert USER_COLUMNS["token_version"] == "INTEGER NOT NULL DEFAULT 0"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT token_version FROM users WHERE id = 1")).scalar_one() == 0
        assert conn.execute(text("SELECT password_set FROM users WHERE id = 1")).scalar_one() in (1, True)


def test_runtime_required_schema_backfills_auth_requirements():
    from sqlalchemy import text

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE, "
            "password_hash VARCHAR(255) NOT NULL)"
        ))

    ensure_runtime_required_schema(engine)
    ensure_runtime_required_schema(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("users")}
    assert columns == set(USER_COLUMNS)
    assert "auth_challenges" in inspect(engine).get_table_names()
    challenge_columns = {column["name"] for column in inspect(engine).get_columns("auth_challenges")}
    assert {"id", "email", "purpose", "code_digest", "expires_at", "attempts", "consumed_at"} <= challenge_columns


def test_runtime_required_schema_creates_whole_visitor_account_system():
    """Render runs with ENABLE_STARTUP_SCHEMA_SYNC=0, so this is the only self-heal
    path the user system gets. users/followed_topics/reading_history shipped in the
    same batch as auth_challenges and must all be reachable from it."""
    engine = create_engine("sqlite://")

    ensure_runtime_required_schema(engine)
    ensure_runtime_required_schema(engine)  # idempotent

    table_names = set(inspect(engine).get_table_names())
    assert {"users", "auth_challenges", "followed_topics", "reading_history"} <= table_names

    history_columns = {column["name"] for column in inspect(engine).get_columns("reading_history")}
    assert history_columns == set(READING_HISTORY_COLUMNS)


def test_runtime_required_schema_backfills_site_settings():
    """bootstrap counts site_settings on every startup and env.py reads site_url to
    build the CORS allowlist; a missing column fails the lifespan outright."""
    from sqlalchemy import text

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE site_settings (id INTEGER PRIMARY KEY, author_name VARCHAR(100))"))
        conn.execute(text("INSERT INTO site_settings (id, author_name) VALUES (1, 'legacy')"))

    ensure_runtime_required_schema(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("site_settings")}
    assert columns == set(SITE_SETTINGS_COLUMNS)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT site_url FROM site_settings WHERE id = 1")).scalar_one() == ""


def _legacy_engine():
    """A database whose core tables predate most of the model columns.

    conftest's autouse `_reset_tables` fixture calls create_all() before every test,
    which means the shim's whole reason to exist — ALTERing an *existing* table — is
    physically unreachable there. These tests build the degraded table by hand.
    """
    from sqlalchemy import text

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE posts (id INTEGER PRIMARY KEY, title VARCHAR(200) NOT NULL, "
            "slug VARCHAR(200) NOT NULL UNIQUE, summary VARCHAR(300) NOT NULL, "
            "content_md TEXT NOT NULL, created_at DATETIME)"
        ))
        conn.execute(text(
            "INSERT INTO posts (id, title, slug, summary, content_md) "
            "VALUES (1, 'legacy', 'legacy-post', 'legacy summary', '# legacy')"
        ))
        conn.execute(text("CREATE TABLE site_settings (id INTEGER PRIMARY KEY, author_name VARCHAR(100))"))
        conn.execute(text("INSERT INTO site_settings (id, author_name) VALUES (1, 'legacy')"))
        conn.execute(text("CREATE TABLE tags (id INTEGER PRIMARY KEY, name VARCHAR(80), slug VARCHAR(80))"))
        conn.execute(text("CREATE TABLE post_tags (post_id INTEGER, tag_id INTEGER)"))
        conn.execute(text(
            "CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL, "
            "nickname VARCHAR(50), content TEXT, ip_address VARCHAR(50), created_at DATETIME)"
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


def test_ensure_schema_compat_backfills_legacy_posts_table():
    from sqlalchemy import text

    engine = _legacy_engine()
    ensure_schema_compat(engine)
    ensure_schema_compat(engine)  # idempotent

    columns = {column["name"] for column in inspect(engine).get_columns("posts")}
    assert set(POST_METADATA_COLUMNS) <= columns
    assert set(POST_COLUMNS) <= columns
    with engine.connect() as conn:
        # The pre-existing row survives and reads back through the new columns.
        row = conn.execute(
            text("SELECT content_type, view_count, is_published FROM posts WHERE id = 1")
        ).one()
    assert row[0] == "post"
    assert row[1] == 0


def test_ensure_schema_compat_backfills_legacy_site_settings_table():
    from sqlalchemy import text

    engine = _legacy_engine()
    ensure_schema_compat(engine)

    columns = {column["name"] for column in inspect(engine).get_columns("site_settings")}
    assert columns == set(SITE_SETTINGS_COLUMNS)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT friend_links FROM site_settings WHERE id = 1")).scalar_one() == "[]"


def test_ensure_schema_compat_backfills_columns_for_tables_created_by_the_shim():
    """_create_table_if_missing used to be create-only: a table that already existed
    never grew the columns added to its map afterwards."""
    from sqlalchemy import text

    engine = _legacy_engine()
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE topic_profiles (id INTEGER PRIMARY KEY, topic_key VARCHAR(200) NOT NULL)"
        ))
        conn.execute(text(
            "CREATE TABLE publishing_runs (id INTEGER PRIMARY KEY, workflow_key VARCHAR(50))"
        ))
        conn.execute(text(
            "CREATE TABLE ai_model_instances (id INTEGER PRIMARY KEY, purpose VARCHAR(80) NOT NULL)"
        ))

    ensure_schema_compat(engine)

    for table_name, expected in (
        ("topic_profiles", TOPIC_PROFILE_COLUMNS),
        ("publishing_runs", PUBLISHING_RUN_COLUMNS),
        ("ai_model_instances", AI_MODEL_INSTANCE_COLUMNS),
    ):
        columns = {column["name"] for column in inspect(engine).get_columns(table_name)}
        assert columns == set(expected), table_name


def test_ensure_schema_compat_creates_anti_abuse_indexes_on_legacy_tables():
    """These composite indexes were added to the models after the tables existed, so
    create_all(checkfirst=True) never built them on a deployed database."""
    engine = _legacy_engine()
    ensure_schema_compat(engine)

    def index_names(table_name):
        return {index["name"] for index in inspect(engine).get_indexes(table_name)}

    assert "ix_view_logs_post_ip_created_at" in index_names("view_logs")
    assert "ix_comments_ip_created_at" in index_names("comments")
    assert "ix_post_likes_post_user" in index_names("post_likes")
    assert "ix_post_tags_tag_id" in index_names("post_tags")
    assert "ix_comments_user_id" in index_names("comments")


def test_alter_ddl_translates_datetime_and_drops_unaddable_constraints():
    # DATETIME is not a Postgres type: `ALTER TABLE users ADD COLUMN created_at
    # DATETIME` fails with `type "datetime" does not exist`.
    assert _alter_ddl_for_dialect("DATETIME", "postgresql") == "TIMESTAMP"
    assert _alter_ddl_for_dialect("DATETIME NOT NULL", "postgresql") == "TIMESTAMP"
    assert _alter_ddl_for_dialect("DATETIME", "sqlite") == "DATETIME"
    # UNIQUE/NOT NULL cannot be introduced by ADD COLUMN on a populated table.
    assert _alter_ddl_for_dialect("VARCHAR(255) NOT NULL UNIQUE", "sqlite") == "VARCHAR(255)"
    assert (
        _alter_ddl_for_dialect("VARCHAR(50) NOT NULL DEFAULT ''", "sqlite")
        == "VARCHAR(50) NOT NULL DEFAULT ''"
    )


class _ExistingTableInspector:
    def __init__(self, table_name, columns=("id",)):
        self.table_name = table_name
        self.columns = list(columns)

    def get_table_names(self):
        return [self.table_name]

    def get_columns(self, _table_name):
        return [{"name": name} for name in self.columns]


class _RecordingResult:
    def __init__(self, value=None):
        self.value = value

    def scalar(self):
        return self.value


class _RecordingConnection:
    def __init__(self, statements, scalar_values=None):
        self.statements = statements
        self.scalar_values = scalar_values or {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, statement, parameters=None):
        rendered = str(statement)
        self.statements.append(rendered)
        for needle, value in self.scalar_values.items():
            if needle in rendered:
                return _RecordingResult(value)
        return _RecordingResult(None)


class _PostgresEngine:
    class _Dialect:
        name = "postgresql"

    dialect = _Dialect()

    def __init__(self, scalar_values=None):
        self.statements = []
        self.scalar_values = scalar_values or {}

    def begin(self):
        return _RecordingConnection(self.statements, self.scalar_values)


@pytest.mark.parametrize(
    ("table_name", "columns"),
    [
        ("series", SERIES_COLUMNS),
        ("publishing_runs", PUBLISHING_RUN_COLUMNS),
        ("future_records", {"id": "INTEGER PRIMARY KEY"}),
    ],
)
def test_integer_id_primary_key_tables_automatically_get_postgres_sequence(
    monkeypatch, table_name, columns
):
    from app import schema_compat

    engine = _PostgresEngine()
    monkeypatch.setattr(
        schema_compat,
        "inspect",
        lambda _engine: _ExistingTableInspector(table_name, columns=list(columns)),
    )

    _create_table_if_missing(engine, table_name, columns, repair_sequence=True)

    sql = "\n".join(engine.statements)
    assert f"CREATE SEQUENCE IF NOT EXISTS {table_name}_id_seq" in sql
    assert f"ALTER SEQUENCE {table_name}_id_seq OWNED BY {table_name}.id" in sql
    assert f"ALTER COLUMN id SET DEFAULT nextval('{table_name}_id_seq'::regclass)" in sql


def test_sequence_repair_is_skipped_on_the_polling_hot_path(monkeypatch):
    """list_recent() calls ensure_admin_*_schema_compat on every admin poll. The
    sequence DDL takes an ACCESS EXCLUSIVE lock and its setval can rewind the
    sequence past an in-flight insert, so it must not run there."""
    from app import schema_compat

    engine = _PostgresEngine()
    monkeypatch.setattr(
        schema_compat,
        "inspect",
        lambda _engine: _ExistingTableInspector("series", columns=list(SERIES_COLUMNS)),
    )

    _create_table_if_missing(engine, "series", SERIES_COLUMNS)

    sql = "\n".join(engine.statements)
    assert "CREATE SEQUENCE" not in sql
    assert "SET DEFAULT nextval" not in sql
    assert "setval" not in sql


def test_sequence_repair_is_skipped_when_a_sequence_is_already_attached(monkeypatch):
    from app import schema_compat

    engine = _PostgresEngine(scalar_values={"pg_get_serial_sequence": "public.series_id_seq"})
    monkeypatch.setattr(
        schema_compat,
        "inspect",
        lambda _engine: _ExistingTableInspector("series", columns=list(SERIES_COLUMNS)),
    )

    _create_table_if_missing(engine, "series", SERIES_COLUMNS, repair_sequence=True)

    sql = "\n".join(engine.statements)
    assert "pg_get_serial_sequence" in sql
    assert "CREATE SEQUENCE" not in sql
    assert "setval" not in sql


def test_missing_column_backfill_translates_ddl_for_postgres(monkeypatch):
    from app import schema_compat

    engine = _PostgresEngine()
    monkeypatch.setattr(
        schema_compat,
        "inspect",
        lambda _engine: _ExistingTableInspector("users", columns=["id", "email", "password_hash"]),
    )

    _add_missing_columns(engine, "users", USER_COLUMNS)

    sql = "\n".join(engine.statements)
    assert "ADD COLUMN IF NOT EXISTS created_at TIMESTAMP" in sql
    assert "DATETIME" not in sql
    # The primary key is never introduced by ALTER TABLE.
    assert "ADD COLUMN IF NOT EXISTS id " not in sql
