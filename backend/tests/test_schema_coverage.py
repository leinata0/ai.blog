"""Meta-tests turning "keep schema_compat in sync with the models" into a CI gate.

The project has no Alembic: an existing production row set only survives a model
change if the new column is also declared in `schema_compat`, and only reaches a
deployed database if some code path actually ALTERs it in. Both halves used to be
a convention in CLAUDE.md that nothing verified — and the convention had drifted.
"""

from pathlib import Path

import pytest

from app import models, schema_compat
from app.schema_compat import TABLE_COLUMN_MAPS, _alter_ddl_for_dialect, _is_primary_key_ddl

SCHEMA_COMPAT_SOURCE = Path(schema_compat.__file__).read_text(encoding="utf-8")


def _model_tables():
    return dict(sorted(models.Base.metadata.tables.items()))


def test_every_model_table_has_a_column_map():
    missing = sorted(set(_model_tables()) - set(TABLE_COLUMN_MAPS))
    assert missing == [], (
        "These tables have no schema_compat column map, so a column added to them "
        f"can never be backfilled onto an existing database: {missing}"
    )


def test_every_model_column_is_declared_in_schema_compat():
    gaps = {}
    for table_name, table in _model_tables().items():
        mapped = TABLE_COLUMN_MAPS.get(table_name, {})
        missing = sorted({column.name for column in table.columns} - set(mapped))
        if missing:
            gaps[table_name] = missing
    assert gaps == {}, (
        "Add these columns to the matching schema_compat.*_COLUMNS map — without "
        f"them, existing rows break when the model change ships: {gaps}"
    )


def test_column_maps_do_not_declare_columns_the_models_dropped():
    stale = {}
    for table_name, columns in TABLE_COLUMN_MAPS.items():
        table = _model_tables().get(table_name)
        if table is None:
            stale[table_name] = "table not in models.Base.metadata"
            continue
        extra = sorted(set(columns) - {column.name for column in table.columns})
        if extra:
            stale[table_name] = extra
    assert stale == {}, f"schema_compat would ALTER in columns the ORM never reads: {stale}"


@pytest.mark.parametrize("table_name", sorted(TABLE_COLUMN_MAPS))
def test_column_map_ddl_is_alter_safe(table_name):
    """Every mapped DDL has to survive `ALTER TABLE ... ADD COLUMN` on both dialects.

    A NOT NULL without DEFAULT or an inline UNIQUE would abort the backfill (and on
    SQLite the whole startup) the first time it is actually needed.
    """
    for column_name, ddl in TABLE_COLUMN_MAPS[table_name].items():
        if _is_primary_key_ddl(ddl):
            # Primary keys are create-only; the backfill skips them by design.
            assert column_name in {"id"}, f"{table_name}.{column_name}"
            continue
        for dialect in ("sqlite", "postgresql"):
            rewritten = _alter_ddl_for_dialect(ddl, dialect)
            assert "UNIQUE" not in rewritten.upper(), f"{table_name}.{column_name} ({dialect})"
            if "NOT NULL" in rewritten.upper():
                assert "DEFAULT" in rewritten.upper(), f"{table_name}.{column_name} ({dialect})"
        assert "DATETIME" not in _alter_ddl_for_dialect(ddl, "postgresql").upper(), (
            f"{table_name}.{column_name}: DATETIME is not a Postgres type"
        )


def test_composite_model_indexes_have_a_compat_create_statement():
    """Composite indexes are declared in __table_args__ *after* the table shipped, so
    create_all(checkfirst=True) never builds them on a deployed database. Only an
    explicit CREATE INDEX IF NOT EXISTS in schema_compat can.
    """
    missing = []
    for table_name, table in _model_tables().items():
        for index in table.indexes:
            if len(index.columns) < 2:
                # Single-column index=True indexes are created together with the table.
                continue
            if index.name not in SCHEMA_COMPAT_SOURCE:
                missing.append(f"{table_name}.{index.name}")
    assert missing == [], (
        "Add a CREATE INDEX IF NOT EXISTS for these to schema_compat — otherwise they "
        f"exist only in fresh databases: {sorted(missing)}"
    )
