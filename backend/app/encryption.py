"""Field-level encryption for sensitive data like API keys."""

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.env import clean_env

logger = logging.getLogger(__name__)

# Versioned envelope written by ``encrypt_value``. Its presence is the signal
# that a stored value is *definitely* ciphertext, so a failed decryption can no
# longer be mistaken for "legacy plaintext" and handed to an upstream API as a
# bearer token.
ENCRYPTION_PREFIX = "fernet:v1:"
# Raw Fernet tokens always start with the urlsafe-base64 encoding of the 0x80
# version byte. Rows written before the prefix existed still look like this.
_LEGACY_FERNET_MARKER = "gAAAAA"


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
        return f"{ENCRYPTION_PREFIX}{fernet.encrypt(plaintext.encode()).decode()}"
    except Exception as exc:
        logger.error("Encryption failed: %s", exc)
        raise


def is_encrypted_value(value: str) -> bool:
    """True when the stored value is structurally ciphertext, not plaintext."""
    text = str(value or "")
    return text.startswith(ENCRYPTION_PREFIX) or text.startswith(_LEGACY_FERNET_MARKER)


def uses_current_encryption_envelope(value: str) -> bool:
    """True when the stored value carries the versioned ``fernet:v1:`` prefix."""
    return str(value or "").startswith(ENCRYPTION_PREFIX)


def is_legacy_plaintext_value(value: str) -> bool:
    """True when a stored secret predates at-rest encryption and is still plaintext.

    ``decrypt_value`` keeps passing these through on purpose — dropping the
    compatibility would brick every row written before encryption existed — which
    means a database can go on storing plaintext credentials forever with nothing
    saying so. This is the structural test the migration diagnostics count with;
    it inspects only the prefix and never the value.
    """
    text = str(value or "")
    return bool(text) and not is_encrypted_value(text)


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a stored secret.

    Fail *closed* for anything that is structurally ciphertext: after a key
    rotation the old token can no longer be decrypted, and returning it as-is
    would send ``Authorization: Bearer gAAAAAB...`` upstream while the admin UI
    still reported the credential as present and healthy. Returning an empty
    string instead makes ``has_api_key``/``is_configured`` go false so the
    broken source is visible in the console.

    Values that are neither prefixed nor Fernet-shaped are treated as legacy
    plaintext and passed through (with a warning) for backwards compatibility.
    """
    if not ciphertext:
        return ciphertext

    text = str(ciphertext)
    prefixed = text.startswith(ENCRYPTION_PREFIX)
    looks_encrypted = prefixed or text.startswith(_LEGACY_FERNET_MARKER)

    fernet = _get_fernet()
    if fernet is None:
        if looks_encrypted:
            logger.error(
                "Stored secret is encrypted but no valid encryption key is available; "
                "treating it as unusable. Restore FIELD_ENCRYPTION_KEY (or SECRET_KEY)."
            )
            return ""
        return text

    token = text[len(ENCRYPTION_PREFIX):] if prefixed else text
    try:
        return fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        if looks_encrypted:
            logger.error(
                "Failed to decrypt a stored secret (wrong or rotated encryption key); "
                "treating it as unusable so the credential reports as missing."
            )
            return ""
        logger.warning(
            "Stored secret is not encrypted (legacy plaintext row); re-save it in the "
            "admin console so it gets encrypted at rest."
        )
        return text
    except Exception as exc:
        logger.error("Decryption failed: %s", exc)
        return "" if looks_encrypted else text
