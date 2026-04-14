from sqlalchemy import inspect, text


POST_METADATA_COLUMNS = {
    "content_type": "VARCHAR(50) NOT NULL DEFAULT 'post'",
    "topic_key": "VARCHAR(200) NOT NULL DEFAULT ''",
    "published_mode": "VARCHAR(20) NOT NULL DEFAULT 'manual'",
    "coverage_date": "VARCHAR(20) NOT NULL DEFAULT ''",
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

    if "publishing_runs" not in table_names:
        column_sql = ", ".join(f"{name} {ddl}" for name, ddl in PUBLISHING_RUN_COLUMNS.items())
        with engine.begin() as connection:
            connection.execute(text(f"CREATE TABLE publishing_runs ({column_sql})"))
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_publishing_runs_workflow_key ON publishing_runs (workflow_key)")
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_publishing_runs_external_run_id ON publishing_runs (external_run_id)")
            )
