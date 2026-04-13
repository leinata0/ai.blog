import os


def clean_env(name: str, default: str = "") -> str:
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default

    value = raw_value.strip().replace("\r", "").replace("\n", "").replace("\t", "")

    prefix = f"{name}="
    if value.startswith(prefix):
        value = value[len(prefix):].strip()

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1].strip()

    return value or default


def normalize_database_url(value: str) -> str:
    if value.startswith("postgres://"):
        return "postgresql+psycopg://" + value[len("postgres://"):]
    if value.startswith("postgresql://"):
        return "postgresql+psycopg://" + value[len("postgresql://"):]
    return value


def get_database_url(default: str = "sqlite:///./blog.db") -> str:
    return normalize_database_url(clean_env("DATABASE_URL", default))
