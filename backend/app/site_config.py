from sqlalchemy import select
from sqlalchemy.orm import Session

from app.env import get_default_public_site_url
from app.models import SiteSettings


def resolve_public_site_url(
    db: Session,
    *,
    settings: SiteSettings | None = None,
) -> str:
    settings_obj = settings
    if settings_obj is None:
        settings_obj = db.execute(select(SiteSettings)).scalar_one_or_none()

    value = (
        (settings_obj.site_url if settings_obj and settings_obj.site_url else "")
        or get_default_public_site_url()
    )
    return value.rstrip("/")
