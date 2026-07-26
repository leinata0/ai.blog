from pathlib import Path

from app.env import clean_env

UPLOADS_URL_PREFIX = "/uploads"


def _default_uploads_dir() -> Path:
    """Resolve the local uploads directory without walking past the app root.

    In the container `__file__` is /app/app/uploads.py, so parents[2] is the
    filesystem root and the old expression produced "/uploads" — a path the
    non-root appuser cannot create, while the Dockerfile actually prepares
    /app/uploads. Fall back to the package parent whenever the repo-root guess
    would escape to "/".
    """
    app_dir = Path(__file__).resolve().parent
    project_dir = app_dir.parent
    repo_dir = project_dir.parent
    if repo_dir == repo_dir.parent:  # repo_dir is the filesystem root
        return project_dir / "uploads"
    return repo_dir / "uploads"


UPLOADS_DIR = _default_uploads_dir()


def get_uploads_dir() -> Path:
    configured = clean_env("UPLOADS_DIR", "")
    if configured:
        return Path(configured).expanduser()
    return UPLOADS_DIR
