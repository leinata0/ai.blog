"""Field-level encryption for sensitive data like API keys."""

import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.env import clean_env, is_production_env

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet | None:
    """Get Fernet instance from environment key, or None if not configured."""
    key = clean_env("FIELD_ENCRYPTION_KEY")
    if not key:
        logger.warning("FIELD_ENCRYPTION_KEY not set; API keys will be stored in plaintext")
        return None
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        logger.error("Invalid FIELD_ENCRYPTION_KEY: %s", exc)
        return None


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value.

    In production a missing/invalid ``FIELD_ENCRYPTION_KEY`` is fatal: we refuse
    to write a secret (API key) to the database in plaintext, which would be a
    silent downgrade that looks like it succeeded. In development we fall back to
    plaintext so the app still runs without the key configured.
    """
    if not plaintext:
        return plaintext
    fernet = _get_fernet()
    if fernet is None:
        if is_production_env():
            raise RuntimeError(
                "FIELD_ENCRYPTION_KEY is not configured (or invalid); refusing to "
                "store a secret in plaintext. Set a valid Fernet key in production."
            )
        return plaintext
    try:
        return fernet.encrypt(plaintext.encode()).decode()
    except Exception as exc:
        logger.error("Encryption failed: %s", exc)
        if is_production_env():
            raise
        return plaintext


def decrypt_value(ciphertext: str) -> str:
    """Decrypt an encrypted string value. Returns ciphertext as-is if not encrypted or decryption fails."""
    if not ciphertext:
        return ciphertext
    fernet = _get_fernet()
    if fernet is None:
        return ciphertext
    try:
        return fernet.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        # Not encrypted (legacy plaintext) or wrong key
        return ciphertext
    except Exception as exc:
        logger.error("Decryption failed: %s", exc)
        return ciphertext
