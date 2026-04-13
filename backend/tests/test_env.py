from app.env import clean_env, get_database_url, normalize_database_url


def test_clean_env_trims_quotes_and_prefix(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", '  "DATABASE_URL=postgresql://user:pass@host/db?sslmode=require"  ')
    assert clean_env("DATABASE_URL") == "postgresql://user:pass@host/db?sslmode=require"


def test_normalize_database_url_upgrades_postgres_scheme():
    assert normalize_database_url("postgres://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"
    assert normalize_database_url("postgresql://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"


def test_get_database_url_uses_sqlite_default_when_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert get_database_url() == "sqlite:///./blog.db"
