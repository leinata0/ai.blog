"""Password hashing for the visitor user system.

Uses the ``bcrypt`` library directly. (passlib 1.7.x's bcrypt backend is broken
against bcrypt 4.x — its backend-detection probe raises on a >72 byte test hash —
and passlib is effectively unmaintained, so we call bcrypt directly.)

Kept separate from ``app.auth`` (which is pure admin JWT handling with no business
dependencies). Admin credentials remain plaintext env vars compared with
``compare_digest``; only visitor accounts are hashed here.
"""
from __future__ import annotations

import bcrypt

# bcrypt operates on at most 72 bytes. Pydantic's string length limits count
# characters rather than UTF-8 bytes, so this boundary must also be enforced here.
_MAX_BYTES = 72


class PasswordTooLongError(ValueError):
    """Raised when a password exceeds bcrypt's UTF-8 byte limit."""


def validate_password_length(raw_password: str) -> bytes:
    password_bytes = raw_password.encode("utf-8")
    if len(password_bytes) > _MAX_BYTES:
        raise PasswordTooLongError("密码的 UTF-8 编码不能超过 72 字节")
    return password_bytes


def hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(validate_password_length(raw_password), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw_password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(validate_password_length(raw_password), password_hash.encode("utf-8"))
    except (PasswordTooLongError, ValueError, TypeError):
        return False
