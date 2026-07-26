import re

from sqlalchemy import inspect, text


# Columns that already existed in the very first schema revision. They are created
# by Base.metadata.create_all(), never by an ALTER, but they still belong in the
# column maps: TABLE_COLUMN_MAPS below is the contract the schema-coverage test
# enforces, and a table that is only half-described silently loses that guarantee.
POST_BASE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "title": "VARCHAR(200) NOT NULL",
    "slug": "VARCHAR(200) NOT NULL UNIQUE",
    "summary": "VARCHAR(300) NOT NULL DEFAULT ''",
    "content_md": "TEXT NOT NULL DEFAULT ''",
    "cover_image": "VARCHAR(500) NOT NULL DEFAULT ''",
    "view_count": "INTEGER NOT NULL DEFAULT 0",
    "is_published": "BOOLEAN NOT NULL DEFAULT TRUE",
    "is_pinned": "BOOLEAN NOT NULL DEFAULT FALSE",
    "like_count": "INTEGER NOT NULL DEFAULT 0",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

POST_METADATA_COLUMNS = {
    "content_type": "VARCHAR(50) NOT NULL DEFAULT 'post'",
    "topic_key": "VARCHAR(200) NOT NULL DEFAULT ''",
    "published_mode": "VARCHAR(20) NOT NULL DEFAULT 'manual'",
    "coverage_date": "VARCHAR(20) NOT NULL DEFAULT ''",
    "series_slug": "VARCHAR(120)",
    "series_order": "INTEGER",
    "editor_note": "TEXT",
    "source_count": "INTEGER",
    "quality_score": "FLOAT",
    "reading_time": "INTEGER",
}

POST_COLUMNS = {**POST_BASE_COLUMNS, **POST_METADATA_COLUMNS}

SITE_SETTINGS_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "author_name": "VARCHAR(100) NOT NULL DEFAULT ''",
    "bio": "VARCHAR(300) NOT NULL DEFAULT ''",
    "avatar_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "hero_image": "VARCHAR(500) NOT NULL DEFAULT ''",
    "github_link": "VARCHAR(500) NOT NULL DEFAULT ''",
    "announcement": "TEXT NOT NULL DEFAULT ''",
    "site_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "friend_links": "TEXT NOT NULL DEFAULT '[]'",
}

TAG_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "name": "VARCHAR(80) NOT NULL DEFAULT ''",
    "slug": "VARCHAR(80) NOT NULL UNIQUE",
}

POST_TAG_COLUMNS = {
    "post_id": "INTEGER NOT NULL",
    "tag_id": "INTEGER NOT NULL",
}

COMMENT_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL",
    # Bare INTEGER on purpose: SQLite cannot add a column with an inline FK, so the
    # comments.user_id -> users.id relationship lives at the ORM layer only.
    "user_id": "INTEGER",
    "nickname": "VARCHAR(50) NOT NULL DEFAULT ''",
    "content": "TEXT NOT NULL DEFAULT ''",
    "ip_address": "VARCHAR(50) NOT NULL DEFAULT ''",
    "is_approved": "BOOLEAN NOT NULL DEFAULT TRUE",
    "created_at": "DATETIME",
}

POST_LIKE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL",
    "user_id": "INTEGER",
    "ip_address": "VARCHAR NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
}

VIEW_LOG_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL",
    "ip_address": "VARCHAR NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
}

PUBLISHING_RUN_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "workflow_key": "VARCHAR(50) NOT NULL DEFAULT 'daily_auto'",
    "external_run_id": "VARCHAR(120) NOT NULL DEFAULT ''",
    "run_mode": "VARCHAR(20) NOT NULL DEFAULT 'auto'",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'success'",
    "coverage_date": "VARCHAR(20) NOT NULL DEFAULT ''",
    "message": "TEXT NOT NULL DEFAULT ''",
    "candidate_count": "INTEGER NOT NULL DEFAULT 0",
    "published_count": "INTEGER NOT NULL DEFAULT 0",
    "skipped_count": "INTEGER NOT NULL DEFAULT 0",
    "payload_json": "TEXT NOT NULL DEFAULT '{}'",
    "started_at": "DATETIME",
    "finished_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}


SERIES_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "slug": "VARCHAR(120) NOT NULL UNIQUE",
    "title": "VARCHAR(200) NOT NULL",
    "description": "TEXT NOT NULL DEFAULT ''",
    "cover_image": "VARCHAR(500) NOT NULL DEFAULT ''",
    "content_types": "TEXT NOT NULL DEFAULT '[]'",
    "is_featured": "BOOLEAN NOT NULL DEFAULT FALSE",
    "sort_order": "INTEGER NOT NULL DEFAULT 0",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

POST_SOURCE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL",
    "source_type": "VARCHAR(50) NOT NULL DEFAULT ''",
    "source_name": "VARCHAR(200) NOT NULL DEFAULT ''",
    "source_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "published_at": "DATETIME",
    "is_primary": "BOOLEAN NOT NULL DEFAULT FALSE",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

PUBLISHING_ARTIFACT_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL",
    "publishing_run_id": "INTEGER",
    "workflow_key": "VARCHAR(50) NOT NULL DEFAULT 'daily_auto'",
    "coverage_date": "VARCHAR(20) NOT NULL DEFAULT ''",
    "research_pack_summary": "TEXT NOT NULL DEFAULT ''",
    "quality_gate_json": "TEXT NOT NULL DEFAULT '{}'",
    "image_plan_json": "TEXT NOT NULL DEFAULT '[]'",
    "candidate_topics_json": "TEXT NOT NULL DEFAULT '[]'",
    "failure_reason": "TEXT NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

POST_QUALITY_SNAPSHOT_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL UNIQUE",
    "overall_score": "FLOAT",
    "structure_score": "FLOAT",
    "source_score": "FLOAT",
    "analysis_score": "FLOAT",
    "packaging_score": "FLOAT",
    "resonance_score": "FLOAT",
    "issues_json": "TEXT NOT NULL DEFAULT '[]'",
    "strengths_json": "TEXT NOT NULL DEFAULT '[]'",
    "notes": "TEXT NOT NULL DEFAULT ''",
    "generated_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

POST_QUALITY_REVIEW_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL UNIQUE",
    "editor_verdict": "VARCHAR(20) NOT NULL DEFAULT ''",
    "editor_labels_json": "TEXT NOT NULL DEFAULT '[]'",
    "editor_note": "TEXT NOT NULL DEFAULT ''",
    "followup_recommended": "BOOLEAN",
    "reviewed_at": "DATETIME",
    "reviewed_by": "VARCHAR(120) NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

TOPIC_PROFILE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "topic_key": "VARCHAR(200) NOT NULL UNIQUE",
    "title": "VARCHAR(200) NOT NULL DEFAULT ''",
    "description": "TEXT NOT NULL DEFAULT ''",
    "cover_image": "VARCHAR(500) NOT NULL DEFAULT ''",
    "aliases_json": "TEXT NOT NULL DEFAULT '[]'",
    "focus_points_json": "TEXT NOT NULL DEFAULT '[]'",
    "content_types_json": "TEXT NOT NULL DEFAULT '[]'",
    "series_slug": "VARCHAR(120)",
    "is_featured": "BOOLEAN NOT NULL DEFAULT FALSE",
    "sort_order": "INTEGER NOT NULL DEFAULT 0",
    "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
    "priority": "INTEGER NOT NULL DEFAULT 0",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

SEARCH_INSIGHT_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "query": "VARCHAR(200) NOT NULL UNIQUE",
    "search_count": "INTEGER NOT NULL DEFAULT 0",
    "last_result_count": "INTEGER NOT NULL DEFAULT 0",
    "first_searched_at": "DATETIME",
    "last_searched_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

AI_CHANNEL_CONFIG_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "purpose": "VARCHAR(50) NOT NULL UNIQUE",
    "provider": "VARCHAR(50) NOT NULL DEFAULT 'openai_compatible'",
    "base_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "model": "VARCHAR(200) NOT NULL DEFAULT ''",
    "api_key_env_var": "VARCHAR(120) NOT NULL DEFAULT ''",
    "api_key_value": "TEXT NOT NULL DEFAULT ''",
    "enabled": "BOOLEAN NOT NULL DEFAULT TRUE",
    "extra_json": "TEXT NOT NULL DEFAULT '{}'",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}


AI_PROVIDER_SOURCE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "name": "VARCHAR(120) NOT NULL DEFAULT ''",
    "provider": "VARCHAR(80) NOT NULL DEFAULT 'openai_compatible'",
    "protocol": "VARCHAR(40) NOT NULL DEFAULT 'openai'",
    "base_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "api_key_env_var": "VARCHAR(120) NOT NULL DEFAULT 'AI_API_KEY'",
    "api_key_value": "TEXT NOT NULL DEFAULT ''",
    "enabled": "BOOLEAN NOT NULL DEFAULT TRUE",
    "extra_json": "TEXT NOT NULL DEFAULT '{}'",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

AI_MODEL_INSTANCE_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "source_id": "INTEGER NOT NULL",
    "name": "VARCHAR(160) NOT NULL DEFAULT ''",
    "model": "VARCHAR(240) NOT NULL DEFAULT ''",
    "purpose": "VARCHAR(80) NOT NULL",
    "capabilities_json": "TEXT NOT NULL DEFAULT '[]'",
    "priority": "INTEGER NOT NULL DEFAULT 1",
    "enabled": "BOOLEAN NOT NULL DEFAULT TRUE",
    "is_default": "BOOLEAN NOT NULL DEFAULT FALSE",
    "extra_json": "TEXT NOT NULL DEFAULT '{}'",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

AI_PROVIDER_ALLOWED_HOST_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "hostname": "VARCHAR(255) NOT NULL UNIQUE",
    "note": "VARCHAR(200) NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
}

ADMIN_IMAGE_GENERATION_JOB_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "job_type": "VARCHAR(40) NOT NULL",
    "target_id": "INTEGER",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'queued'",
    "request_json": "TEXT NOT NULL DEFAULT '{}'",
    "prompt": "TEXT NOT NULL DEFAULT ''",
    "preset": "VARCHAR(80) NOT NULL DEFAULT ''",
    "art_direction_version": "VARCHAR(80) NOT NULL DEFAULT ''",
    "art_direction_json": "TEXT NOT NULL DEFAULT '{}'",
    "result_image_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "error_code": "VARCHAR(80) NOT NULL DEFAULT ''",
    "error": "TEXT NOT NULL DEFAULT ''",
    "attempt_count": "INTEGER NOT NULL DEFAULT 0",
    "locked_at": "DATETIME",
    "started_at": "DATETIME",
    "finished_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

ADMIN_TEXT_GENERATION_JOB_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'queued'",
    "request_json": "TEXT NOT NULL DEFAULT '{}'",
    "result_content": "TEXT NOT NULL DEFAULT ''",
    "provider": "VARCHAR(80) NOT NULL DEFAULT ''",
    "model": "VARCHAR(240) NOT NULL DEFAULT ''",
    "purpose": "VARCHAR(80) NOT NULL DEFAULT 'text_generation'",
    "error_code": "VARCHAR(80) NOT NULL DEFAULT ''",
    "error": "TEXT NOT NULL DEFAULT ''",
    "attempt_count": "INTEGER NOT NULL DEFAULT 0",
    "locked_at": "DATETIME",
    "started_at": "DATETIME",
    "finished_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}


EMAIL_SUBSCRIPTION_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "email": "VARCHAR(255) NOT NULL UNIQUE",
    "content_types_json": "TEXT NOT NULL DEFAULT '[\"all\"]'",
    "topic_keys_json": "TEXT NOT NULL DEFAULT '[]'",
    "series_slugs_json": "TEXT NOT NULL DEFAULT '[]'",
    "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
    "source": "VARCHAR(50) NOT NULL DEFAULT 'feeds_page'",
    "last_notified_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

WEB_PUSH_SUBSCRIPTION_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "endpoint": "VARCHAR(1000) NOT NULL UNIQUE",
    "p256dh": "VARCHAR(255) NOT NULL DEFAULT ''",
    "auth": "VARCHAR(255) NOT NULL DEFAULT ''",
    "content_types_json": "TEXT NOT NULL DEFAULT '[\"all\"]'",
    "topic_keys_json": "TEXT NOT NULL DEFAULT '[]'",
    "series_slugs_json": "TEXT NOT NULL DEFAULT '[]'",
    "is_active": "BOOLEAN NOT NULL DEFAULT TRUE",
    "user_agent": "VARCHAR(255) NOT NULL DEFAULT ''",
    "last_notified_at": "DATETIME",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

POST_NOTIFICATION_DISPATCH_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "post_id": "INTEGER NOT NULL UNIQUE",
    "email_sent_at": "DATETIME",
    "email_recipient_count": "INTEGER NOT NULL DEFAULT 0",
    "web_push_sent_at": "DATETIME",
    "web_push_recipient_count": "INTEGER NOT NULL DEFAULT 0",
    "wecom_sent_at": "DATETIME",
    "wecom_target_count": "INTEGER NOT NULL DEFAULT 0",
    "last_error": "TEXT NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
}

USER_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "email": "VARCHAR(255) NOT NULL UNIQUE",
    "password_hash": "VARCHAR(255) NOT NULL",
    "password_set": "BOOLEAN NOT NULL DEFAULT TRUE",
    "token_version": "INTEGER NOT NULL DEFAULT 0",
    "nickname": "VARCHAR(50) NOT NULL DEFAULT ''",
    "avatar_url": "VARCHAR(500) NOT NULL DEFAULT ''",
    "bio": "VARCHAR(300) NOT NULL DEFAULT ''",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
    "email_verified": "BOOLEAN NOT NULL DEFAULT FALSE",
    "created_at": "DATETIME",
    "updated_at": "DATETIME",
    "last_login_at": "DATETIME",
}

RUNTIME_REQUIRED_COLUMNS = {
    "users": {
        "token_version": USER_COLUMNS["token_version"],
        "password_set": USER_COLUMNS["password_set"],
    },
    # bootstrap.initialize_runtime() counts site_settings rows on every startup and
    # env._load_site_url_from_database() reads site_url to build the CORS allowlist.
    # A column missing here fails the lifespan (or silently empties the allowlist),
    # so the whole table is runtime-required, not just one column.
    "site_settings": SITE_SETTINGS_COLUMNS,
}

AUTH_CHALLENGE_COLUMNS = {
    "id": "VARCHAR(36) PRIMARY KEY",
    "email": "VARCHAR(255) NOT NULL",
    "purpose": "VARCHAR(30) NOT NULL",
    "code_digest": "VARCHAR(64) NOT NULL",
    "expires_at": "DATETIME NOT NULL",
    "attempts": "INTEGER NOT NULL DEFAULT 0",
    "max_attempts": "INTEGER NOT NULL DEFAULT 5",
    "consumed_at": "DATETIME",
    "request_ip": "VARCHAR(80) NOT NULL DEFAULT ''",
    "created_at": "DATETIME",
}

FOLLOWED_TOPIC_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "user_id": "INTEGER NOT NULL",
    "topic_key": "VARCHAR(200) NOT NULL",
    "display_title": "VARCHAR(200) NOT NULL DEFAULT ''",
    "followed_at": "DATETIME",
}

READING_HISTORY_COLUMNS = {
    "id": "INTEGER PRIMARY KEY",
    "user_id": "INTEGER NOT NULL",
    "slug": "VARCHAR(200) NOT NULL",
    "title": "VARCHAR(300) NOT NULL DEFAULT ''",
    "topic_key": "VARCHAR(200) NOT NULL DEFAULT ''",
    "topic_display_title": "VARCHAR(200) NOT NULL DEFAULT ''",
    "content_type": "VARCHAR(50) NOT NULL DEFAULT ''",
    "coverage_date": "VARCHAR(20) NOT NULL DEFAULT ''",
    "visited_at": "DATETIME",
}


# Single source of truth: every table in models.Base.metadata must appear here with
# every one of its columns. tests/test_schema_coverage.py turns that into a CI gate
# so "add the column to schema_compat too" stops being a convention nobody enforces.
TABLE_COLUMN_MAPS: dict[str, dict[str, str]] = {
    "posts": POST_COLUMNS,
    "post_tags": POST_TAG_COLUMNS,
    "tags": TAG_COLUMNS,
    "comments": COMMENT_COLUMNS,
    "site_settings": SITE_SETTINGS_COLUMNS,
    "post_likes": POST_LIKE_COLUMNS,
    "view_logs": VIEW_LOG_COLUMNS,
    "series": SERIES_COLUMNS,
    "publishing_runs": PUBLISHING_RUN_COLUMNS,
    "post_sources": POST_SOURCE_COLUMNS,
    "publishing_artifacts": PUBLISHING_ARTIFACT_COLUMNS,
    "post_quality_snapshots": POST_QUALITY_SNAPSHOT_COLUMNS,
    "post_quality_reviews": POST_QUALITY_REVIEW_COLUMNS,
    "topic_profiles": TOPIC_PROFILE_COLUMNS,
    "search_insights": SEARCH_INSIGHT_COLUMNS,
    "ai_channel_configs": AI_CHANNEL_CONFIG_COLUMNS,
    "ai_provider_sources": AI_PROVIDER_SOURCE_COLUMNS,
    "ai_model_instances": AI_MODEL_INSTANCE_COLUMNS,
    "ai_provider_allowed_hosts": AI_PROVIDER_ALLOWED_HOST_COLUMNS,
    "admin_image_generation_jobs": ADMIN_IMAGE_GENERATION_JOB_COLUMNS,
    "admin_text_generation_jobs": ADMIN_TEXT_GENERATION_JOB_COLUMNS,
    "email_subscriptions": EMAIL_SUBSCRIPTION_COLUMNS,
    "web_push_subscriptions": WEB_PUSH_SUBSCRIPTION_COLUMNS,
    "post_notification_dispatches": POST_NOTIFICATION_DISPATCH_COLUMNS,
    "users": USER_COLUMNS,
    "auth_challenges": AUTH_CHALLENGE_COLUMNS,
    "followed_topics": FOLLOWED_TOPIC_COLUMNS,
    "reading_history": READING_HISTORY_COLUMNS,
}


# Tables from the first schema revision. create_all() owns their creation (and for
# post_tags the composite primary key a column map cannot express), but create_all
# never touches a table that already exists — so columns and indexes added to the
# model later still need an explicit backfill here.
LEGACY_CORE_TABLES: tuple[tuple[str, dict[str, str], tuple[str, ...]], ...] = (
    ("site_settings", SITE_SETTINGS_COLUMNS, ()),
    ("tags", TAG_COLUMNS, ()),
    (
        "post_tags",
        POST_TAG_COLUMNS,
        # Tag filtering joins through post_tags.tag_id; the composite primary key
        # (post_id, tag_id) cannot serve that predicate.
        ("CREATE INDEX IF NOT EXISTS ix_post_tags_tag_id ON post_tags (tag_id)",),
    ),
    (
        "comments",
        COMMENT_COLUMNS,
        (
            "CREATE INDEX IF NOT EXISTS ix_comments_user_id ON comments (user_id)",
            "CREATE INDEX IF NOT EXISTS ix_comments_ip_created_at ON comments (ip_address, created_at)",
        ),
    ),
    (
        "post_likes",
        POST_LIKE_COLUMNS,
        ("CREATE INDEX IF NOT EXISTS ix_post_likes_post_user ON post_likes (post_id, user_id)",),
    ),
    (
        "view_logs",
        VIEW_LOG_COLUMNS,
        # view_logs only grows (nothing deletes from it) and every post-detail
        # request probes it by (post_id, ip_address, created_at).
        (
            "CREATE INDEX IF NOT EXISTS ix_view_logs_post_ip_created_at "
            "ON view_logs (post_id, ip_address, created_at)",
        ),
    ),
)

DEFAULT_SERIES_SEED = [
    {
        "slug": "ai-daily-brief",
        "title": "AI 日报简报",
        "description": "聚焦单一主题的 AI 日报，强调背景、影响与判断。",
        "content_types": '["daily_brief"]',
        "is_featured": True,
        "sort_order": 10,
    },
    {
        "slug": "ai-weekly-review",
        "title": "AI 周报综述",
        "description": "面向一周趋势的结构化复盘，突出策略脉络与关键结论。",
        "content_types": '["weekly_review"]',
        "is_featured": True,
        "sort_order": 20,
    },
    {
        "slug": "product-strategy-watch",
        "title": "产品战略观察",
        "description": "跟踪 AI 公司与产品战略变化，解读竞争与路线调整。",
        "content_types": '["daily_brief", "weekly_review", "post"]',
        "is_featured": False,
        "sort_order": 30,
    },
    {
        "slug": "paper-to-product",
        "title": "论文到产品",
        "description": "连接论文进展与工程落地，关注可用性与产品化价值。",
        "content_types": '["weekly_review", "post"]',
        "is_featured": False,
        "sort_order": 40,
    },
    {
        "slug": "tooling-workflow",
        "title": "工具与工作流",
        "description": "聚焦开发工具链、自动化流程与构建者效率实践。",
        "content_types": '["daily_brief", "post"]',
        "is_featured": False,
        "sort_order": 50,
    },
]

LEGACY_SERIES_DEFAULTS = {
    "ai-daily-brief": {
        "title": "AI Daily Brief",
        "description": "Single-topic daily AI brief with analysis and context.",
    },
    "ai-weekly-review": {
        "title": "AI Weekly Review",
        "description": "Weekly synthesis with deeper structure and strategic takeaways.",
    },
    "product-strategy-watch": {
        "title": "Product Strategy Watch",
        "description": "Company and product strategy shifts in AI.",
    },
    "paper-to-product": {
        "title": "Paper to Product",
        "description": "From papers to practical product and engineering implications.",
    },
    "tooling-workflow": {
        "title": "Tooling Workflow",
        "description": "Toolchain, workflow, and automation practices for builders.",
    },
}


_PRIMARY_KEY_PATTERN = re.compile(r"\bPRIMARY\s+KEY\b", re.IGNORECASE)
_UNIQUE_PATTERN = re.compile(r"\bUNIQUE\b", re.IGNORECASE)
_NOT_NULL_PATTERN = re.compile(r"\bNOT\s+NULL\b", re.IGNORECASE)


def _ddl_for_dialect(ddl: str, dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return ddl.replace("DATETIME", "TIMESTAMP")
    return ddl


def _is_primary_key_ddl(ddl: str) -> bool:
    return bool(_PRIMARY_KEY_PATTERN.search(ddl or ""))


def _alter_ddl_for_dialect(ddl: str, dialect_name: str) -> str:
    """Rewrite a CREATE TABLE column definition into an ALTER-safe one.

    `ALTER TABLE ... ADD COLUMN` cannot introduce UNIQUE (every pre-existing row
    would land on the same default) and SQLite rejects NOT NULL without a DEFAULT.
    Dropping those keywords keeps the backfill additive instead of letting a legacy
    database fail to start; both constraints are still enforced by the ORM and by
    the CREATE UNIQUE INDEX statements that accompany each table.
    """
    rewritten = _UNIQUE_PATTERN.sub("", ddl or "")
    if "DEFAULT" not in rewritten.upper():
        rewritten = _NOT_NULL_PATTERN.sub("", rewritten)
    return _ddl_for_dialect(" ".join(rewritten.split()), dialect_name)


def _add_missing_columns(engine, table_name: str, columns: dict[str, str], *, inspector=None) -> list[str]:
    """Add every mapped column the existing table does not have yet. Idempotent."""
    inspector = inspector if inspector is not None else inspect(engine)
    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    missing_columns = {
        name: _alter_ddl_for_dialect(ddl, engine.dialect.name)
        for name, ddl in columns.items()
        # A primary key can never be introduced by ALTER TABLE ADD COLUMN.
        if name not in existing_columns and not _is_primary_key_ddl(ddl)
    }
    if not missing_columns:
        return []

    if_not_exists = "IF NOT EXISTS " if engine.dialect.name == "postgresql" else ""
    with engine.begin() as connection:
        for column_name, ddl in missing_columns.items():
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {if_not_exists}{column_name} {ddl}")
            )
    return list(missing_columns)


def _ensure_postgres_id_default(engine, table_name: str) -> None:
    """Attach an id sequence to a Postgres table that was created without one.

    Guarded by a read-only probe on purpose. The DDL below takes an ACCESS
    EXCLUSIVE lock on the table, and an unconditional setval would *rewind* the
    sequence whenever a concurrent insert has consumed a value but not committed
    yet (MAX(id) cannot see it) — the next insert would then collide on the primary
    key. Running it only when the column still has no sequence keeps the steady
    state read-only and makes the rewind unreachable.
    """
    if engine.dialect.name != "postgresql":
        return
    sequence_name = f"{table_name}_id_seq"
    with engine.begin() as connection:
        attached = connection.execute(
            text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
            {"table_name": table_name},
        ).scalar()
        if attached:
            return

        connection.execute(text(f"CREATE SEQUENCE IF NOT EXISTS {sequence_name}"))
        connection.execute(text(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id"))
        connection.execute(
            text(
                f"ALTER TABLE {table_name} "
                f"ALTER COLUMN id SET DEFAULT nextval('{sequence_name}'::regclass)"
            )
        )
        next_from_rows = connection.execute(
            text(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table_name}")
        ).scalar() or 1
        next_from_sequence = connection.execute(
            text(
                "SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END "
                f"FROM {sequence_name}"
            )
        ).scalar() or 1
        # GREATEST semantics: never hand back a value the sequence already issued.
        connection.execute(
            text(f"SELECT setval('{sequence_name}'::regclass, :next_value, false)"),
            {"next_value": max(int(next_from_rows), int(next_from_sequence))},
        )


def _create_table_if_missing(
    engine,
    table_name: str,
    columns: dict[str, str],
    indexes: list[str] | None = None,
    *,
    repair_sequence: bool = False,
) -> None:
    """Create the table, or backfill the columns it is missing if it already exists.

    Create-only would make every mapping below a no-op for databases that predate
    it — which is precisely the case the whole shim exists for.

    `repair_sequence` is opt-in because the Postgres sequence repair issues DDL;
    the lazy per-request callers must not pay for it (see _ensure_postgres_id_default).
    """
    inspector = inspect(engine)
    table_exists = table_name in set(inspector.get_table_names())

    if table_exists:
        _add_missing_columns(engine, table_name, columns, inspector=inspector)
    else:
        column_sql = ", ".join(
            f"{name} {_ddl_for_dialect(ddl, engine.dialect.name)}"
            for name, ddl in columns.items()
        )
        with engine.begin() as connection:
            connection.execute(text(f"CREATE TABLE {table_name} ({column_sql})"))

    with engine.begin() as connection:
        for index_sql in indexes or []:
            connection.execute(text(index_sql))

    id_ddl = columns.get("id", "").upper()
    if "INTEGER" in id_ddl and "PRIMARY KEY" in id_ddl and (repair_sequence or not table_exists):
        _ensure_postgres_id_default(engine, table_name)


def ensure_ai_provider_allowlist_schema_compat(engine, *, repair_sequence: bool = False) -> None:
    """Create/backfill the admin-managed Base URL allowlist table.

    Split out of `ensure_ai_provider_schema_compat` because the read path needs it
    too: `ai_provider_manager._allowed_base_url_hosts()` SELECTs this table while
    resolving the runtime plan, and on Render (startup schema sync off) nothing
    else would have created it.
    """
    _create_table_if_missing(
        engine,
        "ai_provider_allowed_hosts",
        AI_PROVIDER_ALLOWED_HOST_COLUMNS,
        indexes=[
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_provider_allowed_hosts_hostname "
            "ON ai_provider_allowed_hosts (hostname)",
        ],
        repair_sequence=repair_sequence,
    )


def ensure_ai_provider_schema_compat(engine, *, repair_sequence: bool = False) -> None:
    ensure_ai_provider_allowlist_schema_compat(engine, repair_sequence=repair_sequence)

    _create_table_if_missing(
        engine,
        "ai_provider_sources",
        AI_PROVIDER_SOURCE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_ai_provider_sources_provider ON ai_provider_sources (provider)",
        ],
        repair_sequence=repair_sequence,
    )

    _create_table_if_missing(
        engine,
        "ai_model_instances",
        AI_MODEL_INSTANCE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_ai_model_instances_source_id ON ai_model_instances (source_id)",
            "CREATE INDEX IF NOT EXISTS ix_ai_model_instances_purpose ON ai_model_instances (purpose)",
            "CREATE INDEX IF NOT EXISTS ix_ai_model_instances_priority ON ai_model_instances (priority)",
        ],
        repair_sequence=repair_sequence,
    )


def ensure_admin_image_generation_schema_compat(engine, *, repair_sequence: bool = False) -> None:
    # Column backfill is handled by _create_table_if_missing for every table now.
    _create_table_if_missing(
        engine,
        "admin_image_generation_jobs",
        ADMIN_IMAGE_GENERATION_JOB_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_admin_image_generation_jobs_status ON admin_image_generation_jobs (status)",
            "CREATE INDEX IF NOT EXISTS ix_admin_image_generation_jobs_type_target_created ON admin_image_generation_jobs (job_type, target_id, created_at)",
            "CREATE INDEX IF NOT EXISTS ix_admin_image_generation_jobs_created_at ON admin_image_generation_jobs (created_at)",
        ],
        repair_sequence=repair_sequence,
    )


def ensure_admin_text_generation_schema_compat(engine, *, repair_sequence: bool = False) -> None:
    _create_table_if_missing(
        engine,
        "admin_text_generation_jobs",
        ADMIN_TEXT_GENERATION_JOB_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_admin_text_generation_jobs_status ON admin_text_generation_jobs (status)",
            "CREATE INDEX IF NOT EXISTS ix_admin_text_generation_jobs_created_at ON admin_text_generation_jobs (created_at)",
        ],
        repair_sequence=repair_sequence,
    )


def ensure_runtime_required_schema(engine) -> None:
    """Apply small additive migrations required by the current runtime.

    Full compatibility sync remains opt-in in production. These columns are
    different: without them the deployed application cannot become ready.
    """
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    for table_name, columns in RUNTIME_REQUIRED_COLUMNS.items():
        if table_name not in table_names:
            continue
        _add_missing_columns(engine, table_name, columns, inspector=inspector)

    # The visitor account system shipped as one batch: users + auth_challenges +
    # the two personalisation tables. Render runs with schema sync off, so all four
    # need their own lazy creation path — backfilling only the users columns leaves
    # a deploy where users exists but followed_topics/reading_history do not.
    _create_table_if_missing(
        engine,
        "users",
        USER_COLUMNS,
        indexes=[
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)",
            "CREATE INDEX IF NOT EXISTS ix_users_status ON users (status)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "auth_challenges",
        AUTH_CHALLENGE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_email ON auth_challenges (email)",
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_purpose ON auth_challenges (purpose)",
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_expires_at ON auth_challenges (expires_at)",
        ],
    )

    _create_table_if_missing(
        engine,
        "followed_topics",
        FOLLOWED_TOPIC_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_followed_topics_user_id ON followed_topics (user_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_topic ON followed_topics (user_id, topic_key)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "reading_history",
        READING_HISTORY_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_reading_history_user_id ON reading_history (user_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_slug ON reading_history (user_id, slug)",
        ],
        repair_sequence=True,
    )

    # The Base URL allowlist is read on the AI runtime path, not only when an admin
    # edits it: a missing table there would abort the surrounding transaction on
    # Postgres. Create it even when full schema sync is off.
    ensure_ai_provider_allowlist_schema_compat(engine, repair_sequence=True)


def ensure_schema_compat(engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    if "posts" in table_names:
        _add_missing_columns(engine, "posts", POST_COLUMNS, inspector=inspector)
        with engine.begin() as connection:
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_posts_series_slug ON posts (series_slug)")
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_posts_public_published_created_at "
                    "ON posts (is_published, created_at)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_posts_public_published_content_type_created_at "
                    "ON posts (is_published, content_type, created_at)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_posts_public_published_topic_key_created_at "
                    "ON posts (is_published, topic_key, created_at)"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_posts_public_published_series_slug_created_at "
                    "ON posts (is_published, series_slug, created_at)"
                )
            )

    _create_table_if_missing(
        engine,
        "publishing_runs",
        PUBLISHING_RUN_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_publishing_runs_workflow_key ON publishing_runs (workflow_key)",
            "CREATE INDEX IF NOT EXISTS ix_publishing_runs_external_run_id ON publishing_runs (external_run_id)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "series",
        SERIES_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_series_slug ON series (slug)",
            "CREATE INDEX IF NOT EXISTS ix_series_sort_order ON series (sort_order)",
            "CREATE INDEX IF NOT EXISTS ix_series_is_featured ON series (is_featured)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "post_sources",
        POST_SOURCE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_sources_post_id ON post_sources (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_sources_is_primary ON post_sources (is_primary)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "publishing_artifacts",
        PUBLISHING_ARTIFACT_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_publishing_artifacts_post_id ON publishing_artifacts (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_publishing_artifacts_workflow_key ON publishing_artifacts (workflow_key)",
            "CREATE INDEX IF NOT EXISTS ix_publishing_artifacts_run_id ON publishing_artifacts (publishing_run_id)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "post_quality_snapshots",
        POST_QUALITY_SNAPSHOT_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_quality_snapshots_post_id ON post_quality_snapshots (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_quality_snapshots_updated_at ON post_quality_snapshots (updated_at)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "post_quality_reviews",
        POST_QUALITY_REVIEW_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_quality_reviews_post_id ON post_quality_reviews (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_quality_reviews_reviewed_at ON post_quality_reviews (reviewed_at)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "topic_profiles",
        TOPIC_PROFILE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_topic_key ON topic_profiles (topic_key)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_series_slug ON topic_profiles (series_slug)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_sort_order ON topic_profiles (sort_order)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_is_featured ON topic_profiles (is_featured)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_priority ON topic_profiles (priority)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "search_insights",
        SEARCH_INSIGHT_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_search_insights_query ON search_insights (query)",
            "CREATE INDEX IF NOT EXISTS ix_search_insights_last_searched_at ON search_insights (last_searched_at)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "ai_channel_configs",
        AI_CHANNEL_CONFIG_COLUMNS,
        indexes=[
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_channel_configs_purpose ON ai_channel_configs (purpose)",
        ],
        repair_sequence=True,
    )

    ensure_ai_provider_schema_compat(engine, repair_sequence=True)
    ensure_admin_image_generation_schema_compat(engine, repair_sequence=True)
    ensure_admin_text_generation_schema_compat(engine, repair_sequence=True)

    _create_table_if_missing(
        engine,
        "email_subscriptions",

        EMAIL_SUBSCRIPTION_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_email_subscriptions_email ON email_subscriptions (email)",
            "CREATE INDEX IF NOT EXISTS ix_email_subscriptions_is_active ON email_subscriptions (is_active)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "web_push_subscriptions",
        WEB_PUSH_SUBSCRIPTION_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_web_push_subscriptions_endpoint ON web_push_subscriptions (endpoint)",
            "CREATE INDEX IF NOT EXISTS ix_web_push_subscriptions_is_active ON web_push_subscriptions (is_active)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "post_notification_dispatches",
        POST_NOTIFICATION_DISPATCH_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_notification_dispatches_post_id ON post_notification_dispatches (post_id)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "users",
        USER_COLUMNS,
        indexes=[
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)",
            "CREATE INDEX IF NOT EXISTS ix_users_status ON users (status)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "auth_challenges",
        AUTH_CHALLENGE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_email ON auth_challenges (email)",
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_purpose ON auth_challenges (purpose)",
            "CREATE INDEX IF NOT EXISTS ix_auth_challenges_expires_at ON auth_challenges (expires_at)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "followed_topics",
        FOLLOWED_TOPIC_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_followed_topics_user_id ON followed_topics (user_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_topic ON followed_topics (user_id, topic_key)",
        ],
        repair_sequence=True,
    )

    _create_table_if_missing(
        engine,
        "reading_history",
        READING_HISTORY_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_reading_history_user_id ON reading_history (user_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_slug ON reading_history (user_id, slug)",
        ],
        repair_sequence=True,
    )

    # Everything above went through _create_table_if_missing, which now creates *or*
    # backfills. The tables below predate the shim and are created by
    # Base.metadata.create_all(), so they only need the backfill half plus the indexes
    # that were added to the models after the tables already existed.
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    for table_name, columns, indexes in LEGACY_CORE_TABLES:
        if table_name not in table_names:
            continue
        _add_missing_columns(engine, table_name, columns, inspector=inspector)
        if not indexes:
            continue
        with engine.begin() as connection:
            for index_sql in indexes:
                connection.execute(text(index_sql))

    inspector = inspect(engine)
    if "series" in set(inspector.get_table_names()):
        with engine.begin() as connection:
            count = connection.execute(text("SELECT COUNT(1) FROM series")).scalar() or 0
            if count == 0:
                for item in DEFAULT_SERIES_SEED:
                    connection.execute(
                        text(
                            """
                            INSERT INTO series
                            (slug, title, description, cover_image, content_types, is_featured, sort_order, created_at, updated_at)
                            VALUES (:slug, :title, :description, '', :content_types, :is_featured, :sort_order, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                            """
                        ),
                        item,
                    )
            else:
                existing_series = connection.execute(
                    text("SELECT slug, title, description FROM series")
                ).mappings().all()
                for row in existing_series:
                    slug = row["slug"]
                    if slug not in LEGACY_SERIES_DEFAULTS:
                        continue
                    latest = next((item for item in DEFAULT_SERIES_SEED if item["slug"] == slug), None)
                    if latest is None:
                        continue
                    current_title = (row["title"] or "").strip()
                    current_desc = (row["description"] or "").strip()
                    old = LEGACY_SERIES_DEFAULTS[slug]
                    should_update_title = (not current_title) or (current_title == old["title"])
                    should_update_desc = (not current_desc) or (current_desc == old["description"])
                    if should_update_title or should_update_desc:
                        connection.execute(
                            text(
                                """
                                UPDATE series
                                SET title = :title, description = :description, updated_at = CURRENT_TIMESTAMP
                                WHERE slug = :slug
                                """
                            ),
                            {
                                "slug": slug,
                                "title": latest["title"] if should_update_title else current_title,
                                "description": latest["description"] if should_update_desc else current_desc,
                            },
                        )
