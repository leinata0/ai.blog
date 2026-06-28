"""Visitor (non-admin) JWT authentication dependencies.

Kept separate from ``app.auth`` so that the admin auth module stays free of
``models``/``db`` imports (avoiding an import cycle). Visitor tokens carry
``aud="user"`` and ``sub=str(user.id)``, while admin tokens carry ``aud="admin"``
and ``sub=<admin username>`` — the differing audiences keep the two token types
from ever being accepted by the wrong dependency.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import auth as auth_mod
from app.db import get_db
from app.models import User

user_security = HTTPBearer(auto_error=True)
optional_security = HTTPBearer(auto_error=False)


def _decode_user_id(token: str) -> int | None:
    try:
        payload = jwt.decode(
            token,
            auth_mod.SECRET_KEY,
            algorithms=[auth_mod.ALGORITHM],
            issuer=auth_mod.TOKEN_ISSUER,
            audience=auth_mod.USER_TOKEN_AUDIENCE,
        )
    except JWTError:
        return None
    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


def _resolve_active_user(token: str, db: Session) -> User | None:
    user_id = _decode_user_id(token)
    if user_id is None:
        return None
    user = db.get(User, user_id)
    if user is None or user.status == "banned":
        return None
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(user_security),
    db: Session = Depends(get_db),
) -> User:
    user = _resolve_active_user(credentials.credentials, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或会话已失效")
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_security),
    db: Session = Depends(get_db),
) -> User | None:
    if credentials is None:
        return None
    return _resolve_active_user(credentials.credentials, db)
