"""Field-level encryption for sensitive data like API keys."""

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.env import clean_env

logger = logging.getLogger(__name__)


def _derive_fernet_key(secret: str) -> bytes:
    digest = hashlib.sha256(f"ai-blog:field-encryption:v1:{secret}".encode()).digest()
    return base64.urlsafe_b64encode(digest)


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet | None:
    """Resolve a dedicated Fernet key or derive one from the app secret."""
    key = clean_env("FIELD_ENCRYPTION_KEY")
    if key:
        try:
            return Fernet(key.encode() if isinstance(key, str) else key)
        except Exception as exc:
            logger.error("Invalid FIELD_ENCRYPTION_KEY: %s", exc)
            return None

    secret_key = clean_env("SECRET_KEY")
    if secret_key:
        logger.warning(
            "FIELD_ENCRYPTION_KEY is not set; deriving a domain-separated "
            "encryption key from SECRET_KEY"
        )
        return Fernet(_derive_fernet_key(secret_key))

    logger.error("Neither FIELD_ENCRYPTION_KEY nor SECRET_KEY is set; refusing to store secrets")
    return None


def encrypt_value(plaintext: str) -> str:
    """Encrypt a string value.

    A dedicated ``FIELD_ENCRYPTION_KEY`` is preferred. When it is absent, a
    domain-separated key derived from ``SECRET_KEY`` keeps setup automatic
    without ever falling back to plaintext storage.
    """
    if not plaintext:
        return plaintext
    fernet = _get_fernet()
    if fernet is None:
        raise RuntimeError(
            "No valid encryption key is available; refusing to store a secret "
            "in plaintext. Set FIELD_ENCRYPTION_KEY or SECRET_KEY."
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
