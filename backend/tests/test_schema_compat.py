from app.schema_compat import (
    DEFAULT_SERIES_SEED,
    POST_QUALITY_REVIEW_COLUMNS,
    POST_QUALITY_SNAPSHOT_COLUMNS,
    POST_SOURCE_COLUMNS,
    SERIES_COLUMNS,
)


def test_series_seed_uses_boolean_flags():
    assert DEFAULT_SERIES_SEED
    assert all(isinstance(item["is_featured"], bool) for item in DEFAULT_SERIES_SEED)


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
