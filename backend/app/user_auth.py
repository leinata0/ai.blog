"""Visitor (non-admin) JWT authentication dependencies.

Kept separate from ``app.auth`` so that the admin auth module stays free of
``models``/``db`` imports (avoiding an import cycle). Visitor tokens carry
``aud="user"``, ``sub=str(user.id)``, and ``ver=user.token_version``, while admin
tokens carry ``aud="admin"`` and ``sub=<admin username>``. Tokens issued before
the version claim was introduced remain valid only while the user's stored
version is zero, so the first password change also revokes those legacy tokens.
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


def _decode_user_token(token: str) -> tuple[int, int | None] | None:
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
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    token_version = payload.get("ver")
    if token_version is not None and (
        isinstance(token_version, bool) or not isinstance(token_version, int)
    ):
        return None
    return user_id, token_version


def _resolve_active_user(token: str, db: Session) -> User | None:
    token_data = _decode_user_token(token)
    if token_data is None:
        return None
    user_id, token_version = token_data
    user = db.get(User, user_id)
    if user is None or user.status == "banned":
        return None
    stored_version = user.token_version or 0
    if token_version is None:
        if stored_version != 0:
            return None
    elif token_version != stored_version:
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
    user = _resolve_active_user(credentials.credentials, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或会话已失效")
    return user
