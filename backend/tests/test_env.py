import importlib

import pytest

from app.env import (
    clean_env,
    clean_env_list,
    get_allowed_origins,
    get_database_url,
    get_default_public_site_url,
    normalize_database_url,
)


def test_clean_env_trims_quotes_and_prefix(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", '  "DATABASE_URL=postgresql://user:pass@host/db?sslmode=require"  ')
    assert clean_env("DATABASE_URL") == "postgresql://user:pass@host/db?sslmode=require"


def test_normalize_database_url_upgrades_postgres_scheme():
    assert normalize_database_url("postgres://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"
    assert normalize_database_url("postgresql://user:pass@host/db") == "postgresql+psycopg://user:pass@host/db"


def test_get_database_url_uses_sqlite_default_when_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert get_database_url() == "sqlite:///./blog.db"


def test_clean_env_list_supports_commas_and_newlines(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example.com,\nhttps://b.example.com")
    assert clean_env_list("ALLOWED_ORIGINS") == ["https://a.example.com", "https://b.example.com"]


def test_get_default_public_site_url_prefers_explicit_env(monkeypatch):
    monkeypatch.setenv("PUBLIC_SITE_URL", "https://blog.example.com/")
    assert get_default_public_site_url() == "https://blog.example.com"


def test_get_allowed_origins_uses_local_defaults_in_development(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    origins = get_allowed_origins()
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins


def test_get_allowed_origins_expands_www_variant_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PUBLIC_SITE_URL", "https://563118077.xyz")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)

    origins = get_allowed_origins()
    assert "https://563118077.xyz" in origins
    assert "https://www.563118077.xyz" in origins


def test_get_allowed_origins_falls_back_to_site_settings_when_env_missing(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)
    monkeypatch.delenv("SITE_URL", raising=False)
    monkeypatch.setattr("app.env._load_site_url_from_database", lambda: "https://563118077.xyz")

    origins = get_allowed_origins()
    assert "https://563118077.xyz" in origins
    assert "https://www.563118077.xyz" in origins


def test_auth_allows_dev_explicit_fallbacks(monkeypatch):
    import app.auth as auth_mod

    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.setenv("DEV_SECRET_KEY", "dev-secret-for-tests")
    monkeypatch.setenv("DEV_ADMIN_USERNAME", "dev-admin")
    monkeypatch.setenv("DEV_ADMIN_PASSWORD", "dev-password")

    reloaded = importlib.reload(auth_mod)
    assert reloaded.SECRET_KEY == "dev-secret-for-tests"
    assert reloaded.ADMIN_USERNAME == "dev-admin"
    assert reloaded.ADMIN_PASSWORD == "dev-password"

    monkeypatch.setenv("DEV_SECRET_KEY", "test-dev-secret-key")
    monkeypatch.setenv("DEV_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("DEV_ADMIN_PASSWORD", "admin123")
    importlib.reload(auth_mod)


def test_auth_requires_explicit_secrets_in_production(monkeypatch):
    import app.auth as auth_mod

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("DEV_SECRET_KEY", raising=False)
    monkeypatch.delenv("DEV_ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("DEV_ADMIN_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        importlib.reload(auth_mod)

    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEV_SECRET_KEY", "restored-dev-secret")
    monkeypatch.setenv("DEV_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("DEV_ADMIN_PASSWORD", "admin123")
    importlib.reload(auth_mod)
