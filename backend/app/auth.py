import logging
from datetime import datetime, timedelta, timezone
from hmac import compare_digest

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.env import clean_env, is_production_env

logger = logging.getLogger(__name__)

DEFAULT_DEV_SECRET_KEY = "dev-secret-key-change-in-production"
DEFAULT_DEV_ADMIN_USERNAME = "admin"
DEFAULT_DEV_ADMIN_PASSWORD = "admin123"


def _resolve_auth_env_value(name: str, *, dev_name: str, dev_default: str) -> str:
    explicit = clean_env(name)
    if explicit:
        return explicit

    if is_production_env():
        raise RuntimeError(f"Missing required environment variable in production: {name}")

    return clean_env(dev_name, dev_default)


SECRET_KEY = _resolve_auth_env_value(
    "SECRET_KEY",
    dev_name="DEV_SECRET_KEY",
    dev_default=DEFAULT_DEV_SECRET_KEY,
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

ADMIN_USERNAME = _resolve_auth_env_value(
    "ADMIN_USERNAME",
    dev_name="DEV_ADMIN_USERNAME",
    dev_default=DEFAULT_DEV_ADMIN_USERNAME,
)
ADMIN_PASSWORD = _resolve_auth_env_value(
    "ADMIN_PASSWORD",
    dev_name="DEV_ADMIN_PASSWORD",
    dev_default=DEFAULT_DEV_ADMIN_PASSWORD,
)

if not is_production_env() and ADMIN_PASSWORD == DEFAULT_DEV_ADMIN_PASSWORD:
    logger.warning("Development admin password is using the default DEV_ADMIN_PASSWORD value.")

security = HTTPBearer()


def verify_admin(username: str, password: str) -> bool:
    return compare_digest(username, ADMIN_USERNAME) and compare_digest(password, ADMIN_PASSWORD)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None or not compare_digest(username, ADMIN_USERNAME):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
