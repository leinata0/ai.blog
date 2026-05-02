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
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_sort_order ON topic_profiles (sort_order)",
            "CREATE INDEX IF NOT EXISTS ix_topic_profiles_is_featured ON topic_profiles (is_featured)",
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

    _create_table_if_missing(
        engine,
        "ai_channel_configs",
        AI_CHANNEL_CONFIG_COLUMNS,
        indexes=[
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_ai_channel_configs_purpose ON ai_channel_configs (purpose)",
        ],
    )

    _create_table_if_missing(
        engine,
        "email_subscriptions",
        EMAIL_SUBSCRIPTION_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_email_subscriptions_email ON email_subscriptions (email)",
            "CREATE INDEX IF NOT EXISTS ix_email_subscriptions_is_active ON email_subscriptions (is_active)",
        ],
    )

    _create_table_if_missing(
        engine,
        "web_push_subscriptions",
        WEB_PUSH_SUBSCRIPTION_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_web_push_subscriptions_endpoint ON web_push_subscriptions (endpoint)",
            "CREATE INDEX IF NOT EXISTS ix_web_push_subscriptions_is_active ON web_push_subscriptions (is_active)",
        ],
    )

    _create_table_if_missing(
        engine,
        "post_notification_dispatches",
        POST_NOTIFICATION_DISPATCH_COLUMNS,
        indexes=[
            "CREATE INDEX IF NOT EXISTS ix_post_notification_dispatches_post_id ON post_notification_dispatches (post_id)",
        ],
    )

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    for table_name, columns in (
        ("ai_channel_configs", AI_CHANNEL_CONFIG_COLUMNS),
        ("email_subscriptions", EMAIL_SUBSCRIPTION_COLUMNS),
        ("web_push_subscriptions", WEB_PUSH_SUBSCRIPTION_COLUMNS),
    ):
        if table_name not in table_names:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        missing_columns = {name: ddl for name, ddl in columns.items() if name not in existing_columns}
        if missing_columns:
            with engine.begin() as connection:
                for column_name, ddl in missing_columns.items():
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}"))

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "topic_profiles" in table_names:
        existing_columns = {column["name"] for column in inspector.get_columns("topic_profiles")}
        missing_columns = {
            name: ddl for name, ddl in TOPIC_PROFILE_COLUMNS.items() if name not in existing_columns
        }
        if missing_columns:
            with engine.begin() as connection:
                for column_name, ddl in missing_columns.items():
                    connection.execute(text(f"ALTER TABLE topic_profiles ADD COLUMN {column_name} {ddl}"))

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
