from sqlalchemy import select
from sqlalchemy.orm import Session

from app.env import get_default_public_site_url
from app.models import SiteSettings

# Canonical production host. sitemap.xml / RSS require absolute URLs, so when neither
# SiteSettings.site_url nor PUBLIC_SITE_URL/SITE_URL is configured we must still emit a
# real origin instead of "" (which produced `<loc>/posts/x</loc>` and Search Console errors).
DEFAULT_CANONICAL_SITE_URL = "https://www.563118077.xyz"


def _absolute_or_empty(value: str | None) -> str:
    candidate = str(value or "").strip()
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate
    return ""


def resolve_public_site_url(
    db: Session,
    *,
    settings: SiteSettings | None = None,
) -> str:
    settings_obj = settings
    if settings_obj is None:
        # limit(1): a duplicated site_settings row must not turn every public page
        # into a 500 via MultipleResultsFound.
        settings_obj = db.execute(select(SiteSettings).limit(1)).scalar_one_or_none()

    value = (
        _absolute_or_empty(settings_obj.site_url if settings_obj else "")
        or _absolute_or_empty(get_default_public_site_url())
        or DEFAULT_CANONICAL_SITE_URL
    )
    return value.rstrip("/")
