from sqlalchemy import text

from app.db import create_db_engine


def test_sqlite_connections_enable_foreign_keys_and_cascade_delete(tmp_path):
    engine = create_db_engine(f"sqlite:///{tmp_path / 'foreign-keys.db'}")

    with engine.begin() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        connection.execute(text("CREATE TABLE parents (id INTEGER PRIMARY KEY)"))
        connection.execute(
            text(
                "CREATE TABLE children ("
                "id INTEGER PRIMARY KEY, "
                "parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE"
                ")"
            )
        )
        connection.execute(text("INSERT INTO parents (id) VALUES (1)"))
        connection.execute(text("INSERT INTO children (id, parent_id) VALUES (1, 1)"))

    engine.dispose()

    with engine.begin() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        connection.execute(text("DELETE FROM parents WHERE id = 1"))
        assert connection.execute(text("SELECT COUNT(*) FROM children")).scalar_one() == 0

    engine.dispose()
