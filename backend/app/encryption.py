"""Field-level encryption for sensitive data like API keys."""

import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.env import clean_env

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet | None:
    """Get Fernet instance from environment key, or None if not configured."""
    key = clean_env("FIELD_ENCRYPTION_KEY")
    if not key:
        logger.error("FIELD_ENCRYPTION_KEY not set; refusing to store secrets")
        return None
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        logger.error("Invalid FIELD_ENCRYPTION_KEY: %s", exc)
        return None


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value.

    A missing or invalid ``FIELD_ENCRYPTION_KEY`` is always fatal. Development
    databases and backups can leak just as easily as production databases, so
    silently storing API keys in plaintext is never an acceptable fallback.
    """
    if not plaintext:
        return plaintext
    fernet = _get_fernet()
    if fernet is None:
        raise RuntimeError(
            "FIELD_ENCRYPTION_KEY is not configured (or invalid); refusing to "
            "store a secret in plaintext. Set a valid Fernet key."
        )
    try:
        return fernet.encrypt(plaintext.encode()).decode()
    except Exception as exc:
        logger.error("Encryption failed: %s", exc)
        raise


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
