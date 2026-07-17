from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from jose import ExpiredSignatureError, JWTError, jwt

from app import auth as auth_mod
from app.auth import create_access_token

SUBSCRIPTION_TOKEN_AUDIENCE = "email_subscription"
SUBSCRIPTION_TOKEN_TTL = timedelta(hours=1)
SUBSCRIBE_PURPOSE = "email_subscribe"
UNSUBSCRIBE_PURPOSE = "email_unsubscribe"
VALID_PURPOSES = {SUBSCRIBE_PURPOSE, UNSUBSCRIBE_PURPOSE}


class InvalidSubscriptionToken(ValueError):
    pass


class ExpiredSubscriptionToken(InvalidSubscriptionToken):
    pass


@dataclass(frozen=True)
class SubscriptionTokenPayload:
    purpose: str
    email: str
    content_types: list[str]
    topic_keys: list[str]
    series_slugs: list[str]


def issue_subscription_token(
    *,
    purpose: str,
    email: str,
    content_types: list[str],
    topic_keys: list[str],
    series_slugs: list[str],
    expires_delta: timedelta | None = None,
) -> str:
    if purpose not in VALID_PURPOSES:
        raise ValueError("Invalid subscription token purpose")
    return create_access_token(
        data={
            "sub": email,
            "scope": purpose,
            "content_types": content_types,
            "topic_keys": topic_keys,
            "series_slugs": series_slugs,
        },
        expires_delta=expires_delta or SUBSCRIPTION_TOKEN_TTL,
        audience=SUBSCRIPTION_TOKEN_AUDIENCE,
    )


def _string_list_claim(payload: dict, name: str) -> list[str]:
    value = payload.get(name)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise InvalidSubscriptionToken("Invalid subscription token payload")
    return value


def decode_subscription_token(token: str) -> SubscriptionTokenPayload:
    try:
        payload = jwt.decode(
            token,
            auth_mod.SECRET_KEY,
            algorithms=[auth_mod.ALGORITHM],
            issuer=auth_mod.TOKEN_ISSUER,
            audience=SUBSCRIPTION_TOKEN_AUDIENCE,
        )
    except ExpiredSignatureError as exc:
        raise ExpiredSubscriptionToken("Subscription confirmation link has expired") from exc
    except JWTError as exc:
        raise InvalidSubscriptionToken("Invalid subscription confirmation token") from exc

    purpose = payload.get("scope")
    email = payload.get("sub")
    if purpose not in VALID_PURPOSES or not isinstance(email, str) or not email:
        raise InvalidSubscriptionToken("Invalid subscription token payload")

    return SubscriptionTokenPayload(
        purpose=purpose,
        email=email,
        content_types=_string_list_claim(payload, "content_types"),
        topic_keys=_string_list_claim(payload, "topic_keys"),
        series_slugs=_string_list_claim(payload, "series_slugs"),
    )
