"""管理后台维护的 AI Provider Base URL 允许列表。

这次改动把白名单从"只读环境变量"变成"预设 ∪ 环境变量 ∪ 数据库"，管理员可以直接
在后台加自建网关。白名单原本是唯一挡住 base_url 指向内网的东西 —— 生产强制 HTTPS
救不了 ``https://10.0.0.5/v1`` —— 所以本文件的重点不是 CRUD 好不好用，而是：

**私网拦截独立于白名单存在，任何允许列表条目都绕不过去。**

写入时拦一次不够：白名单存的是主机名，而 DNS 是可变的。今天解析到公网的域名明天可以
指向 127.0.0.1，所以使用时（_validate_base_url）必须再解析一次。
``test_allowlisted_host_resolving_to_private_is_still_blocked`` 就是这条断言。
"""

import contextlib

import pytest

from test_url_safety_vectors import install_stub_resolver

from app.models import AiProviderAllowedHost
from app.services import ai_channels, ai_provider_manager

PUBLIC_IP = "93.184.216.34"

ENDPOINT = "/api/admin/ai-provider-allowed-hosts"


@pytest.fixture(autouse=True)
def _reset_allowlist_cache():
    """白名单/DNS 判定都带进程内缓存，且是模块级全局：不清会跨测试串味。"""
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    yield
    ai_provider_manager.invalidate_allowed_base_url_host_cache()


@pytest.fixture
def public_dns(monkeypatch):
    """默认解析：所有主机都解析到公网地址。单个测试可以再覆盖。"""
    return install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP])


def _login(client):
    resp = client.post("/api/admin/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _add(client, token, hostname, note=""):
    return client.post(ENDPOINT, json={"hostname": hostname, "note": note}, headers=_auth(token))


# --------------------------------------------------------------------------- #
# 鉴权
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", ENDPOINT),
        ("POST", ENDPOINT),
        ("DELETE", f"{ENDPOINT}/1"),
    ],
)
def test_allowed_host_endpoints_require_an_admin_token(client, method, path):
    response = client.request(method, path, json={"hostname": "gw.example.org"})

    assert response.status_code in (401, 403)


def test_allowed_host_endpoints_reject_a_bogus_token(client):
    response = client.get(ENDPOINT, headers={"Authorization": "Bearer not-a-token"})

    assert response.status_code in (401, 403)


# --------------------------------------------------------------------------- #
# 增删查
# --------------------------------------------------------------------------- #


def test_create_list_and_delete_an_allowed_host(client, public_dns):
    token = _login(client)
    assert client.get(ENDPOINT, headers=_auth(token)).json() == []

    created = _add(client, token, "chybenzun.top", "自建网关")
    assert created.status_code == 201
    payload = created.json()
    assert payload["hostname"] == "chybenzun.top"
    assert payload["note"] == "自建网关"
    assert payload["id"] > 0
    # 契约要求 created_at 是带时区的 ISO 串（SQLite 取回来是 naive，序列化时补 UTC）。
    assert payload["created_at"].endswith("+00:00")

    listed = client.get(ENDPOINT, headers=_auth(token)).json()
    assert [item["hostname"] for item in listed] == ["chybenzun.top"]

    deleted = client.delete(f"{ENDPOINT}/{payload['id']}", headers=_auth(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True
    assert client.get(ENDPOINT, headers=_auth(token)).json() == []


def test_note_is_optional(client, public_dns):
    token = _login(client)

    created = client.post(ENDPOINT, json={"hostname": "wisart.kuaileshifu.com"}, headers=_auth(token))

    assert created.status_code == 201
    assert created.json()["note"] == ""


def test_adding_the_same_host_twice_conflicts(client, public_dns):
    token = _login(client)
    assert _add(client, token, "jiuuij.de5.net").status_code == 201

    duplicate = _add(client, token, "JIUUIJ.DE5.NET.")

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["error_code"] == "hostname_exists"


def test_deleting_a_missing_host_is_404(client, public_dns):
    token = _login(client)

    response = client.delete(f"{ENDPOINT}/4242", headers=_auth(token))

    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "not_found"


def test_delete_reports_how_many_sources_the_removal_breaks(client, public_dns, db_session):
    """删除不拦 —— 拦住会把用户困在"想换网关得先删服务源、想删服务源又得先能保存"的死结里。
    改成把受影响的服务源数量带回响应，让后台能直接提示。"""
    token = _login(client)
    created = _add(client, token, "ai.20110318.xyz").json()
    source = client.post(
        "/api/admin/ai-provider-sources",
        json={
            "name": "self hosted",
            "provider": "openai_compatible",
            "base_url": "https://ai.20110318.xyz/v1",
            "api_key_env_var": "GATEWAY_API_KEY",
            "api_key_value": "sk-test-1234567890",
        },
        headers=_auth(token),
    )
    assert source.status_code == 201

    deleted = client.delete(f"{ENDPOINT}/{created['id']}", headers=_auth(token))

    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True, "hostname": "ai.20110318.xyz", "affected_sources": 1}


# --------------------------------------------------------------------------- #
# 主机名归一化
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Chybenzun.TOP", "chybenzun.top"),
        ("chybenzun.top.", "chybenzun.top"),
        ("chybenzun.top:8443", "chybenzun.top"),
        # 用户多半直接把服务商文档里的 Base URL 整条粘进来：提取主机名比报错更符合直觉，
        # 提取出来的东西和他真正想允许的完全一致。
        ("https://chybenzun.top/v1/chat/completions", "chybenzun.top"),
        ("https://chybenzun.top:8443/v1", "chybenzun.top"),
        ("  chybenzun.top  ", "chybenzun.top"),
        (".example.com", ".example.com"),
    ],
)
def test_hostname_input_is_normalized(raw, expected):
    assert ai_provider_manager.normalize_allowed_host_input(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "bad_host!",
        "-leading-hyphen.example.com",
        "double..dot.example.com",
        "ftp://example.com",
        "user:pass@example.com",
        "a" * 300,
    ],
)
def test_invalid_hostname_shapes_are_rejected(raw):
    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_provider_manager.normalize_allowed_host_input(raw)

    assert exc_info.value.code == "invalid_hostname"


def test_invalid_hostname_over_http_returns_invalid_hostname(client, public_dns):
    token = _login(client)

    response = _add(client, token, "bad_host!")

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_hostname"


# --------------------------------------------------------------------------- #
# 私网拦截（写入侧）
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "hostname",
    [
        "10.0.0.5",
        "127.0.0.1",
        "192.168.1.1",
        "172.16.0.1",
        "localhost",
        "169.254.169.254",  # 云厂商元数据服务
        "metadata.google.internal",
        "[::1]",
        "::1",
        "0.0.0.0",
        "100.64.0.1",  # RFC 6598 CGNAT
        "box.local",
        "svc.internal",
    ],
)
def test_private_and_reserved_hosts_cannot_be_allowlisted(client, public_dns, hostname):
    """哪怕 DNS 桩把一切都解析成公网地址，字面量/黑名单这一层也必须先把它们挡下来。"""
    token = _login(client)

    response = _add(client, token, hostname)

    assert response.status_code == 400
    body = response.json()["detail"]
    assert body["error_code"] == "hostname_not_public"
    assert body["rejected_hostname"]


@pytest.mark.parametrize("hostname", ["0x7f.1", "2130706433", "127.1"])
def test_obfuscated_loopback_forms_are_rejected_once_resolved(client, monkeypatch, hostname):
    """``ipaddress`` 不认这些写法，但 libc 的解析器认。写入时解析 DNS 就是为了它们。"""
    install_stub_resolver(monkeypatch, lambda host, port: ["127.0.0.1"])
    token = _login(client)

    response = _add(client, token, hostname)

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "hostname_not_public"


def test_a_host_resolving_into_the_vpc_cannot_be_allowlisted(client, monkeypatch):
    install_stub_resolver(monkeypatch, lambda host, port: ["10.1.2.3"])
    token = _login(client)

    response = _add(client, token, "internal-gateway.example.org")

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "hostname_not_public"


def test_mixed_public_and_private_dns_answers_fail_closed(client, monkeypatch):
    """一条公网 + 一条私网的解析结果不能算安全：后续的解析器选择可能落到私网那条。"""
    install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP, "10.1.2.3"])
    token = _login(client)

    assert _add(client, token, "split-horizon.example.org").status_code == 400


def test_subdomain_rules_covering_reserved_namespaces_are_rejected(client, public_dns):
    token = _login(client)

    for rule in (".internal", ".local", ".localhost"):
        response = _add(client, token, rule)
        assert response.status_code == 400, rule
        assert response.json()["detail"]["error_code"] == "hostname_not_public"


# --------------------------------------------------------------------------- #
# 私网拦截（使用侧）—— 本次改动最重要的断言
# --------------------------------------------------------------------------- #


def test_allowlisted_host_resolving_to_private_is_still_blocked(client, monkeypatch, db_session):
    """主机在白名单里，但当前解析到内网 —— 必须照拦。

    这是 DNS rebinding 的核心：管理员加白名单那一刻主机指向公网，之后 DNS 记录被改成
    127.0.0.1 / 10.x，白名单里的那一行不会有任何变化。只在写入时校验等于没校验。
    """
    install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP])
    token = _login(client)
    assert _add(client, token, "rebind.example.org").status_code == 201

    # DNS 记录被改指内网，白名单一个字都没动。
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    install_stub_resolver(monkeypatch, lambda host, port: ["10.0.0.5"])

    response = client.post(
        "/api/admin/ai-provider-sources",
        json={
            "name": "rebound",
            "provider": "openai_compatible",
            "base_url": "https://rebind.example.org/v1",
            "api_key_env_var": "GATEWAY_API_KEY",
        },
        headers=_auth(token),
    )

    assert response.status_code == 400
    body = response.json()["detail"]
    assert body["error_code"] == "base_url_not_public"
    assert body["rejected_hostname"] == "rebind.example.org"
    assert ai_provider_manager._is_allowed_base_url_host("rebind.example.org", db_session) is True


def test_runtime_plan_drops_a_record_whose_host_now_resolves_privately(
    client, monkeypatch, db_session
):
    """已经存好的记录也要在使用时被拦下来，而不是被信任。"""
    from app.encryption import encrypt_value
    from app.models import AiModelInstance, AiProviderSource

    db_session.add(AiProviderAllowedHost(hostname="rebind.example.org"))
    source = AiProviderSource(
        name="rebound",
        provider="openai_compatible",
        protocol="openai",
        base_url="https://rebind.example.org/v1",
        api_key_env_var="",
        api_key_value=encrypt_value("sk-test-key"),
        enabled=True,
        extra_json="{}",
    )
    db_session.add(source)
    db_session.flush()
    db_session.add(
        AiModelInstance(
            source_id=source.id,
            name="m",
            model="m",
            purpose=ai_channels.TEXT_PURPOSE,
            capabilities_json='["text_generation"]',
            priority=1,
            enabled=True,
            is_default=True,
            extra_json="{}",
        )
    )
    db_session.commit()

    install_stub_resolver(monkeypatch, lambda host, port: [PUBLIC_IP])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    assert ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.TEXT_PURPOSE)

    install_stub_resolver(monkeypatch, lambda host, port: ["127.0.0.1"])
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert ai_provider_manager.resolve_runtime_plan(db_session, ai_channels.TEXT_PURPOSE) == []


def test_literal_private_base_url_is_blocked_even_if_the_ip_is_allowlisted(
    monkeypatch, db_session, public_dns
):
    """就算有人想办法把私网地址塞进了白名单表，使用时依然拦得住。"""
    db_session.add(AiProviderAllowedHost(hostname="10.0.0.5"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_provider_manager._validate_base_url("https://10.0.0.5/v1", db=db_session)

    assert exc_info.value.code == "base_url_not_public"
    assert exc_info.value.rejected_hostname == "10.0.0.5"


def test_localhost_stays_usable_for_local_development(db_session, public_dns):
    """非生产环境保留 http://localhost 例外（开发便利），生产环境下失效。"""
    db_session.add(AiProviderAllowedHost(hostname="localhost"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    assert (
        ai_provider_manager._validate_base_url("http://localhost:8000/v1", db=db_session)
        == "http://localhost:8000/v1"
    )


def test_localhost_exception_is_off_in_production(db_session, monkeypatch, public_dns):
    db_session.add(AiProviderAllowedHost(hostname="localhost"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(ai_channels.AiChannelError) as exc_info:
        ai_provider_manager._validate_base_url("https://localhost:8000/v1", db=db_session)

    assert exc_info.value.code == "base_url_not_public"


# --------------------------------------------------------------------------- #
# 解析顺序：预设 ∪ 环境变量 ∪ 数据库
# --------------------------------------------------------------------------- #


def test_allowlist_is_the_union_of_presets_env_and_database(db_session, monkeypatch, public_dns):
    """环境变量那一份不能废：线上现在就靠它配着几个网关。"""
    monkeypatch.setenv("AI_PROVIDER_ALLOWED_BASE_URL_HOSTS", "env-gateway.example.com")
    db_session.add(AiProviderAllowedHost(hostname="db-gateway.example.com"))
    db_session.commit()
    ai_provider_manager.invalidate_allowed_base_url_host_cache()

    hosts = ai_provider_manager._allowed_base_url_hosts(db_session)

    assert "api.siliconflow.cn" in hosts  # 内置预设
    assert "env-gateway.example.com" in hosts  # 环境变量
    assert "db-gateway.example.com" in hosts  # 数据库
    assert "unrelated.example.com" not in hosts


def test_database_entry_alone_makes_a_base_url_savable(client, public_dns):
    """原始 bug：4 个自建网关一个都不在默认白名单里，保存服务源直接报错。"""
    token = _login(client)
    rejected = client.post(
        "/api/admin/ai-provider-sources",
        json={
            "name": "self hosted",
            "provider": "openai_compatible",
            "base_url": "https://wisart.kuaileshifu.com/v1",
            "api_key_env_var": "GATEWAY_API_KEY",
        },
        headers=_auth(token),
    )
    assert rejected.status_code == 400
    body = rejected.json()["detail"]
    assert body["error_code"] == "base_url_not_allowed"
    # 前端用它做"一键加入允许列表"。
    assert body["rejected_hostname"] == "wisart.kuaileshifu.com"
    assert "AI_PROVIDER_ALLOWED_BASE_URL_HOSTS" not in body["message"]

    assert _add(client, token, "wisart.kuaileshifu.com").status_code == 201

    retried = client.post(
        "/api/admin/ai-provider-sources",
        json={
            "name": "self hosted",
            "provider": "openai_compatible",
            "base_url": "https://wisart.kuaileshifu.com/v1",
            "api_key_env_var": "GATEWAY_API_KEY",
        },
        headers=_auth(token),
    )
    assert retried.status_code == 201


def test_subdomain_rule_matches_subdomains_only(client, public_dns, db_session):
    token = _login(client)
    assert _add(client, token, ".gw.example.net").status_code == 201

    assert ai_provider_manager._is_allowed_base_url_host("edge.gw.example.net", db_session) is True
    assert ai_provider_manager._is_allowed_base_url_host("a.b.gw.example.net", db_session) is True
    # 与既有语义一致：.example 规则不匹配裸域本身。
    assert ai_provider_manager._is_allowed_base_url_host("gw.example.net", db_session) is False
    assert ai_provider_manager._is_allowed_base_url_host("gw.example.net.evil", db_session) is False


# --------------------------------------------------------------------------- #
# 缓存
# --------------------------------------------------------------------------- #


def test_a_newly_added_host_takes_effect_without_a_restart(client, public_dns, db_session):
    token = _login(client)
    assert ai_provider_manager._is_allowed_base_url_host("newgw.example.org", db_session) is False

    assert _add(client, token, "newgw.example.org").status_code == 201

    # 写操作会失效进程内缓存，不需要等 TTL 也不需要重启。
    assert ai_provider_manager._is_allowed_base_url_host("newgw.example.org", db_session) is True


def test_a_deleted_host_stops_being_allowed_immediately(client, public_dns, db_session):
    token = _login(client)
    created = _add(client, token, "temp.example.org").json()
    assert ai_provider_manager._is_allowed_base_url_host("temp.example.org", db_session) is True

    assert client.delete(f"{ENDPOINT}/{created['id']}", headers=_auth(token)).status_code == 200

    assert ai_provider_manager._is_allowed_base_url_host("temp.example.org", db_session) is False


def test_a_missing_allowlist_table_degrades_to_presets_and_env(db_session, monkeypatch, public_dns):
    """Render 关掉了启动期 schema 同步：表还没建起来时白名单必须退化，而不是抛异常。"""

    def explode(*_args, **_kwargs):
        raise RuntimeError("no such table: ai_provider_allowed_hosts")

    monkeypatch.setattr(db_session, "execute", explode)

    hosts = ai_provider_manager._allowed_base_url_hosts(db_session)

    assert "api.siliconflow.cn" in hosts
    assert "gateway.example.com" in hosts  # conftest 里的环境变量


def test_a_failed_allowlist_read_keeps_the_borrowed_session_usable(db_session, monkeypatch, public_dns):
    """查询失败时只回滚这条语句，调用方那份未提交的改动必须原样留着。

    _read_allowed_hosts_from_db 多数时候拿的是**借来的** Session（_validate_base_url 在
    create_source/update_source 编辑到一半时调用），所以既不能直接 rollback（掀掉调用方的
    改动），也不能什么都不做（Postgres 上失败语句会把事务打成 aborted）。savepoint 是唯一
    两头都顾上的做法 —— 这里断言 ROLLBACK TO SAVEPOINT 真的发出去了。
    """
    from sqlalchemy import event, select

    statements: list[str] = []
    bind = db_session.get_bind()

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(bind, "before_cursor_execute", _record)
    try:
        # 调用方编辑到一半：一条还没 flush 的改动
        db_session.add(AiProviderAllowedHost(hostname="caller-pending.example.org", note=""))

        real_execute = db_session.execute
        failing = {"on": True}

        def maybe_explode(*args, **kwargs):
            if failing["on"]:
                raise RuntimeError("no such table: ai_provider_allowed_hosts")
            return real_execute(*args, **kwargs)

        monkeypatch.setattr(db_session, "execute", maybe_explode)

        assert ai_provider_manager._read_allowed_hosts_from_db(db_session) == frozenset()

        assert any("SAVEPOINT" in statement for statement in statements)
        assert any("ROLLBACK TO SAVEPOINT" in statement for statement in statements)
        # 查询失败没有顺带把调用方的待写对象 flush 出去，也没有把它丢掉
        assert [obj.hostname for obj in db_session.new] == ["caller-pending.example.org"]

        failing["on"] = False
        db_session.commit()
        assert "caller-pending.example.org" in db_session.execute(
            select(AiProviderAllowedHost.hostname)
        ).scalars().all()
    finally:
        event.remove(bind, "before_cursor_execute", _record)


class _PostgresLikeSession:
    """把 Postgres 的事务语义缩到最小的假 Session。

    SQLite 上一条失败的语句不会影响事务，所以真实测试库复现不了这个 bug：Postgres 会把
    整个事务打成 aborted，后续每条语句都报 "current transaction is aborted"，直到包住它的
    savepoint 被回滚（或整个事务回滚）为止。
    """

    def __init__(self):
        self.aborted = False
        self.savepoint_depth = 0
        self.rolled_back_whole_transaction = False

    @property
    def no_autoflush(self):
        return contextlib.nullcontext()

    def connection(self):
        return self

    def begin_nested(self):
        session = self

        @contextlib.contextmanager
        def _savepoint():
            session.savepoint_depth += 1
            try:
                yield session
            except Exception:
                session.aborted = False  # ROLLBACK TO SAVEPOINT 清掉 aborted 态
                raise
            finally:
                session.savepoint_depth -= 1

        return _savepoint()

    def execute(self, *_args, **_kwargs):
        if self.aborted:
            raise RuntimeError("current transaction is aborted, commands ignored until end of transaction block")
        self.aborted = True
        raise RuntimeError('relation "ai_provider_allowed_hosts" does not exist')

    def rollback(self):
        self.rolled_back_whole_transaction = True
        self.aborted = False

    def close(self):  # pragma: no cover - 借来的 Session 不该被关掉
        raise AssertionError("borrowed session must not be closed")


def test_a_failed_allowlist_read_does_not_leave_a_postgres_transaction_aborted():
    """Postgres 语义下：查询失败后调用方的事务还能继续用，且没被整体回滚。"""
    session = _PostgresLikeSession()

    assert ai_provider_manager._read_allowed_hosts_from_db(session) == frozenset()

    assert session.savepoint_depth == 0
    assert session.aborted is False  # 不包 savepoint 的话这里是 True，调用方随后的 commit 全挂
    assert session.rolled_back_whole_transaction is False  # 也没掀掉调用方未提交的改动


# --------------------------------------------------------------------------- #
# 审计
# --------------------------------------------------------------------------- #


def test_add_and_remove_are_logged_with_the_actor(client, public_dns, caplog):
    token = _login(client)

    with caplog.at_level("INFO", logger="blog.ai_provider_manager"):
        created = _add(client, token, "audited.example.org", "note").json()
        client.delete(f"{ENDPOINT}/{created['id']}", headers=_auth(token))

    messages = [record.getMessage() for record in caplog.records]
    assert any("allowed base URL host added" in m and "audited.example.org" in m for m in messages)
    assert any("allowed base URL host removed" in m and "audited.example.org" in m for m in messages)
    assert all("actor=admin" in m for m in messages if "allowed base URL host" in m)
