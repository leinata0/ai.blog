import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.schema_compat import (
    ADMIN_IMAGE_GENERATION_JOB_COLUMNS,
    DEFAULT_SERIES_SEED,
    POST_QUALITY_REVIEW_COLUMNS,
    POST_QUALITY_SNAPSHOT_COLUMNS,
    POST_SOURCE_COLUMNS,
    PUBLISHING_RUN_COLUMNS,
    SEARCH_INSIGHT_COLUMNS,
    SERIES_COLUMNS,
    TOPIC_PROFILE_COLUMNS,
    USER_COLUMNS,
    _create_table_if_missing,
    ensure_runtime_required_schema,
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
    assert columns == {"id", "email", "password_hash", "token_version", "password_set"}
    assert "auth_challenges" in inspect(engine).get_table_names()
    challenge_columns = {column["name"] for column in inspect(engine).get_columns("auth_challenges")}
    assert {"id", "email", "purpose", "code_digest", "expires_at", "attempts", "consumed_at"} <= challenge_columns


class _ExistingTableInspector:
    def __init__(self, table_name):
        self.table_name = table_name

    def get_table_names(self):
        return [self.table_name]


class _RecordingConnection:
    def __init__(self, statements):
        self.statements = statements

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, statement):
        self.statements.append(str(statement))


class _PostgresEngine:
    class _Dialect:
        name = "postgresql"

    dialect = _Dialect()

    def __init__(self):
        self.statements = []

    def begin(self):
        return _RecordingConnection(self.statements)


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
    monkeypatch.setattr(schema_compat, "inspect", lambda _engine: _ExistingTableInspector(table_name))

    _create_table_if_missing(engine, table_name, columns)

    sql = "\n".join(engine.statements)
    assert f"CREATE SEQUENCE IF NOT EXISTS {table_name}_id_seq" in sql
    assert f"ALTER SEQUENCE {table_name}_id_seq OWNED BY {table_name}.id" in sql
    assert f"ALTER COLUMN id SET DEFAULT nextval('{table_name}_id_seq'::regclass)" in sql
