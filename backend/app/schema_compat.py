from sqlalchemy import inspect, text


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
    "focus_points_json": "TEXT NOT NULL DEFAULT '[]'",
    "content_types_json": "TEXT NOT NULL DEFAULT '[]'",
    "series_slug": "VARCHAR(120)",
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

DEFAULT_SERIES_SEED = [
    {
        "slug": "ai-daily-brief",
        "title": "AI Daily Brief",
        "description": "Single-topic daily AI brief with analysis and context.",
        "content_types": '["daily_brief"]',
        "is_featured": True,
        "sort_order": 10,
    },
    {
        "slug": "ai-weekly-review",
        "title": "AI Weekly Review",
        "description": "Weekly synthesis with deeper structure and strategic takeaways.",
        "content_types": '["weekly_review"]',
        "is_featured": True,
        "sort_order": 20,
    },
    {
        "slug": "product-strategy-watch",
        "title": "Product Strategy Watch",
        "description": "Company and product strategy shifts in AI.",
        "content_types": '["daily_brief", "weekly_review", "post"]',
        "is_featured": False,
        "sort_order": 30,
    },
    {
        "slug": "paper-to-product",
        "title": "Paper to Product",
        "description": "From papers to practical product and engineering implications.",
        "content_types": '["weekly_review", "post"]',
        "is_featured": False,
        "sort_order": 40,
    },
    {
        "slug": "tooling-workflow",
        "title": "Tooling Workflow",
        "description": "Toolchain, workflow, and automation practices for builders.",
        "content_types": '["daily_brief", "post"]',
        "is_featured": False,
        "sort_order": 50,
    },
]


def _create_table_if_missing(engine, table_name: str, columns: dict[str, str], indexes: list[str] | None = None) -> None:
    inspector = inspect(engine)
    if table_name in set(inspector.get_table_names()):
        return

    column_sql = ", ".join(f"{name} {ddl}" for name, ddl in columns.items())
    with engine.begin() as connection:
        connection.execute(text(f"CREATE TABLE {table_name} ({column_sql})"))
        for index_sql in indexes or []:
            connection.execute(text(index_sql))


def ensure_schema_compat(engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    if "posts" in table_names:
        existing_columns = {column["name"] for column in inspector.get_columns("posts")}
        missing_columns = {
            name: ddl for name, ddl in POST_METADATA_COLUMNS.items() if name not in existing_columns
        }
        if missing_columns:
            with engine.begin() as connection:
                for column_name, ddl in missing_columns.items():
                    connection.execute(text(f"ALTER TABLE posts ADD COLUMN {column_name} {ddl}"))
        with engine.begin() as connection:
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_posts_series_slug ON posts (series_slug)")
            )

    _create_table_if_missing(
        engine,
        "publishing_runs",
        PUBLISHING_RUN_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_publishing_runs_workflow_key ON publishing_runs (workflow_key)",
            "CREATE INDEX IF NOT EXISTS ix_publishing_runs_external_run_id ON publishing_runs (external_run_id)",
        ],
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
    )

    _create_table_if_missing(
        engine,
        "post_sources",
        POST_SOURCE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_sources_post_id ON post_sources (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_sources_is_primary ON post_sources (is_primary)",
        ],
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
    )

    _create_table_if_missing(
        engine,
        "post_quality_snapshots",
        POST_QUALITY_SNAPSHOT_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_quality_snapshots_post_id ON post_quality_snapshots (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_quality_snapshots_updated_at ON post_quality_snapshots (updated_at)",
        ],
    )

    _create_table_if_missing(
        engine,
        "post_quality_reviews",
        POST_QUALITY_REVIEW_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_quality_reviews_post_id ON post_quality_reviews (post_id)",
            "CREATE INDEX IF NOT EXISTS ix_post_quality_reviews_reviewed_at ON post_quality_reviews (reviewed_at)",
        ],
    )

    _create_table_if_missing(
        engine,
        "topic_profiles",
        TOPIC_PROFILE_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_topic_key ON topic_profiles (topic_key)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_series_slug ON topic_profiles (series_slug)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_priority ON topic_profiles (priority)",
        ],
    )

    _create_table_if_missing(
        engine,
        "search_insights",
        SEARCH_INSIGHT_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_search_insights_query ON search_insights (query)",
            "CREATE INDEX IF NOT EXISTS ix_search_insights_last_searched_at ON search_insights (last_searched_at)",
        ],
    )

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
