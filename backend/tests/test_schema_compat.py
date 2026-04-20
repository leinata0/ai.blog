from app.schema_compat import (
    DEFAULT_SERIES_SEED,
    POST_QUALITY_REVIEW_COLUMNS,
    POST_QUALITY_SNAPSHOT_COLUMNS,
    POST_SOURCE_COLUMNS,
    SEARCH_INSIGHT_COLUMNS,
    SERIES_COLUMNS,
    TOPIC_PROFILE_COLUMNS,
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


def test_post_model_declares_public_read_indexes():
    index_names = {index.name for index in Post.__table__.indexes}
    assert "ix_posts_public_published_created_at" in index_names
    assert "ix_posts_public_published_content_type_created_at" in index_names
    assert "ix_posts_public_published_topic_key_created_at" in index_names
    assert "ix_posts_public_published_series_slug_created_at" in index_names
