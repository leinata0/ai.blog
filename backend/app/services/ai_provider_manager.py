from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from sqlalchemy.orm import Session, selectinload

from app.encryption import decrypt_value, encrypt_value
from app.env import clean_env
from app.models import AiModelInstance, AiProviderSource
from app.schema_compat import ensure_ai_provider_schema_compat
from app.services import ai_channels

T = TypeVar("T")


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
    env_key = clean_env(source.api_key_env_var) if source.api_key_env_var else ""
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
    env_key = clean_env(source.api_key_env_var) if source and source.api_key_env_var else ""
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
        base_url=str(payload.get("base_url") or defaults.get("base_url") or "").strip().rstrip("/"),
        api_key_env_var=str(payload.get("api_key_env_var") or defaults.get("api_key_env_var") or "AI_API_KEY").strip(),
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
    for field in ("name", "base_url", "api_key_env_var"):
        if payload.get(field) is not None:
            setattr(source, field, str(payload.get(field) or "").strip())
    if payload.get("extra_json") is not None:
        source.extra_json = _json_text(payload.get("extra_json"), default="{}")
    source.base_url = (source.base_url or "").rstrip("/")
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


def resolve_instance(instance: AiModelInstance) -> ResolvedModelProvider:
    source = instance.source
    if source is None:
        raise ai_channels.AiChannelError("invalid_channel_config", "模型实例缺少服务源。")
    db_key = decrypt_value((source.api_key_value or "").strip())
    env_key = clean_env(source.api_key_env_var) if source.api_key_env_var else ""
    api_key = db_key or env_key
    return ResolvedModelProvider(
        instance_id=instance.id,
        source_id=source.id,
        purpose=instance.purpose,
        name=instance.name,
        source_name=source.name,
        provider=source.provider,
        protocol=source.protocol,
        base_url=source.base_url,
        model=instance.model,
        api_key=api_key,
        api_key_env_var=source.api_key_env_var,
        api_key_source="db" if db_key else "env" if env_key else "missing",
        priority=instance.priority,
        is_default=instance.is_default,
        enabled=bool(source.enabled and instance.enabled),
    )


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
    plan = [resolve_instance(instance) for instance in instances if instance.source and instance.source.enabled]
    return [item for item in plan if item.is_configured]


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
    if last_error is not None:
        failure = ai_channels.AiChannelError("all_models_failed", "所有 AI 模型实例均调用失败，请检查服务源、模型和 API Key。")
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
    item = resolve_instance(instance)
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


def list_models_for_source(db: Session, source_id: int) -> dict[str, Any]:
    source = db.get(AiProviderSource, source_id)
    if source is None:
        raise ai_channels.AiChannelError("not_found", "AI 服务源不存在。")
    started = time.perf_counter()
    config = {"provider": source.provider, "base_url": source.base_url, "api_key_env_var": source.api_key_env_var, "api_key_value": decrypt_value((source.api_key_value or "").strip())}
    result = ai_channels.list_models_with_config(ai_channels.TEXT_PURPOSE, config)
    result["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return result
