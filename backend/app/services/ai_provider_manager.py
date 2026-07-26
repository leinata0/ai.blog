from __future__ import annotations

import ipaddress
import json
import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session, selectinload

import app.db as db_mod
from app.encryption import (
    decrypt_value,
    encrypt_value,
    is_legacy_plaintext_value,
    uses_current_encryption_envelope,
)
from app.env import clean_env, clean_env_list, is_production_env
from app.models import AiModelInstance, AiProviderAllowedHost, AiProviderSource
from app.schema_compat import (
    ensure_ai_provider_allowlist_schema_compat,
    ensure_ai_provider_schema_compat,
)
from app.services import ai_channels
from app.url_safety import is_public_http_url, normalize_hostname

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


# --------------------------------------------------------------------------- #
# Base URL 允许列表：内置预设 ∪ 环境变量 ∪ 数据库
#
# 数据库那一份由管理后台维护（见 create_allowed_host / delete_allowed_host），这样
# 新增一个自建网关不再需要改 Render 环境变量再重新部署。环境变量那一份必须保留：
# 线上现在就靠它配着几个网关，废掉会让运行时计划立刻空掉。
#
# 白名单只回答"允许哪些主机"这一个问题，它不是 SSRF 防线。私网/保留地址的拦截在
# _validate_base_url（使用时）和 _assert_allowed_host_is_public（写入时）里，两处都
# 无视白名单强制执行 —— 白名单存的是主机名，而 DNS 是可变的：今天解析到公网的域名
# 明天可以指向 127.0.0.1。
# --------------------------------------------------------------------------- #

# 进程内缓存。_validate_base_url 会被 resolve_runtime_plan 按实例逐个调用，不缓存
# 就会把一次生成请求放大成 N 次数据库查询 + N 次 DNS 解析。TTL 很短，因为多 worker
# 部署下写操作只能失效"自己那个进程"的缓存，其余进程靠 TTL 收敛。
_ALLOWED_HOST_CACHE_TTL_SECONDS = 30.0
_PUBLIC_HOST_CACHE_TTL_SECONDS = 30.0
_PUBLIC_HOST_CACHE_MAX_ENTRIES = 512

_allowlist_cache_lock = threading.Lock()
_db_allowed_hosts_cache: tuple[float, frozenset[str]] | None = None
_public_host_cache: dict[str, tuple[float, bool]] = {}

# 单个 DNS 标签：字母数字开头结尾，中间可含连字符，最长 63。
_HOSTNAME_LABEL_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_MAX_HOSTNAME_LENGTH = 253

# 现有的开发便利：非生产环境允许 HTTP + 回环地址。生产环境下 is_production_env()
# 为真，这些例外全部失效。
_LOCAL_DEV_HOSTS = {"localhost", "127.0.0.1", "::1"}


def invalidate_allowed_base_url_host_cache() -> None:
    """清空进程内白名单/公网判定缓存。增删允许主机后立即调用，避免要重启才生效。"""
    global _db_allowed_hosts_cache
    with _allowlist_cache_lock:
        _db_allowed_hosts_cache = None
        _public_host_cache.clear()


def _read_allowed_hosts_from_db(db: Session | None) -> frozenset[str]:
    """读取管理员维护的允许主机。任何失败都退化为空集合，绝不抛出。

    读路径（resolve_runtime_plan）也走这里，而 Render 关闭了启动期 schema 同步：
    表还没建起来时必须让白名单退化为"预设 ∪ 环境变量"，而不是让整个运行时计划挂掉。
    """
    session = db
    owns_session = False
    if session is None:
        try:
            session = db_mod.SessionLocal()
            owns_session = True
        except Exception as exc:  # pragma: no cover - 只有数据库完全不可用时才会命中
            logger.warning("Could not open a session for the AI provider allowlist: %s", exc.__class__.__name__)
            return frozenset()
    try:
        # no_autoflush：调用方（update_source）可能有未 flush 的改动，白名单查询不该
        # 顺带把它们提前写出去。
        #
        # SAVEPOINT：这个 Session 多数时候是**借来的**（_validate_base_url 在
        # create_source/update_source 编辑到一半时调用）。Postgres 上一条失败的语句会把
        # 整个事务打成 aborted，之后调用方的每条语句都跟着挂 —— 而直接 rollback 借来的
        # Session 会把调用方还没提交的改动一起掀掉。所以把这次查询关进 savepoint：失败时
        # ROLLBACK TO SAVEPOINT 只清掉这条语句的影响，事务恢复可用，调用方的改动原样保留。
        # 用的是 Connection 级 begin_nested 而不是 Session.begin_nested()：后者会先 flush
        # 待写对象（no_autoflush 拦不住显式 flush），正是上面那条注释要避免的事。
        with session.no_autoflush, session.connection().begin_nested():
            rows = session.execute(select(AiProviderAllowedHost.hostname)).scalars().all()
    except Exception as exc:
        logger.warning(
            "Could not read the AI provider allowed-host table (%s); falling back to presets + environment",
            exc.__class__.__name__,
        )
        if owns_session:
            session.rollback()
        return frozenset()
    finally:
        if owns_session:
            session.close()
    return frozenset(normalize_hostname(row) for row in rows if str(row or "").strip())


def _database_allowed_base_url_hosts(db: Session | None = None) -> frozenset[str]:
    global _db_allowed_hosts_cache
    now = time.monotonic()
    with _allowlist_cache_lock:
        cached = _db_allowed_hosts_cache
        if cached is not None and cached[0] > now:
            return cached[1]
    hosts = _read_allowed_hosts_from_db(db)
    with _allowlist_cache_lock:
        _db_allowed_hosts_cache = (now + _ALLOWED_HOST_CACHE_TTL_SECONDS, hosts)
    return hosts


def _allowed_base_url_hosts(db: Session | None = None) -> set[str]:
    return (
        _default_allowed_base_url_hosts()
        | {
            normalize_hostname(value)
            for value in clean_env_list("AI_PROVIDER_ALLOWED_BASE_URL_HOSTS")
            if value
        }
        | set(_database_allowed_base_url_hosts(db))
    )


def _is_allowed_base_url_host(hostname: str, db: Session | None = None) -> bool:
    for rule in _allowed_base_url_hosts(db):
        normalized = rule.strip().lower()
        if not normalized:
            continue
        if normalized.startswith("."):
            if hostname.endswith(normalized) and hostname != normalized[1:]:
                return True
        elif hostname == normalized:
            return True
    return False


def _bracketed(hostname: str) -> str:
    """IPv6 字面量在 URL 里必须带方括号。"""
    try:
        return f"[{hostname}]" if ipaddress.ip_address(hostname).version == 6 else hostname
    except ValueError:
        return hostname


def _is_public_host(hostname: str, *, resolve_dns: bool) -> bool:
    """`url_safety.is_public_http_url` 的带缓存包装，判定逻辑完全复用上游。"""
    if not resolve_dns:
        return is_public_http_url(f"https://{_bracketed(hostname)}", resolve_dns=False)

    cache_key = hostname
    now = time.monotonic()
    with _allowlist_cache_lock:
        cached = _public_host_cache.get(cache_key)
        if cached is not None and cached[0] > now:
            return cached[1]
    verdict = is_public_http_url(f"https://{_bracketed(hostname)}", resolve_dns=True)
    with _allowlist_cache_lock:
        # 主机名来自可写的配置，缓存键数量得有个上限：满了直接清空，重建代价只是几次解析。
        if len(_public_host_cache) >= _PUBLIC_HOST_CACHE_MAX_ENTRIES:
            _public_host_cache.clear()
        _public_host_cache[cache_key] = (now + _PUBLIC_HOST_CACHE_TTL_SECONDS, verdict)
    return verdict


def _local_dev_exception(hostname: str) -> bool:
    """保留既有的本地开发例外；生产环境下永不生效。"""
    return not is_production_env() and hostname in _LOCAL_DEV_HOSTS


def _base_url_error(code: str, message: str, hostname: str) -> ai_channels.AiChannelError:
    error = ai_channels.AiChannelError(code, message, allow_failover=False)
    # 前端拿这个字段做"一键加入允许列表"。沿用 exc.attempts 的动态属性写法，
    # 免得为一个可选字段改 AiChannelError 的构造签名。
    error.rejected_hostname = hostname
    return error


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


def _validate_base_url(value: Any, *, db: Session | None = None, resolve_dns: bool = True) -> str:
    """校验 Base URL。白名单可改，私网拦截不可改。

    顺序：格式 → HTTPS → 私网字面量 → 白名单 → 私网 DNS 解析。

    第三步和第五步是两道独立的 SSRF 防线，**任何白名单条目都绕不过**。第三步不触网，
    只看字面量地址和 url_safety 的主机黑名单；第五步会解析 DNS，因为白名单存的是主机名，
    而今天解析到公网的域名明天可以指向 127.0.0.1（DNS rebinding）。只在写入时校验不够。

    把 DNS 那步放在白名单之后是为了省开销：不在白名单里的主机根本不需要解析。判定结果
    带 TTL 缓存（见 _is_public_host），resolve_runtime_plan 的循环因此不会放大成 N 次解析。
    """
    base_url = str(value or "").strip().rstrip("/")
    if not base_url:
        return ""
    parsed = urlparse(base_url)
    hostname = normalize_hostname(parsed.hostname or "")
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise ai_channels.AiChannelError(
            "invalid_base_url",
            "Base URL 必须是无用户信息的有效 HTTP(S) 地址。",
            allow_failover=False,
        )
    if parsed.scheme != "https" and not _local_dev_exception(hostname):
        raise ai_channels.AiChannelError(
            "invalid_base_url",
            "Base URL 必须使用 HTTPS；本地开发仅允许 localhost。",
            allow_failover=False,
        )
    if not _local_dev_exception(hostname) and not _is_public_host(hostname, resolve_dns=False):
        raise _base_url_error(
            "base_url_not_public",
            f"Base URL 主机 {hostname} 指向私网/保留地址或被禁止的名称，出于 SSRF 防护不允许配置。",
            hostname,
        )
    if not _is_allowed_base_url_host(hostname, db):
        raise _base_url_error(
            "base_url_not_allowed",
            f"Base URL 主机 {hostname} 不在允许列表中；请在管理后台「AI Provider · 允许主机」中添加后重试。",
            hostname,
        )
    if resolve_dns and not _local_dev_exception(hostname) and not _is_public_host(hostname, resolve_dns=True):
        raise _base_url_error(
            "base_url_not_public",
            f"Base URL 主机 {hostname} 已在允许列表中，但当前解析到私网/保留地址（或无法解析），出于 SSRF 防护已拦截。",
            hostname,
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
        base_url=_validate_base_url(payload.get("base_url") or defaults.get("base_url") or "", db=db),
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
        source.base_url = _validate_base_url(payload.get("base_url"), db=db)
    if payload.get("api_key_env_var") is not None:
        source.api_key_env_var = _validate_api_key_env_var(payload.get("api_key_env_var"))
    if payload.get("extra_json") is not None:
        source.extra_json = _json_text(payload.get("extra_json"), default="{}")
    source.base_url = _validate_base_url(source.base_url, db=db)
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


# --------------------------------------------------------------------------- #
# 管理后台维护的 Base URL 允许主机
# --------------------------------------------------------------------------- #


def normalize_allowed_host_input(value: Any) -> str:
    """把用户输入归一化成一个可比较的主机名。

    统一小写、去尾点、去端口、去用户信息。整条 URL 粘进来时**自动提取主机名**而不是
    报错 —— 用户是从服务商文档里复制 Base URL 的，报错只会让人多点一次，而提取出的
    主机名和他真正要允许的东西完全一致。

    以 ``.`` 开头的输入保留为子域规则（``.example.com``），与 _is_allowed_base_url_host
    的匹配语义一致。
    """
    raw = str(value or "").strip()
    if not raw:
        raise ai_channels.AiChannelError("invalid_hostname", "请填写主机名。", allow_failover=False)

    # 裸 IPv6 字面量（"::1"）过不了 urlparse 的 netloc 解析 —— 冒号会被当成端口分隔符。
    # 先单独认出来，否则它会以 invalid_hostname 报错，掩盖掉"这是回环地址"这个真正原因。
    literal = raw.strip("[]")
    try:
        ipaddress.ip_address(literal)
        return normalize_hostname(literal)
    except ValueError:
        pass

    # 带 scheme 的按 URL 解析；不带 scheme 的补上 "//" 让 urlparse 按 netloc 解析，
    # 否则 "example.com:8080" 会被当成 scheme。
    try:
        if "://" in raw:
            parsed = urlparse(raw)
            if parsed.scheme not in {"http", "https"}:
                raise ai_channels.AiChannelError(
                    "invalid_hostname",
                    "只支持 http(s) 地址或纯主机名。",
                    allow_failover=False,
                )
        else:
            parsed = urlparse(f"//{raw.lstrip('/')}")
        if parsed.username or parsed.password:
            raise ai_channels.AiChannelError(
                "invalid_hostname", "主机名不能包含用户信息。", allow_failover=False
            )
        hostname = normalize_hostname(parsed.hostname or "")
    except ai_channels.AiChannelError:
        raise
    except ValueError as exc:  # 非法端口、畸形 IPv6 字面量
        raise ai_channels.AiChannelError(
            "invalid_hostname", "主机名格式非法。", allow_failover=False
        ) from exc

    # urlparse 会把 ".example.com" 的前导点吃掉吗？不会 —— netloc 原样保留。但保险起见，
    # 从原始输入里把子域规则的前导点补回来。
    if raw.lstrip("/").startswith(".") and not hostname.startswith("."):
        hostname = f".{hostname}"

    if not _is_valid_hostname_shape(hostname):
        raise ai_channels.AiChannelError(
            "invalid_hostname",
            "主机名格式非法；请填写形如 gateway.example.com 或 .example.com 的主机名。",
            allow_failover=False,
        )
    return hostname


def _is_valid_hostname_shape(hostname: str) -> bool:
    if not hostname or len(hostname) > _MAX_HOSTNAME_LENGTH:
        return False
    candidate = hostname[1:] if hostname.startswith(".") else hostname
    if not candidate:
        return False
    # IP 字面量走单独分支：is_public_http_url 会判定它的地址类别，这里不该按 DNS 标签规则
    # 把 "::1" 当成格式错误 —— 那样报出来的错误码会掩盖"这是私网地址"这个真正的原因。
    try:
        ipaddress.ip_address(candidate)
        return True
    except ValueError:
        pass
    if candidate.endswith("."):
        return False
    return all(_HOSTNAME_LABEL_PATTERN.match(label) for label in candidate.split("."))


def _assert_allowed_host_is_public(hostname: str) -> None:
    """写入时的私网拦截。复用 url_safety，不另写一套判定。

    子域规则（``.example.com``）只做不触网的那一半：一条后缀规则本身没有地址可解析。
    用具体子域探针跑一遍 url_safety 的主机黑名单，就能挡住 ``.internal`` / ``.local``
    这类规则；真正解析到私网的具体主机由 _validate_base_url 在使用时拦。
    """
    if hostname.startswith("."):
        probe = f"probe{hostname}"
        if not _is_public_host(probe, resolve_dns=False):
            raise _base_url_error(
                "hostname_not_public",
                f"子域规则 {hostname} 覆盖的是保留/内网命名空间，不允许加入允许列表。",
                hostname,
            )
        return

    if not _is_public_host(hostname, resolve_dns=False):
        raise _base_url_error(
            "hostname_not_public",
            f"{hostname} 是私网/保留地址或被禁止的主机名，不允许加入允许列表。",
            hostname,
        )
    if not _is_public_host(hostname, resolve_dns=True):
        raise _base_url_error(
            "hostname_not_public",
            f"{hostname} 当前解析到私网/保留地址（或无法解析），不允许加入允许列表。",
            hostname,
        )


def _isoformat_utc(value: datetime | None) -> str:
    if value is None:
        return ""
    # SQLite 取回来的是 naive datetime；写入时用的是 UTC，这里补回时区再序列化。
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def allowed_host_to_public_dict(record: AiProviderAllowedHost) -> dict[str, Any]:
    return {
        "id": record.id,
        "hostname": record.hostname,
        "note": record.note or "",
        "created_at": _isoformat_utc(record.created_at),
    }


def list_allowed_hosts(db: Session) -> list[dict[str, Any]]:
    ensure_ai_provider_allowlist_schema_compat(db.get_bind())
    records = (
        db.execute(
            select(AiProviderAllowedHost).order_by(
                AiProviderAllowedHost.hostname.asc(), AiProviderAllowedHost.id.asc()
            )
        )
        .scalars()
        .all()
    )
    return [allowed_host_to_public_dict(record) for record in records]


def create_allowed_host(db: Session, payload: Any, *, actor: str = "") -> dict[str, Any]:
    ensure_ai_provider_allowlist_schema_compat(db.get_bind())
    payload = _payload_dict(payload)
    hostname = normalize_allowed_host_input(payload.get("hostname"))
    _assert_allowed_host_is_public(hostname)
    note = str(payload.get("note") or "").strip()[:200]

    existing = db.execute(
        select(AiProviderAllowedHost).where(AiProviderAllowedHost.hostname == hostname)
    ).scalar_one_or_none()
    if existing is not None:
        raise ai_channels.AiChannelError(
            "hostname_exists", f"{hostname} 已在允许列表中。", allow_failover=False
        )

    record = AiProviderAllowedHost(hostname=hostname, note=note)
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        # 并发下两个请求同时通过了上面的存在性检查，唯一索引兜底 —— 返回 409 而不是 500。
        db.rollback()
        raise ai_channels.AiChannelError(
            "hostname_exists", f"{hostname} 已在允许列表中。", allow_failover=False
        ) from None
    db.refresh(record)
    invalidate_allowed_base_url_host_cache()
    # 审计：后台可改就必须留痕。只记主机名和操作者，绝不碰任何 API Key。
    logger.info(
        "AI provider allowed base URL host added actor=%s hostname=%s id=%s",
        actor or "unknown",
        hostname,
        record.id,
    )
    return allowed_host_to_public_dict(record)


def _sources_using_host(db: Session, hostname: str) -> int:
    """有多少服务源的 Base URL 会被这条规则命中。"""
    rule = hostname.strip().lower()
    count = 0
    for (base_url,) in db.execute(select(AiProviderSource.base_url)).all():
        host = normalize_hostname(urlparse(str(base_url or "")).hostname or "")
        if not host:
            continue
        if rule.startswith("."):
            if host.endswith(rule) and host != rule[1:]:
                count += 1
        elif host == rule:
            count += 1
    return count


def delete_allowed_host(db: Session, host_id: int, *, actor: str = "") -> dict[str, Any]:
    """删除允许主机。

    即使还有服务源在用这个主机也照删：拦住只会把用户困在一个"改不动"的状态里
    （想换网关就得先删服务源，想删服务源又得先能保存）。响应里把受影响的服务源数量
    带回去，让后台能立刻提示"这 2 个服务源现在会被拒绝"。
    """
    ensure_ai_provider_allowlist_schema_compat(db.get_bind())
    record = db.get(AiProviderAllowedHost, host_id)
    if record is None:
        raise ai_channels.AiChannelError("not_found", "允许主机不存在。", allow_failover=False)
    hostname = record.hostname
    affected = _sources_using_host(db, hostname)
    db.delete(record)
    db.commit()
    invalidate_allowed_base_url_host_cache()
    logger.info(
        "AI provider allowed base URL host removed actor=%s hostname=%s id=%s affected_sources=%s",
        actor or "unknown",
        hostname,
        host_id,
        affected,
    )
    return {"ok": True, "hostname": hostname, "affected_sources": affected}


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


def _resolve_base_url_for_read(source: AiProviderSource, db: Session | None = None) -> str:
    """Base URL for the *read* path — never raises.

    Strict validation belongs to create/update. Applying it while building the
    runtime plan meant one record whose host fell out of
    ``AI_PROVIDER_ALLOWED_BASE_URL_HOSTS`` took down every other model as well
    as the admin views that would have shown which record was broken.

    "Never raises" is about *which* records survive, not about skipping checks:
    the SSRF layers inside ``_validate_base_url`` still run here, and a record
    that fails them drops out of the plan instead of being used.
    """
    try:
        return _validate_base_url(source.base_url, db=db)
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
    # 复用实例自己的 Session 查白名单：另开一个 Session 会在关闭时 rollback 掉调用方
    # 尚未提交的事务（SQLite 单连接下尤其致命）。
    db = object_session(instance)
    base_url = (
        _validate_base_url(source.base_url, db=db)
        if strict
        else _resolve_base_url_for_read(source, db)
    )
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
            # 前端用它做"一键加入允许列表"，和 HTTP 错误体里的字段同名。
            "rejected_hostname": getattr(exc, "rejected_hostname", ""),
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
        "base_url": _validate_base_url(source.base_url, db=db),
        # Resolve the allowlisted environment value here. Passing a mutable
        # database-supplied variable name into the legacy helper would let old
        # records bypass the provider-manager trust boundary.
        "api_key_env_var": "",
        "api_key_value": db_key or env_key,
    }
    result = ai_channels.list_models_with_config(ai_channels.TEXT_PURPOSE, config)
    result["latency_ms"] = int((time.perf_counter() - started) * 1000)
    return result
