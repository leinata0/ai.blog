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

# bcrypt operates on at most 72 bytes; the schema layer also caps password length at 72.
_MAX_BYTES = 72


def _to_bytes(raw_password: str) -> bytes:
    return raw_password.encode("utf-8")[:_MAX_BYTES]


def hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(_to_bytes(raw_password), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw_password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bytes(raw_password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False
