from app.schema_compat import DEFAULT_SERIES_SEED, POST_SOURCE_COLUMNS, SERIES_COLUMNS


def test_series_seed_uses_boolean_flags():
    assert DEFAULT_SERIES_SEED
    assert all(isinstance(item["is_featured"], bool) for item in DEFAULT_SERIES_SEED)


def test_boolean_defaults_are_postgres_friendly():
    assert SERIES_COLUMNS["is_featured"].endswith("DEFAULT FALSE")
    assert POST_SOURCE_COLUMNS["is_primary"].endswith("DEFAULT FALSE")
