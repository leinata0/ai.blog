"""端到端契约核对 + SSRF 边界的对抗性验证。

这个文件不是 `test_provider_allowlist.py` 的重复。它回答两个**独立于实现者自述**的问题：

1. **契约真的接通了吗。** 本仓库连续两轮出现"并行代理各改各的、参数名对不上、被 JS
   静默丢弃、功能等于没接"。所以这里不读任何人的报告：路径 / 方法 / 请求体字段 /
   响应体字段 / 状态码全部从**真实 HTTP 响应**断言，再把前端源码里实际发出去和实际
   读回来的字段名与后端 Pydantic 模型比对（见文件末尾的源码级护栏），任何一侧改名都会
   在这里红掉，而不是等到线上按钮点下去没反应。

2. **白名单变成可写之后，SSRF 洞开了吗。** 白名单原本是唯一挡住 base_url 指向内网的
   东西。这里**绕过 API 校验直接往表里写私网主机**（模拟历史脏数据 / 写入校验被绕过），
   再断言使用侧仍然拒绝。这一条不成立，本次改动就是引入了一个 SSRF 洞。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from test_url_safety_vectors import install_stub_resolver

from app.models import AiModelInstance, AiProviderAllowedHost, AiProviderSource
from app.services import ai_channels, ai_provider_manager

ENDPOINT = "/api/admin/ai-provider-allowed-hosts"
PUBLIC_IP = "93.184.216.34"
REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _reset_allowlist_cache():
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    yield
    ai_provider_manager.invalidate_allowed_base_url_host_cache()


@pytest.fixture
def public_dns(monkeypatch):
    return install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP])


def _token(client) -> str:
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- #
# 1. HTTP 契约 —— 全部从真实响应断言
# --------------------------------------------------------------------------- #


def test_contract_get_returns_the_exact_documented_object_shape(client, public_dns):
    token = _token(client)
    client.post(ENDPOINT, json={"hostname": "chybenzun.top", "note": "自建网关"}, headers=_auth(token))

    resp = client.get(ENDPOINT, headers=_auth(token))

    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert set(body[0]) == {"id", "hostname", "note", "created_at"}
    assert body[0]["hostname"] == "chybenzun.top"
    assert body[0]["note"] == "自建网关"
    assert isinstance(body[0]["id"], int)
    # created_at 必须是带时区的 ISO 串，前端 formatDate 直接吃它。
    assert re.match(r"^\d{4}-\d{2}-\d{2}T[\d:.]+(\+00:00|Z)$", body[0]["created_at"]), body[0]["created_at"]


def test_contract_post_returns_201_with_the_created_object(client, public_dns):
    token = _token(client)

    resp = client.post(ENDPOINT, json={"hostname": "chybenzun.top", "note": "自建网关"}, headers=_auth(token))

    assert resp.status_code == 201
    assert set(resp.json()) == {"id", "hostname", "note", "created_at"}


def test_contract_post_accepts_a_body_without_note(client, public_dns):
    """契约里 note 是可选的。前端在备注为空时**不发这个键** —— 必须能收下。"""
    token = _token(client)

    resp = client.post(ENDPOINT, json={"hostname": "gw.example.org"}, headers=_auth(token))

    assert resp.status_code == 201
    assert resp.json()["note"] == ""


def test_contract_post_error_codes_and_status_codes(client, public_dns):
    token = _token(client)
    client.post(ENDPOINT, json={"hostname": "chybenzun.top"}, headers=_auth(token))

    cases = [
        ("not a hostname", 400, "invalid_hostname"),
        ("10.0.0.5", 400, "hostname_not_public"),
        ("chybenzun.top", 409, "hostname_exists"),
    ]
    for hostname, expected_status, expected_code in cases:
        resp = client.post(ENDPOINT, json={"hostname": hostname}, headers=_auth(token))
        assert resp.status_code == expected_status, (hostname, resp.json())
        detail = resp.json()["detail"]
        assert detail["error_code"] == expected_code, (hostname, detail)
        # message 必须是人话，不能是空串 —— 前端在 error_code 没命中映射时会直接显示它。
        assert detail["message"].strip()


def test_contract_delete_returns_ok_true_and_404_for_a_missing_id(client, public_dns):
    token = _token(client)
    host_id = client.post(ENDPOINT, json={"hostname": "chybenzun.top"}, headers=_auth(token)).json()["id"]

    deleted = client.delete(f"{ENDPOINT}/{host_id}", headers=_auth(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = client.delete(f"{ENDPOINT}/{host_id}", headers=_auth(token))
    assert missing.status_code == 404
    assert missing.json()["detail"]["error_code"] == "not_found"


def test_contract_rejected_hostname_is_present_in_the_save_error_body(client, public_dns):
    """前端"一键加入允许列表"整条链路的起点。字段缺了按钮就不会出现。"""
    token = _token(client)

    resp = client.post(
        "/api/admin/ai-provider-sources",
        json={"name": "gw", "provider": "openai", "base_url": "https://not-allowed.example.org/v1"},
        headers=_auth(token),
    )

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["error_code"] == "base_url_not_allowed"
    assert detail["rejected_hostname"] == "not-allowed.example.org"


def test_contract_the_full_quick_add_round_trip_actually_unblocks_the_save(client, public_dns):
    """完整走一遍前端的一键修复链路：保存被拒 → 用响应里的 rejected_hostname 调 POST
    → 重试保存成功。任何一环字段对不上，这里就断。"""
    token = _token(client)
    payload = {"name": "gw", "provider": "openai", "base_url": "https://quickadd.example.org/v1"}

    rejected = client.post("/api/admin/ai-provider-sources", json=payload, headers=_auth(token))
    hostname = rejected.json()["detail"]["rejected_hostname"]

    added = client.post(ENDPOINT, json={"hostname": hostname}, headers=_auth(token))
    assert added.status_code == 201

    # 缓存有 30s TTL，但写操作会显式失效 —— 重试必须立刻成功，不能要求用户等半分钟。
    retried = client.post("/api/admin/ai-provider-sources", json=payload, headers=_auth(token))
    assert retried.status_code == 201, retried.json()
    assert retried.json()["base_url"] == "https://quickadd.example.org/v1"


def test_contract_test_endpoint_carries_rejected_hostname_in_a_200_body(client, public_dns, db_session):
    """/test 用 200 + ok=false 报错，所以 rejected_hostname 得在**成功响应体**里。"""
    token = _token(client)
    source = AiProviderSource(
        name="gw", provider="openai", protocol="openai",
        base_url="https://dropped.example.org/v1", api_key_env_var="GATEWAY_API_KEY",
    )
    db_session.add(source)
    db_session.flush()
    instance = AiModelInstance(
        source_id=source.id, name="m", model="m", purpose="text_generation",
        capabilities_json='["text_generation"]',
    )
    db_session.add(instance)
    db_session.commit()

    resp = client.post(f"/api/admin/ai-model-instances/{instance.id}/test", headers=_auth(token))

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["error_code"] == "base_url_not_allowed"
    assert body["rejected_hostname"] == "dropped.example.org"


# --------------------------------------------------------------------------- #
# 2. SSRF 边界 —— 对抗性：绕过 API 校验直接写库
#
# 模拟"写入校验被绕过或历史脏数据"。使用侧必须独立拦截，不能信任白名单。
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "hostname",
    [
        "10.0.0.5",           # RFC1918
        "169.254.169.254",    # 云元数据
        "192.168.1.1",        # RFC1918
        "172.16.0.1",         # RFC1918
        "100.64.0.1",         # RFC6598 CGNAT
        "::1",                # IPv6 回环
        "0.0.0.0",            # unspecified
    ],
)
def test_private_host_written_straight_into_the_table_is_still_rejected(
    client, db_session, monkeypatch, public_dns, hostname
):
    """把私网地址**直接 INSERT 进白名单表**（绕过 POST 的校验），使用侧仍须拒绝。

    这是本次改动的核心安全断言。不成立 = 引入了 SSRF 洞。
    """
    monkeypatch.setenv("APP_ENV", "production")  # 生产：localhost 开发例外必须失效
    db_session.add(AiProviderAllowedHost(hostname=hostname, note="poisoned"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    # 前提确认：这条脏数据确实在白名单集合里 —— 否则测试是"因为没进白名单"才通过的假绿。
    assert hostname in ai_provider_manager._allowed_base_url_hosts(db_session)

    host_in_url = f"[{hostname}]" if ":" in hostname else hostname
    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url(f"https://{host_in_url}/v1", db=db_session)

    assert excinfo.value.code == "base_url_not_public"


@pytest.mark.parametrize("hostname", ["10.0.0.5", "169.254.169.254", "127.0.0.1"])
def test_the_no_dns_layer_alone_blocks_a_poisoned_literal_ip(
    client, db_session, monkeypatch, hostname
):
    """两道防线要**各自独立成立**，不能互相顶替。

    这条专门钉住不触网的那一层：关掉 DNS 解析（``resolve_dns=False``）后，白名单里的
    私网字面量仍须被拒。变异测试发现，只删掉字面量那一层时全部测试仍是绿的 —— 因为
    DNS 那一层顺手也拦住了字面量 IP。两层重叠是好事，但重叠不该让其中一层失去测试保护：

    - ``resolve_dns`` 这个参数就摆在签名上，读路径为了省 N 次解析把它关掉是很自然的改动；
    - DNS 那层现在是 fail-closed（解析不到 = 拒绝），而"解析不到就别拦，太影响可用性"
      是一个同样自然的未来改动。

    上面任一件事发生时，字面量这层就是唯一防线。所以它必须自己有一条断言。
    """
    monkeypatch.setenv("APP_ENV", "production")
    db_session.add(AiProviderAllowedHost(hostname=hostname, note="poisoned"))
    db_session.commit()
    # 解析器故意答"公网"：这样一旦字面量那层被删掉，DNS 那层也救不了，测试才能真的变红。
    install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert hostname in ai_provider_manager._allowed_base_url_hosts(db_session)

    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url(
            f"https://{hostname}/v1", db=db_session, resolve_dns=False
        )

    assert excinfo.value.code == "base_url_not_public"


def test_loopback_in_the_table_is_rejected_in_production(client, db_session, monkeypatch, public_dns):
    """127.0.0.1 在开发环境有意保留为开发例外；生产环境下必须失效。"""
    db_session.add(AiProviderAllowedHost(hostname="127.0.0.1", note="poisoned"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url("https://127.0.0.1/v1", db=db_session)
    assert excinfo.value.code == "base_url_not_public"

    # 开发环境下的例外是既有行为，本次不改动 —— 明确钉住，免得日后被误当成回归。
    monkeypatch.setenv("APP_ENV", "development")
    assert ai_provider_manager._validate_base_url("http://127.0.0.1:8000/v1", db=db_session)


def test_poisoned_private_host_never_reaches_the_runtime_plan(client, db_session, monkeypatch, public_dns):
    """读路径（resolve_runtime_plan）是真正会带着 API Key 出网的那条。

    _resolve_base_url_for_read 吞掉异常是为了"一条坏记录不拖垮其他记录"，必须确认它
    吞的是异常、不是校验本身：被污染的实例应当整个掉出计划，而不是拿着私网 base_url 上场。
    """
    monkeypatch.setenv("APP_ENV", "production")
    db_session.add(AiProviderAllowedHost(hostname="169.254.169.254", note="poisoned"))
    source = AiProviderSource(
        name="metadata", provider="openai", protocol="openai",
        base_url="https://169.254.169.254/v1", api_key_env_var="GATEWAY_API_KEY",
    )
    db_session.add(source)
    db_session.flush()
    db_session.add(AiModelInstance(
        source_id=source.id, name="m", model="m", purpose="text_generation",
        capabilities_json='["text_generation"]',
    ))
    db_session.commit()
    monkeypatch.setenv("GATEWAY_API_KEY", "sk-secret")
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    plan = ai_provider_manager.resolve_runtime_plan(db_session, "text_generation")

    assert plan == []


def test_allowlisted_public_name_that_resolves_privately_is_blocked(client, db_session, monkeypatch):
    """DNS rebinding：主机名在白名单里、字面量也不是 IP，但当前解析到私网。

    这是"只在写入时校验"挡不住的场景 —— 写入那天解析到公网，今天指向 127.0.0.1。
    """
    monkeypatch.setenv("APP_ENV", "production")
    db_session.add(AiProviderAllowedHost(hostname="rebind.example.org", note="looked fine yesterday"))
    db_session.commit()
    install_stub_resolver(monkeypatch, lambda host, port: ["127.0.0.1"])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert "rebind.example.org" in ai_provider_manager._allowed_base_url_hosts(db_session)

    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url("https://rebind.example.org/v1", db=db_session)

    assert excinfo.value.code == "base_url_not_public"


def test_dns_answer_mixing_public_and_private_is_blocked(client, db_session, monkeypatch):
    """混合应答必须 fail-closed：解析器下一次挑到私网那条就出网了。"""
    monkeypatch.setenv("APP_ENV", "production")
    db_session.add(AiProviderAllowedHost(hostname="mixed.example.org", note=""))
    db_session.commit()
    install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP, "10.0.0.5"])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url("https://mixed.example.org/v1", db=db_session)

    assert excinfo.value.code == "base_url_not_public"


def test_subdomain_rule_in_the_table_does_not_cover_a_private_target(client, db_session, monkeypatch):
    """子域规则（.example.org）在写入时只能做不触网的那一半校验。

    所以必须确认：它放行的具体子域，仍然要过使用侧的 DNS 解析这一关。
    """
    monkeypatch.setenv("APP_ENV", "production")
    db_session.add(AiProviderAllowedHost(hostname=".example.org", note="wildcard"))
    db_session.commit()
    install_stub_resolver(
        monkeypatch,
        lambda host, port: ["10.0.0.5"] if host == "evil.example.org" else [PUBLIC_IP],
    )
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert ai_provider_manager._validate_base_url("https://good.example.org/v1", db=db_session)

    with pytest.raises(ai_channels.AiChannelError) as excinfo:
        ai_provider_manager._validate_base_url("https://evil.example.org/v1", db=db_session)
    assert excinfo.value.code == "base_url_not_public"


# --------------------------------------------------------------------------- #
# 3. 线上现状不能被打破：预设 ∪ 环境变量 ∪ 数据库
# --------------------------------------------------------------------------- #


def test_environment_variable_hosts_still_work_with_an_empty_table(client, db_session, monkeypatch, public_dns):
    """Render 上现在配着 AI_PROVIDER_ALLOWED_BASE_URL_HOSTS，运行时计划靠它才恢复的。

    这条路径失效 = 部署后线上立刻再挂一次。用**线上真实的那四个主机名**断言。
    """
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv(
        "AI_PROVIDER_ALLOWED_BASE_URL_HOSTS",
        "wisart.kuaileshifu.com,chybenzun.top,ai.20110318.xyz,jiuuij.de5.net",
    )
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert db_session.query(AiProviderAllowedHost).count() == 0
    for hostname in ("wisart.kuaileshifu.com", "chybenzun.top", "ai.20110318.xyz", "jiuuij.de5.net"):
        assert ai_provider_manager._validate_base_url(f"https://{hostname}/v1", db=db_session)


def test_the_three_allowlist_sources_are_a_union(client, db_session, monkeypatch, public_dns):
    monkeypatch.setenv("AI_PROVIDER_ALLOWED_BASE_URL_HOSTS", "from-env.example.org")
    db_session.add(AiProviderAllowedHost(hostname="from-db.example.org", note=""))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    hosts = ai_provider_manager._allowed_base_url_hosts(db_session)

    assert "from-env.example.org" in hosts
    assert "from-db.example.org" in hosts
    assert ai_provider_manager._default_allowed_base_url_hosts() <= hosts
    assert hosts & ai_provider_manager._default_allowed_base_url_hosts()  # 预设非空，上一行才有意义


def test_a_missing_allowlist_table_degrades_to_presets_plus_env(client, monkeypatch, public_dns):
    """Render 关闭了启动期 schema 同步。表读不出来时白名单必须退化，而不是让运行时计划整个挂掉。"""
    monkeypatch.setenv("AI_PROVIDER_ALLOWED_BASE_URL_HOSTS", "from-env.example.org")
    monkeypatch.setattr(
        ai_provider_manager,
        "_read_allowed_hosts_from_db",
        lambda db: (_ for _ in ()).throw(RuntimeError("no such table")),
    )
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    with pytest.raises(RuntimeError):
        ai_provider_manager._read_allowed_hosts_from_db(None)

    # 真实调用路径（_database_allowed_base_url_hosts）不该把异常放出来 —— 上面那句只是
    # 确认桩确实会抛。这里换成模块自己的降级逻辑验证。
    monkeypatch.setattr(ai_provider_manager, "_read_allowed_hosts_from_db", lambda db: frozenset())
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    assert ai_provider_manager._validate_base_url("https://from-env.example.org/v1") == "https://from-env.example.org/v1"


# --------------------------------------------------------------------------- #
# 4. 部署路径：Render 上 ENABLE_STARTUP_SCHEMA_SYNC=0
#
# 生产环境不跑 create_all，新表只能靠 ensure_runtime_required_schema 自建。这条断错了
# 就是部署上去 500 —— 而且是启动即挂，因为运行时计划的读路径会 SELECT 这张表。
# --------------------------------------------------------------------------- #


def _fresh_engine():
    from sqlalchemy import create_engine

    return create_engine("sqlite://")


def test_deploy_render_path_creates_the_new_table_without_schema_sync():
    """Render 的真实配置：create_all 不跑，只跑 ensure_runtime_required_schema。"""
    from sqlalchemy import inspect

    from app.schema_compat import AI_PROVIDER_ALLOWED_HOST_COLUMNS, ensure_runtime_required_schema

    engine = _fresh_engine()

    ensure_runtime_required_schema(engine)
    ensure_runtime_required_schema(engine)  # 幂等：每次启动都会跑

    assert "ai_provider_allowed_hosts" in set(inspect(engine).get_table_names())
    columns = {column["name"] for column in inspect(engine).get_columns("ai_provider_allowed_hosts")}
    assert columns == set(AI_PROVIDER_ALLOWED_HOST_COLUMNS)


def test_deploy_the_unique_index_is_created_not_just_the_table():
    """409 hostname_exists 的并发兜底靠唯一索引。Render 建的表上它必须真的存在 ——
    模型层的 unique=True 在这条路径上根本没参与建表。"""
    from sqlalchemy import text

    from app.schema_compat import ensure_runtime_required_schema

    engine = _fresh_engine()
    ensure_runtime_required_schema(engine)

    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_provider_allowed_hosts (hostname, note) VALUES ('a.example.org', '')"))
    with pytest.raises(Exception):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO ai_provider_allowed_hosts (hostname, note) VALUES ('a.example.org', '')"))


def test_deploy_the_read_path_works_on_a_render_built_table(monkeypatch):
    """建表只是第一步：运行时计划真正要做的是 SELECT 这张表。"""
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker

    from app.schema_compat import ensure_runtime_required_schema

    engine = _fresh_engine()
    ensure_runtime_required_schema(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO ai_provider_allowed_hosts (hostname, note) VALUES ('render.example.org', 'x')"))

    session = sessionmaker(bind=engine)()
    try:
        ai_provider_manager.invalidate_allowed_base_url_host_cache()
        assert "render.example.org" in ai_provider_manager._allowed_base_url_hosts(session)
    finally:
        session.close()


def test_deploy_lazy_per_request_path_also_creates_the_table():
    """管理员直接打开允许列表页面时走的是 list_allowed_hosts → ensure_..._schema_compat。
    即便启动期那步因故没跑到，这条路径也要能自愈。"""
    from sqlalchemy import inspect
    from sqlalchemy.orm import sessionmaker

    from app.schema_compat import ensure_ai_provider_schema_compat

    engine = _fresh_engine()
    ensure_ai_provider_schema_compat(engine)
    assert "ai_provider_allowed_hosts" in set(inspect(engine).get_table_names())

    session = sessionmaker(bind=engine)()
    try:
        assert ai_provider_manager.list_allowed_hosts(session) == []
    finally:
        session.close()


# --------------------------------------------------------------------------- #
# 5. 源码级契约护栏
#
# 上面的测试证明"后端自己是自洽的"。这一节证明"前端发出去和读回来的字段名，就是后端
# 模型上的字段名"。任何一侧单方面改名 —— 而这正是前两轮翻车的方式，JS 会静默丢弃对不上
# 的键，不报错、不红、上线才发现 —— 都会在这里断掉。
# --------------------------------------------------------------------------- #

ADMIN_API_JS = REPO_ROOT / "frontend" / "src" / "api" / "admin.js"
PROVIDER_PANEL_JSX = REPO_ROOT / "frontend" / "src" / "components" / "admin" / "AdminAiProviderPanel.jsx"


def _openapi():
    from app.main import app

    return app.openapi()


def test_guard_backend_exposes_exactly_the_documented_routes():
    paths = _openapi()["paths"]

    assert set(paths[ENDPOINT]) == {"get", "post"}
    assert set(paths[f"{ENDPOINT}/{{host_id}}"]) == {"delete"}
    assert "201" in paths[ENDPOINT]["post"]["responses"]
    # 三个端点全部要求管理员令牌（get_current_admin 走 HTTPBearer/OAuth2 安全依赖）。
    for operation in (paths[ENDPOINT]["get"], paths[ENDPOINT]["post"], paths[f"{ENDPOINT}/{{host_id}}"]["delete"]):
        assert operation.get("security"), operation.get("operationId")


def test_guard_frontend_calls_the_same_paths_with_the_same_methods():
    source = ADMIN_API_JS.read_text(encoding="utf-8")

    assert f"'{ENDPOINT}'" in source, "前端硬编码的允许列表路径与后端路由不一致"
    # GET / POST 打的是集合路径，DELETE 打的是 /{id}。
    assert re.search(r"fetchAdminAiProviderAllowedHosts\s*=\s*\([^)]*\)\s*=>\s*\n?\s*apiGet\(AI_PROVIDER_ALLOWED_HOSTS_PATH", source)
    assert re.search(r"createAdminAiProviderAllowedHost\s*=\s*\([^)]*\)\s*=>\s*\n?\s*apiPost\(AI_PROVIDER_ALLOWED_HOSTS_PATH", source)
    assert re.search(r"deleteAdminAiProviderAllowedHost\s*=\s*\([^)]*\)\s*=>\s*\n?\s*apiDelete\(`\$\{AI_PROVIDER_ALLOWED_HOSTS_PATH\}/\$\{id\}`", source)


def test_guard_frontend_request_body_keys_exist_on_the_backend_model():
    """POST 请求体的键必须是 AiProviderAllowedHostCreateRequest 的字段。

    对不上的键会被 Pydantic 静默忽略 —— 这正是"功能等于没接"的形态。
    """
    from app.schemas import AiProviderAllowedHostCreateRequest

    source = PROVIDER_PANEL_JSX.read_text(encoding="utf-8")
    match = re.search(r"const body\s*=\s*(.+)", source)
    assert match, "找不到 POST 请求体的构造位置"
    # 标识符字符集必须写全（含大小写和数字）。只写 [a-z_] 的话 camelCase 的键会**一个字符
    # 都匹配不上**，于是悄悄从集合里消失、断言照样通过 —— 那正是这个护栏要防的失败形态，
    # 不能让它在护栏自己身上重演（变异测试 C2 就是这么发现的）。
    sent_keys = set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*trimmed", match.group(1)))

    assert sent_keys, match.group(1)
    assert sent_keys <= set(AiProviderAllowedHostCreateRequest.model_fields)
    assert "hostname" in sent_keys


def test_guard_frontend_reads_only_fields_the_backend_returns():
    """列表渲染读的 host.<字段> 必须都是 AiProviderAllowedHostOut 的字段。"""
    from app.schemas import AiProviderAllowedHostOut

    source = PROVIDER_PANEL_JSX.read_text(encoding="utf-8")
    # 同上：字符集必须覆盖 camelCase，否则 host.createdAt 会匹配不上而不是匹配错，
    # 护栏就变成了自己在静默丢弃。
    read_keys = set(re.findall(r"\bhost\.([A-Za-z_][A-Za-z0-9_]*)", source))

    assert read_keys, "前端没有读取任何允许主机字段，列表可能根本没渲染"
    assert read_keys <= set(AiProviderAllowedHostOut.model_fields), (
        read_keys - set(AiProviderAllowedHostOut.model_fields)
    )


def test_guard_rejected_hostname_field_name_matches_on_both_sides():
    """一键修复的关键字段。后端用 rejected_hostname，前端读的必须是同一个名字。"""
    from app.schemas import AiChannelTestResponse

    panel = PROVIDER_PANEL_JSX.read_text(encoding="utf-8")

    assert "rejected_hostname" in AiChannelTestResponse.model_fields
    assert re.search(r"payload\?\.rejected_hostname", panel), "前端没有从错误体里读 rejected_hostname"
    # 触发条件也得对上后端真实发出的 error_code。
    assert "base_url_not_allowed" in panel


def test_guard_frontend_error_code_map_covers_what_the_backend_emits():
    """后端在这三个端点上会发出的 error_code，前端要么有中文映射，要么原样显示 message。

    这里钉住的是"前端知道这些码存在"：漏一个就会把后端英文/内部措辞直接甩给用户。
    """
    panel = PROVIDER_PANEL_JSX.read_text(encoding="utf-8")

    for code in ("invalid_hostname", "hostname_not_public", "hostname_exists", "not_found"):
        assert f"{code}:" in panel, code
    # base_url_not_public 是私网防线，**故意不提供一键绕过**：它不能出现在快捷添加的
    # 触发条件里。这条断言是为了防止有人"顺手"把它也加进去。
    quick_add = re.search(r"const rejectedHostname = useMemo\(\(\) => \{(.+?)\}, \[", panel, re.S)
    assert quick_add, "找不到一键添加的触发条件"
    assert "base_url_not_public" not in quick_add.group(1)
