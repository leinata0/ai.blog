from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar
from urllib.parse import urlparse

from sqlalchemy.orm import Session, selectinload

import app.db as db_mod
from app.encryption import (
    decrypt_value,
    encrypt_value,
    is_legacy_plaintext_value,
    uses_current_encryption_envelope,
)
from app.env import clean_env, clean_env_list, is_production_env
from app.models import AiModelInstance, AiProviderSource
from app.schema_compat import ensure_ai_provider_schema_compat
from app.services import ai_channels

logger = logging.getLogger("blog.ai_provider_manager")

T = TypeVar("T")


def _default_allowed_api_key_env_vars() -> set[str]:
    values = {
        str(preset.get("api_key_env_var") or "").strip()
        for preset in ai_channels.PROVIDER_PRESETS.values()
    }
    values.add("AI_API_KEY")
    return {value for value in values if value}


def _allowed_api_key_env_vars() -> set[str]:
    return _default_allowed_api_key_env_vars() | set(
        clean_env_list("AI_PROVIDER_ALLOWED_KEY_ENV_VARS")
    )


def _default_allowed_base_url_hosts() -> set[str]:
    hosts: set[str] = set()
    for preset in ai_channels.PROVIDER_PRESETS.values():
        parsed = urlparse(str(preset.get("base_url") or "").strip())
        if parsed.hostname:
            hosts.add(parsed.hostname.lower())
    return hosts


def _allowed_base_url_hosts() -> set[str]:
    return _default_allowed_base_url_hosts() | {
        value.lower()
        for value in clean_env_list("AI_PROVIDER_ALLOWED_BASE_URL_HOSTS")
        if value
    }


def _is_allowed_base_url_host(hostname: str) -> bool:
    for rule in _allowed_base_url_hosts():
        normalized = rule.strip().lower()
        if not normalized:
            continue
        if normalized.startswith("."):
            if hostname.endswith(normalized) and hostname != normalized[1:]:
                return True
        elif hostname == normalized:
            return True
    return False


def _validate_api_key_env_var(value: Any) -> str:
    env_var = str(value or "").strip()
    if not env_var:
        return ""
    if env_var not in _allowed_api_key_env_vars():
        raise ai_channels.AiChannelError(
            "invalid_api_key_env_var",
            "API Key 环境变量不在允许列表中；请通过 AI_PROVIDER_ALLOWED_KEY_ENV_VARS 显式配置。",
            allow_failover=False,
        )
    return env_var


def _read_allowed_api_key_env_var(value: Any) -> str:
    env_var = str(value or "").strip()
    if not env_var or env_var not in _allowed_api_key_env_vars():
        if env_var:
            logger.warning("Blocked non-allowlisted AI API key environment variable: %s", env_var)
        return ""
    return clean_env(env_var)


def _validate_base_url(value: Any) -> str:
    base_url = str(value or "").strip().rstrip("/")
    if not base_url:
        return ""
    parsed = urlparse(base_url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise ai_channels.AiChannelError(
            "invalid_base_url",
            "Base URL 必须是无用户信息的有效 HTTP(S) 地址。",
            allow_failover=False,
        )
    if parsed.scheme != "https" and (
        is_production_env() or hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ai_channels.AiChannelError(
            "invalid_base_url",
            "Base URL 必须使用 HTTPS；本地开发仅允许 localhost。",
            allow_failover=False,
        )
    if not _is_allowed_base_url_host(hostname):
        raise ai_channels.AiChannelError(
            "base_url_not_allowed",
            "Base URL 主机不在允许列表中；请通过 AI_PROVIDER_ALLOWED_BASE_URL_HOSTS 显式配置。",
            allow_failover=False,
        )
    return base_url


def _json_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(str(value or "[]") or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item).strip() for item in parsed if str(item).strip()]


def _json_text(value: Any, *, default: str = "{}") -> str:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    text = str(value).strip() or default
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        raise ai_channels.AiChannelError("invalid_json", "扩展配置必须是合法 JSON。") from exc
    return text


def _capabilities_json(value: Any, purpose: str) -> str:
    if value is None:
        values = [purpose]
    elif isinstance(value, str):
        values = [item.strip() for item in value.split(",") if item.strip()]
    elif isinstance(value, list):
        values = [str(item).strip() for item in value if str(item).strip()]
    else:
        values = [purpose]
    if purpose not in values:
        values.insert(0, purpose)
    return json.dumps(values, ensure_ascii=False)


def _mask_key(value: str) -> str:
    return ai_channels.mask_api_key(value)


def _normalize_protocol(value: Any, provider: str) -> str:
    raw = str(value or "").strip().lower()
    if raw:
        return raw
    defaults = ai_channels.provider_defaults(provider, ai_channels.TEXT_PURPOSE)
    return str(defaults.get("protocol") or ai_channels.PROTOCOL_OPENAI)


def _payload_dict(payload: Any) -> dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return dict(payload or {})


@dataclass(frozen=True)
class ResolvedModelProvider:
    instance_id: int
    source_id: int
    purpose: str
    name: str
    source_name: str
    provider: str
    protocol: str
    base_url: str
    model: str
    api_key: str
    api_key_env_var: str
    api_key_source: str
    priority: int
    is_default: bool
    enabled: bool

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key)

    @property
    def is_configured(self) -> bool:
        return self.enabled and self.has_api_key and bool(self.base_url) and bool(self.model)


def source_to_public_dict(source: AiProviderSource) -> dict[str, Any]:
    db_key = decrypt_value((source.api_key_value or "").strip())
    env_key = _read_allowed_api_key_env_var(source.api_key_env_var)
    api_key = db_key or env_key
    return {
        "id": source.id,
        "name": source.name,
        "provider": source.provider,
        "protocol": source.protocol,
        "base_url": source.base_url,
        "api_key_env_var": source.api_key_env_var,
        "has_api_key": bool(api_key),
        "api_key_source": "db" if db_key else "env" if env_key else "missing",
        "masked_api_key": _mask_key(api_key),
        "enabled": source.enabled,
        "extra_json": source.extra_json or "{}",
    }


def instance_to_public_dict(instance: AiModelInstance) -> dict[str, Any]:
    source = instance.source
    db_key = decrypt_value((source.api_key_value or "").strip()) if source else ""
    env_key = _read_allowed_api_key_env_var(source.api_key_env_var) if source else ""
    return {
        "id": instance.id,
        "source_id": instance.source_id,
        "source_name": source.name if source else "",
        "name": instance.name,
        "provider": source.provider if source else "",
        "protocol": source.protocol if source else "openai",
        "base_url": source.base_url if source else "",
        "model": instance.model,
        "purpose": instance.purpose,
        "capabilities": _json_list(instance.capabilities_json),
        "priority": instance.priority,
        "enabled": instance.enabled,
        "source_enabled": bool(source.enabled) if source else False,
        "is_default": instance.is_default,
        "is_configured": bool(source and source.enabled and instance.enabled and source.base_url and instance.model and (db_key or env_key)),
        "extra_json": instance.extra_json or "{}",
    }


def create_source(db: Session, payload: dict[str, Any]) -> AiProviderSource:
    ensure_ai_provider_schema_compat(db.get_bind())
    payload = _payload_dict(payload)
    provider = ai_channels.normalize_provider(payload.get("provider"), ai_channels.TEXT_PURPOSE)
    defaults = ai_channels.provider_defaults(provider, ai_channels.TEXT_PURPOSE)
    source = AiProviderSource(
        name=str(payload.get("name") or payload.get("provider") or provider).strip(),
        provider=provider,
        protocol=_normalize_protocol(payload.get("protocol") or defaults.get("protocol"), provider),
        base_url=_validate_base_url(payload.get("base_url") or defaults.get("base_url") or ""),
        api_key_env_var=_validate_api_key_env_var(
            payload.get("api_key_env_var") or defaults.get("api_key_env_var") or "AI_API_KEY"
        ),
        enabled=True if payload.get("enabled") is None else bool(payload.get("enabled")),
        extra_json=_json_text(payload.get("extra_json"), default="{}"),
    )
    api_key_value = str(payload.get("api_key_value") or "").strip()
    if api_key_value:
        source.api_key_value = encrypt_value(api_key_value)
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def update_source(db: Session, source_id: int, payload: dict[str, Any]) -> AiProviderSource:
    payload = _payload_dict(payload)
    source = db.get(AiProviderSource, source_id)
    if source is None:
        raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
    if payload.get("provider") is not None:
        source.provider = ai_channels.normalize_provider(payload.get("provider"), ai_channels.TEXT_PURPOSE)
    if payload.get("protocol") is not None:
        source.protocol = _normalize_protocol(payload.get("protocol"), source.provider)
    if payload.get("name") is not None:
        source.name = str(payload.get("name") or "").strip()
    if payload.get("base_url") is not None:
        source.base_url = _validate_base_url(payload.get("base_url"))
    if payload.get("api_key_env_var") is not None:
        source.api_key_env_var = _validate_api_key_env_var(payload.get("api_key_env_var"))
    if payload.get("extra_json") is not None:
        source.extra_json = _json_text(payload.get("extra_json"), default="{}")
    source.base_url = _validate_base_url(source.base_url)
    if payload.get("clear_api_key"):
        source.api_key_value = ""
    elif str(payload.get("api_key_value") or "").strip():
        source.api_key_value = encrypt_value(str(payload.get("api_key_value")).strip())
    if payload.get("enabled") is not None:
        source.enabled = bool(payload.get("enabled"))
    source.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(source)
    return source


def delete_source(db: Session, source_id: int) -> None:
    source = db.get(AiProviderSource, source_id)
    if source is None:
        raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
    db.delete(source)
    db.commit()


def create_instance(db: Session, payload: dict[str, Any]) -> AiModelInstance:
    payload = _payload_dict(payload)
    source = db.get(AiProviderSource, int(payload.get("source_id") or 0))
    if source is None:
        raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
    purpose = ai_channels.normalize_purpose(payload.get("purpose") or ai_channels.TEXT_PURPOSE)
    model = str(payload.get("model") or "").strip()
    if not model:
        raise ai_channels.AiChannelError("invalid_model", "模型实例必须填写模型名称。")
    instance = AiModelInstance(
        source_id=source.id,
        name=str(payload.get("name") or model).strip(),
        model=model,
        purpose=purpose,
        capabilities_json=_capabilities_json(payload.get("capabilities"), purpose),
        priority=int(payload.get("priority") or _next_priority(db, purpose)),
        enabled=True if payload.get("enabled") is None else bool(payload.get("enabled")),
        is_default=False if payload.get("is_default") is None else bool(payload.get("is_default")),
        extra_json=_json_text(payload.get("extra_json"), default="{}"),
    )
    db.add(instance)
    db.flush()
    if instance.is_default:
        _clear_other_defaults(db, instance)
    db.commit()
    db.refresh(instance)
    return instance


def update_instance(db: Session, instance_id: int, payload: dict[str, Any]) -> AiModelInstance:
    payload = _payload_dict(payload)
    instance = db.get(AiModelInstance, instance_id)
    if instance is None:
        raise ai_channels.AiChannelError("not_found", "AI 模型实例不存在。")
    for field in ("name", "model"):
        if payload.get(field) is not None:
            setattr(instance, field, str(payload.get(field) or "").strip())
    if payload.get("model") is not None and not instance.model:
        raise ai_channels.AiChannelError("invalid_model", "模型实例必须填写模型名称。")
    if payload.get("extra_json") is not None:
        instance.extra_json = _json_text(payload.get("extra_json"), default="{}")
    if payload.get("source_id") is not None:
        source = db.get(AiProviderSource, int(payload.get("source_id") or 0))
        if source is None:
            raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
        instance.source_id = source.id
    if payload.get("purpose") is not None:
        instance.purpose = ai_channels.normalize_purpose(payload.get("purpose"))
    if payload.get("capabilities") is not None:
        instance.capabilities_json = _capabilities_json(payload.get("capabilities"), instance.purpose)
    if payload.get("priority") is not None:
        instance.priority = int(payload.get("priority") or 1)
    if payload.get("enabled") is not None:
        instance.enabled = bool(payload.get("enabled"))
    if payload.get("is_default") is not None:
        instance.is_default = bool(payload.get("is_default"))
        if instance.is_default:
            _clear_other_defaults(db, instance)
    instance.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(instance)
    return instance


def delete_instance(db: Session, instance_id: int) -> None:
    instance = db.get(AiModelInstance, instance_id)
    if instance is None:
        raise ai_channels.AiChannelError("not_found", "AI 模型实例不存在。")
    db.delete(instance)
    db.commit()


def update_order(db: Session, purpose: str, items: list[dict[str, Any]]) -> list[AiModelInstance]:
    normalized = ai_channels.normalize_purpose(purpose)
    ids = [int(item.get("id")) for item in items if item.get("id")]
    instances = (
        db.query(AiModelInstance)
        .options(selectinload(AiModelInstance.source))
        .filter(AiModelInstance.id.in_(ids), AiModelInstance.purpose == normalized)
        .all()
        if ids
        else []
    )
    by_id = {item.id: item for item in instances}
    default_id = None
    for index, item in enumerate(items):
        inst = by_id.get(int(item.get("id") or 0))
        if inst is None:
            continue
        inst.priority = int(item.get("priority") or index + 1)
        if item.get("is_default"):
            default_id = inst.id
    if default_id is not None:
        for inst in db.query(AiModelInstance).filter(AiModelInstance.purpose == normalized).all():
            inst.is_default = inst.id == default_id
    db.commit()
    return (
        db.query(AiModelInstance)
        .options(selectinload(AiModelInstance.source))
        .filter(AiModelInstance.purpose == normalized)
        .order_by(AiModelInstance.priority.asc(), AiModelInstance.id.asc())
        .all()
    )


def _next_priority(db: Session, purpose: str) -> int:
    current = db.query(AiModelInstance).filter(AiModelInstance.purpose == purpose).count()
    return current + 1


def _clear_other_defaults(db: Session, instance: AiModelInstance) -> None:
    for other in db.query(AiModelInstance).filter(AiModelInstance.purpose == instance.purpose, AiModelInstance.id != instance.id).all():
        other.is_default = False


def _resolve_base_url_for_read(source: AiProviderSource) -> str:
    """Base URL for the *read* path — never raises.

    Strict validation belongs to create/update. Applying it while building the
    runtime plan meant one record whose host fell out of
    ``AI_PROVIDER_ALLOWED_BASE_URL_HOSTS`` took down every other model as well
    as the admin views that would have shown which record was broken.
    """
    try:
        return _validate_base_url(source.base_url)
    except ai_channels.AiChannelError as exc:
        logger.warning(
            "Skipping AI provider source with an unusable base URL source_id=%s name=%s error=%s message=%s",
            source.id,
            source.name,
            exc.code,
            exc.message,
        )
        return ""


def resolve_instance(instance: AiModelInstance, *, strict: bool = False) -> ResolvedModelProvider:
    source = instance.source
    if source is None:
        raise ai_channels.AiChannelError("invalid_channel_config", "模型实例缺少服务源。")
    db_key = decrypt_value((source.api_key_value or "").strip())
    env_key = _read_allowed_api_key_env_var(source.api_key_env_var)
    api_key = db_key or env_key
    base_url = _validate_base_url(source.base_url) if strict else _resolve_base_url_for_read(source)
    return ResolvedModelProvider(
        instance_id=instance.id,
        source_id=source.id,
        purpose=instance.purpose,
        name=instance.name,
        source_name=source.name,
        provider=source.provider,
        protocol=source.protocol,
        base_url=base_url,
        model=instance.model,
        api_key=api_key,
        api_key_env_var=source.api_key_env_var,
        api_key_source="db" if db_key else "env" if env_key else "missing",
        priority=instance.priority,
        is_default=instance.is_default,
        enabled=bool(source.enabled and instance.enabled),
    )


def instance_supports_purpose(instance: AiModelInstance, purpose: str) -> bool:
    """Honour the capability tags stored on the instance.

    ``capabilities_json`` was written and exposed but never read, so an instance
    tagged text-only could still be picked for image generation. Rows with no
    tags predate the field and stay eligible.
    """
    capabilities = _json_list(instance.capabilities_json)
    if not capabilities:
        return True
    return purpose in capabilities


def resolve_runtime_plan(db: Session, purpose: str) -> list[ResolvedModelProvider]:
    normalized = ai_channels.normalize_purpose(purpose)
    instances = (
        db.query(AiModelInstance)
        .options(selectinload(AiModelInstance.source))
        .filter(AiModelInstance.purpose == normalized, AiModelInstance.enabled == True)
        .order_by(
            AiModelInstance.is_default.desc(),
            AiModelInstance.priority.asc(),
            AiModelInstance.id.asc(),
        )
        .all()
    )
    plan: list[ResolvedModelProvider] = []
    for instance in instances:
        if not instance.source or not instance.source.enabled:
            continue
        if not instance_supports_purpose(instance, normalized):
            logger.warning(
                "Skipping AI model instance without the required capability instance_id=%s model=%s purpose=%s capabilities=%s",
                instance.id,
                instance.model,
                normalized,
                _json_list(instance.capabilities_json),
            )
            continue
        try:
            resolved = resolve_instance(instance)
        except ai_channels.AiChannelError as exc:
            # One broken record must never hide the healthy ones.
            logger.warning(
                "Skipping unresolvable AI model instance instance_id=%s error=%s message=%s",
                instance.id,
                exc.code,
                exc.message,
            )
            continue
        if not resolved.is_configured:
            logger.warning(
                "AI model instance is not usable instance_id=%s model=%s has_api_key=%s base_url=%s",
                instance.id,
                instance.model,
                resolved.has_api_key,
                bool(resolved.base_url),
            )
            continue
        plan.append(resolved)
    return plan


def runtime_plan_public(db: Session) -> dict[str, Any]:
    return {purpose: [resolved_to_public(item) for item in resolve_runtime_plan(db, purpose)] for purpose in (ai_channels.IMAGE_PURPOSE, ai_channels.TEXT_PURPOSE)}


def resolved_to_public(item: ResolvedModelProvider) -> dict[str, Any]:
    return {
        "instance_id": item.instance_id,
        "source_id": item.source_id,
        "name": item.name,
        "source_name": item.source_name,
        "purpose": item.purpose,
        "provider": item.provider,
        "protocol": item.protocol,
        "base_url": item.base_url,
        "model": item.model,
        "api_key_env_var": item.api_key_env_var,
        "api_key_source": item.api_key_source,
        "masked_api_key": _mask_key(item.api_key),
        "has_api_key": item.has_api_key,
        "priority": item.priority,
        "is_default": item.is_default,
        "enabled": item.enabled,
        "is_configured": item.is_configured,
    }


def _as_channel(item: ResolvedModelProvider) -> ai_channels.ResolvedAiChannel:
    return ai_channels.ResolvedAiChannel(
        purpose=item.purpose,
        provider=item.provider,
        base_url=item.base_url,
        model=item.model,
        api_key=item.api_key,
        api_key_env_var=item.api_key_env_var,
        api_key_source=item.api_key_source,
        enabled=item.enabled,
        db_configured=True,
        protocol=item.protocol,
    )


def _attempt(item: ResolvedModelProvider, *, ok: bool, latency_ms: int, message: str, error_code: str = "") -> dict[str, Any]:
    return {
        "target_id": str(item.instance_id),
        "priority": item.priority,
        "ok": ok,
        "provider": item.provider,
        "model": item.model,
        "api_key_source": item.api_key_source,
        "latency_ms": latency_ms,
        "message": message,
        "error_code": error_code,
    }


def run_generation(
    db: Session,
    purpose: str,
    runner: Callable[[ai_channels.ResolvedAiChannel], T],
    *,
    return_selected: bool = False,
) -> T | tuple[T, ResolvedModelProvider]:
    """Run generation across the ordered model plan with failover.

    When ``return_selected`` is True, returns ``(result, selected_provider)`` so
    callers can attribute the response to the instance that actually succeeded
    (not always plan[0]).
    """
    normalized = ai_channels.normalize_purpose(purpose)
    plan = resolve_runtime_plan(db, normalized)
    if not plan:
        raise ai_channels.AiChannelError("missing_provider_model", "请在后台 AI Provider 配置中创建可用的服务源和模型实例。")
    attempts = []
    last_error: ai_channels.AiChannelError | None = None
    for item in plan:
        started = time.perf_counter()
        try:
            result = runner(_as_channel(item))
            attempts.append(_attempt(item, ok=True, latency_ms=int((time.perf_counter() - started) * 1000), message="模型实例调用成功。"))
            if return_selected:
                return result, item
            return result
        except ai_channels.AiChannelError as exc:
            attempts.append(_attempt(item, ok=False, latency_ms=int((time.perf_counter() - started) * 1000), message=exc.message, error_code=exc.code))
            last_error = exc
            logger.warning(
                "AI model instance failed purpose=%s instance_id=%s provider=%s model=%s error=%s message=%s",
                normalized,
                item.instance_id,
                item.provider,
                item.model,
                exc.code,
                exc.message,
            )
            if not getattr(exc, "allow_failover", True):
                exc.attempts = attempts
                raise
    if last_error is not None:
        failure = ai_channels.AiChannelError(
            "all_models_failed",
            f"所有 AI 模型实例均调用失败。最后一次错误：{last_error.message}",
        )
        failure.attempts = attempts
        raise failure
    raise ai_channels.AiChannelError("missing_provider_model", "请在后台 AI Provider 配置中创建可用的服务源和模型实例。")


def test_instance(db: Session, instance_id: int) -> dict[str, Any]:
    instance = (
        db.query(AiModelInstance)
        .options(selectinload(AiModelInstance.source))
        .filter(AiModelInstance.id == instance_id)
        .first()
    )
    if instance is None:
        raise ai_channels.AiChannelError("not_found", "AI 模型实例不存在。")
    try:
        # Strict here on purpose: an explicit "test" click should name the
        # configuration problem instead of silently reporting a generic failure.
        item = resolve_instance(instance, strict=True)
    except ai_channels.AiChannelError as exc:
        return {
            "purpose": instance.purpose,
            "ok": False,
            "provider": instance.source.provider if instance.source else "",
            "model": instance.model,
            "message": exc.message,
            "error_code": exc.code,
            "latency_ms": 0,
            "attempts": [],
            "selected_target_id": "",
            "selected_priority": None,
        }
    started = time.perf_counter()
    try:
        if item.purpose == ai_channels.IMAGE_PURPOSE:
            ai_channels._generate_image_from_channel(_as_channel(item), "A small editorial test image for API connectivity.", "API connectivity test")
        else:
            ai_channels._generate_text_from_channel(_as_channel(item), [{"role": "user", "content": "请回复 OK，用于测试 API 连通性。"}])
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"purpose": item.purpose, "ok": True, "provider": item.provider, "model": item.model, "message": "AI 模型实例测试成功。", "error_code": "", "latency_ms": latency_ms, "attempts": [_attempt(item, ok=True, latency_ms=latency_ms, message="模型实例测试成功。")], "selected_target_id": str(item.instance_id), "selected_priority": item.priority}
    except ai_channels.AiChannelError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"purpose": item.purpose, "ok": False, "provider": item.provider, "model": item.model, "message": exc.message, "error_code": exc.code, "latency_ms": latency_ms, "attempts": [_attempt(item, ok=False, latency_ms=latency_ms, message=exc.message, error_code=exc.code)], "selected_target_id": "", "selected_priority": None}


# --------------------------------------------------------------------------- #
# API key at-rest diagnostics
#
# `decrypt_value` still passes unprefixed, non-Fernet-shaped values through as
# legacy plaintext, and it has to: refusing them would brick every row written
# before at-rest encryption existed. The cost is that a database can keep
# storing plaintext credentials indefinitely with nothing pointing it out — the
# local development databases have zero provider rows, so the question can only
# be answered by the deployment itself.
#
# The report below counts them, and only counts them: no key material, no
# fragment of it and not even its length ever leaves this module. Identifying a
# row needs its id and name, so that is all a caller gets.
# --------------------------------------------------------------------------- #


def _empty_api_key_encryption_report(status: str, recommendation: str) -> dict[str, Any]:
    return {
        "total_sources": 0,
        "sources_with_stored_key": 0,
        "encrypted": 0,
        "unprefixed_ciphertext": 0,
        "legacy_plaintext": 0,
        "legacy_plaintext_sources": [],
        "status": status,
        "action_required": False,
        "recommendation": recommendation,
    }


def api_key_encryption_report(db: Session) -> dict[str, Any]:
    """How many stored AI provider API keys are still unencrypted at rest.

    Exposed for an admin-only diagnostic surface (the source names identify which
    integrations exist). ``status`` is the field to read, ``recommendation`` says
    what to do:

    - ``ok``              – every stored key is ciphertext
    - ``action_required`` – at least one key is stored as plaintext
    - ``unknown``         – the table could not be read (see the safe wrapper)

    ``unprefixed_ciphertext`` counts rows encrypted before the ``fernet:v1:``
    envelope existed. They decrypt normally and are not a security problem; they
    are reported separately so a nonzero count is not mistaken for plaintext.
    """
    rows = db.query(
        AiProviderSource.id, AiProviderSource.name, AiProviderSource.api_key_value
    ).all()

    stored = 0
    encrypted = 0
    unprefixed_ciphertext = 0
    legacy_plaintext: list[dict[str, Any]] = []
    for source_id, name, raw_value in rows:
        value = str(raw_value or "").strip()
        if not value:
            continue
        stored += 1
        if uses_current_encryption_envelope(value):
            encrypted += 1
        elif is_legacy_plaintext_value(value):
            # id and name only — never the value, a prefix of it or its length.
            legacy_plaintext.append({"id": source_id, "name": str(name or "")})
        else:
            unprefixed_ciphertext += 1

    return {
        "total_sources": len(rows),
        "sources_with_stored_key": stored,
        "encrypted": encrypted,
        "unprefixed_ciphertext": unprefixed_ciphertext,
        "legacy_plaintext": len(legacy_plaintext),
        "legacy_plaintext_sources": legacy_plaintext,
        "status": "action_required" if legacy_plaintext else "ok",
        "action_required": bool(legacy_plaintext),
        "recommendation": _api_key_encryption_recommendation(
            legacy_plaintext=len(legacy_plaintext),
            unprefixed_ciphertext=unprefixed_ciphertext,
            stored=stored,
        ),
    }


def _api_key_encryption_recommendation(
    *, legacy_plaintext: int, unprefixed_ciphertext: int, stored: int
) -> str:
    if legacy_plaintext:
        return (
            f"{legacy_plaintext} of {stored} stored AI provider API key(s) are still plaintext in "
            "the database. Re-saving the source in the admin console re-encrypts it, or call "
            "ai_provider_manager.reencrypt_legacy_plaintext_api_keys(db) once to migrate all of "
            "them in place. Treat the affected credentials as exposed to anyone who has held a "
            "database backup and rotate them at the provider afterwards."
        )
    if unprefixed_ciphertext:
        return (
            f"No action needed: all {stored} stored key(s) are encrypted. "
            f"{unprefixed_ciphertext} of them were written before the fernet:v1: envelope existed; "
            "they decrypt normally and re-saving the source is only cosmetic."
        )
    if not stored:
        return (
            "No AI provider source stores an API key in the database, so nothing is at rest to "
            "encrypt. Keys resolved from environment variables are unaffected by this check."
        )
    return f"No change needed: all {stored} stored AI provider API key(s) are encrypted at rest."


def api_key_encryption_report_safe() -> dict[str, Any]:
    """`api_key_encryption_report` for callers that must not fail.

    Startup and /readyz both read this, and neither may be taken down by a
    diagnostic — a missing table on a half-migrated database would otherwise fail
    the Render health check over a purely informational count.
    """
    try:
        with db_mod.SessionLocal() as db:
            return api_key_encryption_report(db)
    except Exception as exc:
        logger.warning("Could not read AI provider key encryption state: %s", exc.__class__.__name__)
        return _empty_api_key_encryption_report(
            "unknown",
            f"Could not read the AI provider table ({exc.__class__.__name__}), so how many API "
            "keys are still stored as plaintext is unanswered. Re-check once the schema is in place.",
        )


def reencrypt_legacy_plaintext_api_keys(db: Session, *, dry_run: bool = False) -> dict[str, Any]:
    """Encrypt every AI provider API key that is still stored as plaintext.

    Idempotent — rows that already hold ciphertext are left untouched, so running
    it twice changes nothing. Deliberately **not** called at startup: rewriting a
    credentials column on every boot is not a health check's job, and a wrong
    FIELD_ENCRYPTION_KEY would turn one bad deploy into unreadable keys. Trigger
    it explicitly instead, either from a shell pointed at the target database:

        uv run --project backend python -c "import app.db as d, \
            app.services.ai_provider_manager as m; \
            print(m.reencrypt_legacy_plaintext_api_keys(d.SessionLocal()))"

    or by mounting it behind an admin-only POST route. Pass ``dry_run=True`` to
    see what it would touch without writing. Returns counts plus source ids and
    names — never key material.
    """
    sources = db.query(AiProviderSource).all()
    migrated: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unchanged = 0

    for source in sources:
        value = str(source.api_key_value or "").strip()
        if not value or not is_legacy_plaintext_value(value):
            unchanged += 1
            continue
        identity = {"id": source.id, "name": str(source.name or "")}
        if dry_run:
            migrated.append(identity)
            continue
        try:
            source.api_key_value = encrypt_value(value)
        except Exception as exc:
            # One unusable row must not block the others, and the reason must not
            # carry the value that failed to encrypt.
            failed.append({**identity, "error": exc.__class__.__name__})
            continue
        source.updated_at = datetime.now(timezone.utc)
        migrated.append(identity)

    if migrated and not dry_run:
        db.commit()
        logger.info("Re-encrypted %d legacy plaintext AI provider API key(s)", len(migrated))

    if failed:
        recommendation = (
            f"{len(failed)} source(s) could not be encrypted, most likely because no valid "
            "FIELD_ENCRYPTION_KEY or SECRET_KEY is configured. Fix the key and run this again; "
            "the rows that did migrate are already committed and will be skipped."
        )
    elif not migrated:
        recommendation = "No change needed: no AI provider API key is stored as plaintext."
    elif dry_run:
        recommendation = (
            f"{len(migrated)} plaintext key(s) would be encrypted. Re-run with dry_run=False to "
            "apply, then rotate those credentials at the provider: a plaintext row may have been "
            "readable from database backups."
        )
    else:
        recommendation = (
            f"{len(migrated)} plaintext key(s) are now encrypted at rest. Rotate them at the "
            "provider as well: the plaintext may have been readable from database backups."
        )

    return {
        "dry_run": dry_run,
        "migrated": len(migrated),
        "migrated_sources": migrated,
        "unchanged": unchanged,
        "failed": len(failed),
        "failed_sources": failed,
        "recommendation": recommendation,
    }


def list_models_for_source(db: Session, source_id: int) -> dict[str, Any]:
    source = db.get(AiProviderSource, source_id)
    if source is None:
        raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
    started = time.perf_counter()
    db_key = decrypt_value((source.api_key_value or "").strip())
    env_key = _read_allowed_api_key_env_var(source.api_key_env_var)
    config = {
        "provider": source.provider,
        "base_url": _validate_base_url(source.base_url),
        # Resolve the allowlisted environment value here. Passing a mutable
        # database-supplied variable name into the legacy helper would let old
        # records bypass the provider-manager trust boundary.
        "api_key_env_var": "",
        "api_key_value": db_key or env_key,
    }
    result = ai_channels.list_models_with_config(ai_channels.TEXT_PURPOSE, config)
    result["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return result
