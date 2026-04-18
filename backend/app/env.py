import os
from urllib.parse import urlparse


def clean_env(name: str, default: str = "") -> str:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    value = raw_value.strip().replace("\r", "").replace("\n", "").replace("\t", "")

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()

    prefix = f"{name}="
    if value.startswith(prefix):
        value = value[len(prefix):].strip()

    return value or default


def normalize_database_url(value: str) -> str:
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    return value


def get_database_url(default: str = "sqlite:///./blog.db") -> str:
    return normalize_database_url(clean_env("DATABASE_URL", default))


def env_truthy(name: str, default: bool = False) -> bool:
    value = clean_env(name)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on", "production"}


def get_app_env() -> str:
    explicit = clean_env("APP_ENV") or clean_env("ENVIRONMENT")
    if explicit:
        return explicit.lower()
    if clean_env("RENDER") or clean_env("RENDER_SERVICE_ID"):
        return "production"
    return "development"


def is_production_env() -> bool:
    return get_app_env() in {"prod", "production"}


def clean_env_list(name: str, default: list[str] | None = None) -> list[str]:
    value = clean_env(name)
    if not value:
        return list(default or [])

    items: list[str] = []
    for raw in value.replace("\n", ",").split(","):
        item = raw.strip()
        if item and item not in items:
            items.append(item)
    return items


def get_default_public_site_url() -> str:
    value = clean_env("PUBLIC_SITE_URL") or clean_env("SITE_URL")
    if value:
        return value.rstrip("/")
    if is_production_env():
        return ""
    return "http://127.0.0.1:5173"


def _expand_origin_variants(url: str) -> list[str]:
    value = str(url or "").strip().rstrip("/")
    if not value:
        return []

    try:
        parsed = urlparse(value)
    except Exception:
        return []

    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return []

    origin = f"{parsed.scheme}://{parsed.netloc}"
    origins = [origin]

    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    if host and host not in {"localhost", "127.0.0.1", "::1"}:
        if host.startswith("www."):
            origins.append(f"{parsed.scheme}://{host[4:]}{port}")
        else:
            origins.append(f"{parsed.scheme}://www.{host}{port}")

    deduped: list[str] = []
    for item in origins:
        if item and item not in deduped:
            deduped.append(item)
    return deduped


def _load_site_url_from_database() -> str:
    try:
        from sqlalchemy import text

        from app.db import SessionLocal

        with SessionLocal() as db:
            row = db.execute(
                text(
                    "SELECT site_url FROM site_settings "
                    "WHERE site_url IS NOT NULL AND TRIM(site_url) != '' "
                    "LIMIT 1"
                )
            ).first()
            if row and row[0]:
                return str(row[0]).strip().rstrip("/")
    except Exception:
        return ""
    return ""


def get_allowed_origins() -> list[str]:
    configured = clean_env_list("ALLOWED_ORIGINS")
    if configured:
        expanded: list[str] = []
        for item in configured:
            variants = _expand_origin_variants(item)
            if variants:
                expanded.extend(variants)
            elif item not in expanded:
                expanded.append(item)
        return list(dict.fromkeys(expanded))

    default_site_url = get_default_public_site_url()
    derived_origins = _expand_origin_variants(default_site_url)
    if not derived_origins and is_production_env():
        derived_origins = _expand_origin_variants(_load_site_url_from_database())

    if is_production_env():
        return derived_origins

    defaults = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    for item in derived_origins:
        if item not in defaults:
            defaults.append(item)
    return defaults
