from pathlib import Path

UPLOADS_URL_PREFIX = "/uploads"
UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"


def get_uploads_dir() -> Path:
    return UPLOADS_DIR
