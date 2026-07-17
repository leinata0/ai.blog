import pytest

from app.passwords import PasswordTooLongError, hash_password, verify_password


def test_valid_72_byte_utf8_password_round_trips():
    password = "密" * 24
    password_hash = hash_password(password)

    assert verify_password(password, password_hash) is True
    assert verify_password("密" * 23 + "码", password_hash) is False


def test_password_over_72_utf8_bytes_is_never_truncated():
    valid_prefix = "a" * 72
    password_hash = hash_password(valid_prefix)

    with pytest.raises(PasswordTooLongError):
        hash_password(valid_prefix + "b")
    assert verify_password(valid_prefix + "b", password_hash) is False
