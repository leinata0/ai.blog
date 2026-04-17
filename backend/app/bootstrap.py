from __future__ import annotations

from sqlalchemy.exc import OperationalError

import app.db as db_mod
from app.env import clean_env
from app.models import Post, SiteSettings
from app.schema_compat import ensure_schema_compat
from app.seed import seed_data
from app.storage import ensure_local_upload_dir, is_r2_enabled

FALSE_VALUES = {"0", "false", "no", "off"}


def env_flag(name: str, default: bool) -> bool:
    raw = clean_env(name, "")
    if raw == "":
        return default
    return raw.strip().lower() not in FALSE_VALUES


def should_enable_startup_schema_sync() -> bool:
    explicit = clean_env("ENABLE_STARTUP_SCHEMA_SYNC", "")
    if explicit != "":
        return explicit.strip().lower() not in FALSE_VALUES
    is_render_runtime = bool(clean_env("RENDER", "") or clean_env("RENDER_SERVICE_ID", ""))
    return not is_render_runtime


def initialize_runtime(*, sync_schema: bool | None = None, seed_on_empty: bool | None = None) -> None:
    effective_sync = should_enable_startup_schema_sync() if sync_schema is None else sync_schema
    effective_seed = env_flag("AUTO_SEED_ON_EMPTY", True) if seed_on_empty is None else seed_on_empty

    if not is_r2_enabled():
        ensure_local_upload_dir()

    if effective_sync:
        db_mod.Base.metadata.create_all(bind=db_mod.engine)
        ensure_schema_compat(db_mod.engine)

    try:
        with db_mod.SessionLocal() as db:
            if effective_seed and db.query(Post).count() == 0:
                seed_data(db)
            if db.query(SiteSettings).count() == 0:
                db.add(SiteSettings(id=1))
                db.commit()
    except OperationalError as exc:
        if not effective_sync:
            raise RuntimeError(
                "Database schema has not been initialized for this runtime. "
                "Run `python -m app.bootstrap` once or temporarily set ENABLE_STARTUP_SCHEMA_SYNC=1 "
                "for a single deploy."
            ) from exc
        raise


def main() -> None:
    initialize_runtime(sync_schema=True)
    print("Runtime bootstrap complete.")


if __name__ == "__main__":
    main()
