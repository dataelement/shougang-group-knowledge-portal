import base64
import asyncio
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.services.portal_auth_service import PortalAuthService
from app.services.portal_unified_auth_service import (
    GROUP_GLO_URL,
    GROUP_OAUTH_BASE_URL,
    LOGIN_SYNC_PATH,
    STOCK_OAUTH_BASE_URL,
    PortalUnifiedAuthService,
    compute_login_sync_signature,
    map_unified_userinfo,
    normalize_redirect,
)
from app.settings import Settings

TRACE_PREFIX = "[portal unified auth trace] "


class FakeRuntimeService:
    def get_connection_settings(self):
        return "https://bisheng.example.com", 30.0


class FakeAuthBishengClient:
    def __init__(self, base_url: str, timeout_seconds: float, api_token: str | None = None):
        self.api_token = api_token

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/info":
            assert self.api_token in {"bisheng-token", "existing-token"}
            return {
                "status_code": 200,
                "data": {
                    "user_name": "token-user",
                    "name": "统一认证用户",
                    "department_name": "测试部门",
                },
            }
        raise AssertionError(f"Unexpected get path: {path}")

    async def post_json(self, path: str, json=None):
        raise AssertionError(f"Unexpected post path: {path}")

    async def aclose(self):
        return None


class RecordingUnifiedHttpClient:
    def __init__(
        self,
        *,
        token_payload: dict | None = None,
        userinfo_payload: dict | None = None,
        login_sync_payload: dict | None = None,
    ):
        self.token_payload = token_payload or {"access_token": "unified-token", "uid": "token-uid"}
        self.userinfo_payload = userinfo_payload or {
            "spRoleList": [],
            "mail": "zhangsan@example.com",
            "displayName": "张三",
            "loginName": "zhangs001",
            "mobile": "13800000000",
            "title": "zhangs001#stockOA,zhangs001#oa_group",
        }
        self.login_sync_payload = login_sync_payload or {"status_code": 200, "data": {"token": "bisheng-token"}}
        self.calls: list[dict] = []
        self.closed = 0

    async def post(self, url: str, params=None, data=None, content=None, headers=None):
        self.calls.append(
            {
                "method": "POST",
                "url": url,
                "params": params,
                "data": data,
                "content": content,
                "headers": headers or {},
            }
        )
        if "getToken" in url:
            return httpx.Response(200, json=self.token_payload, request=httpx.Request("POST", url))
        if LOGIN_SYNC_PATH in url:
            return httpx.Response(200, json=self.login_sync_payload, request=httpx.Request("POST", url))
        raise AssertionError(f"Unexpected post url: {url}")

    async def get(self, url: str, params=None):
        self.calls.append({"method": "GET", "url": url, "params": params})
        if "getUserInfo" in url:
            return httpx.Response(200, json=self.userinfo_payload, request=httpx.Request("GET", url))
        raise AssertionError(f"Unexpected get url: {url}")

    async def aclose(self):
        self.closed += 1


class FakeClock:
    def __init__(self, now: float = 1_700_000_000):
        self.now = now

    def __call__(self) -> float:
        return self.now


def make_settings(**overrides) -> Settings:
    defaults = {
        "unified_auth_enabled": True,
        "unified_auth_provider": "group",
        "unified_auth_client_id": "oauth-client",
        "unified_auth_client_secret": "oauth-secret",
        "unified_auth_redirect_uri": "https://portal.example.com/api/v1/auth/unified/callback",
        "unified_auth_state_secret": "state-secret",
        "unified_auth_login_sync_hmac_secret": "hmac-secret",
        "unified_auth_state_ttl_seconds": 300,
        "unified_auth_http_timeout_seconds": 5,
        "unified_auth_glo_entity_id": "entity-123",
        "unified_auth_glo_redirect_to_url": "https://portal.example.com/api/v1/auth/unified/logout/callback",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def make_auth_service() -> PortalAuthService:
    return PortalAuthService(
        runtime_service=FakeRuntimeService(),
        cookie_name="test_portal_session",
        ttl_seconds=7 * 24 * 60 * 60,
        cookie_secure=False,
        client_factory=FakeAuthBishengClient,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )


def make_unified_service(
    *,
    settings: Settings | None = None,
    http_client: RecordingUnifiedHttpClient | None = None,
    auth_service: PortalAuthService | None = None,
    clock: FakeClock | None = None,
) -> PortalUnifiedAuthService:
    return PortalUnifiedAuthService(
        settings=settings or make_settings(),
        runtime_service=FakeRuntimeService(),
        auth_service=auth_service or make_auth_service(),
        cookie_secure=False,
        http_client_factory=(lambda: http_client) if http_client else None,
        clock=clock or FakeClock(),
        nonce_factory=lambda _size: "nonce-for-test",
    )


def install_services(client: TestClient, unified_service: PortalUnifiedAuthService, auth_service: PortalAuthService):
    previous_auth = getattr(client.app.state, "portal_auth_service", None)
    previous_unified = getattr(client.app.state, "portal_unified_auth_service", None)
    client.app.state.portal_auth_service = auth_service
    client.app.state.portal_unified_auth_service = unified_service
    return previous_auth, previous_unified


def restore_services(client: TestClient, previous_auth, previous_unified) -> None:
    if previous_auth is not None:
        client.app.state.portal_auth_service = previous_auth
    if previous_unified is not None:
        client.app.state.portal_unified_auth_service = previous_unified


def parse_trace_events(output: str) -> list[dict]:
    events = []
    for line in output.splitlines():
        if line.startswith(TRACE_PREFIX):
            events.append(json.loads(line[len(TRACE_PREFIX) :]))
    return events


def decode_state_payload(state: str) -> dict:
    payload_b64 = state.split(".", 1)[0]
    padding = "=" * (-len(payload_b64) % 4)
    return json.loads(base64.urlsafe_b64decode(f"{payload_b64}{padding}"))


def test_unified_auth_public_config_disabled_is_secret_safe():
    service = make_unified_service(settings=make_settings(unified_auth_enabled=False))

    config = service.get_public_config()

    assert config.enabled is False
    assert config.provider == "group"
    assert config.unavailable_reason == "disabled"
    assert "oauth-secret" not in config.model_dump_json()
    assert "hmac-secret" not in config.model_dump_json()


def test_provider_defaults_and_custom_endpoint_override():
    group = make_unified_service(settings=make_settings(unified_auth_provider="group")).build_start("/target")
    stock = make_unified_service(settings=make_settings(unified_auth_provider="stock")).build_start("/target")
    custom = make_unified_service(
        settings=make_settings(
            unified_auth_provider="group",
            unified_auth_authorize_url="https://iam.example.com/oauth/authorize",
            unified_auth_token_url="https://iam.example.com/oauth/token",
            unified_auth_userinfo_url="https://iam.example.com/oauth/userinfo",
        )
    ).build_start("/target")

    assert group.authorize_url.startswith(f"{GROUP_OAUTH_BASE_URL}/authorize?")
    assert stock.authorize_url.startswith(f"{STOCK_OAUTH_BASE_URL}/authorize?")
    assert custom.authorize_url.startswith("https://iam.example.com/oauth/authorize?")


def test_redirect_normalizer_rejects_external_redirects():
    assert normalize_redirect("/admin?tab=users") == "/admin?tab=users"
    assert normalize_redirect("") == "/"
    assert normalize_redirect("https://evil.example.com") == "/"
    assert normalize_redirect("//evil.example.com") == "/"
    assert normalize_redirect("/ok\nSet-Cookie:bad=1") == "/"


def test_start_route_sets_state_cookie_and_authorize_params():
    auth_service = make_auth_service()
    unified_service = make_unified_service(auth_service=auth_service)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            response = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    location = response.headers["location"]
    parsed = urlparse(location)
    query = parse_qs(parsed.query)
    assert location.startswith(f"{GROUP_OAUTH_BASE_URL}/authorize?")
    assert query["client_id"] == ["oauth-client"]
    assert query["redirect_uri"] == ["https://portal.example.com/api/v1/auth/unified/callback"]
    assert query["response_type"] == ["code"]
    assert query["state"]
    set_cookie = response.headers["set-cookie"].lower()
    assert "sg_unified_auth_state=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "max-age=300" in set_cookie


def test_start_route_unavailable_returns_login_error():
    auth_service = make_auth_service()
    unified_service = make_unified_service(
        settings=make_settings(unified_auth_enabled=False),
        auth_service=auth_service,
    )
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            response = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    assert response.headers["location"] == "/login?auth_error=oauth_unavailable&redirect=%2Fadmin"


def test_unified_http_client_can_disable_tls_verification_temporarily(monkeypatch):
    created_clients = []

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            created_clients.append(kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    service = make_unified_service()

    service._make_http_client(5)
    service._make_http_client(5, verify_tls=False)

    assert created_clients[0]["verify"] is True
    assert created_clients[1]["verify"] is False


def test_callback_success_exchanges_token_userinfo_login_sync_sets_cookies(capsys):
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin?tab=users", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            response = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    assert response.headers["location"] == "/admin?tab=users"
    set_cookie = response.headers["set-cookie"]
    assert "test_portal_session=" in set_cookie
    assert "access_token_cookie=bisheng-token" in set_cookie
    assert "sg_unified_auth_state=" in set_cookie

    token_call = http_client.calls[0]
    assert token_call["method"] == "POST"
    assert token_call["params"] == {
        "client_id": "oauth-client",
        "client_secret": "oauth-secret",
        "code": "oauth-code",
        "grant_type": "authorization_code",
    }
    userinfo_call = http_client.calls[1]
    assert userinfo_call["method"] == "GET"
    assert userinfo_call["params"] == {
        "access_token": "unified-token",
        "client_id": "oauth-client",
    }
    login_sync_call = http_client.calls[2]
    body = json.loads(login_sync_call["content"].decode("utf-8"))
    assert body["source"] == "sso"
    assert body["external_user_id"] == "zhangs001"
    assert body["user_attrs"]["name"] == "张三"
    assert body["user_attrs"]["email"] == "zhangsan@example.com"
    assert body["user_attrs"]["phone"] == "13800000000"
    assert "primary_dept_external_id" not in body
    expected_signature = compute_login_sync_signature("POST", LOGIN_SYNC_PATH, login_sync_call["content"], "hmac-secret")
    assert login_sync_call["headers"]["X-Signature"] == expected_signature
    assert "[portal unified auth getUserInfo raw]" in capsys.readouterr().out


def test_unified_auth_logout_start_redirects_to_glo_and_clears_local_cookies():
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            callback = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            assert callback.status_code == 307

            response = client.get("/api/v1/auth/unified/logout/start", follow_redirects=False)
            after_logout = client.get("/api/v1/auth/me")
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    parsed = urlparse(response.headers["location"])
    query = parse_qs(parsed.query)
    assert response.headers["location"].startswith(f"{GROUP_GLO_URL}?")
    assert query["redirctToUrl"] == ["https://portal.example.com/api/v1/auth/unified/logout/callback"]
    assert query["redirectToLogin"] == ["true"]
    assert query["entityId"] == ["entity-123"]
    set_cookie = response.headers["set-cookie"].lower()
    assert "test_portal_session=" in set_cookie
    assert "access_token_cookie=" in set_cookie
    assert "sg_portal_auth_source=" in set_cookie
    assert after_logout.status_code == 401


def test_unified_auth_logout_callback_clears_local_session():
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            callback = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            assert callback.status_code == 307

            response = client.get("/api/v1/auth/unified/logout/callback", follow_redirects=False)
            after_logout = client.get("/api/v1/auth/me")
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    assert response.headers["location"] == "/login"
    assert after_logout.status_code == 401


def test_local_auth_logout_start_does_not_redirect_to_glo():
    auth_service = make_auth_service()
    unified_service = make_unified_service(auth_service=auth_service)
    local_session = asyncio.run(
        auth_service.create_session_from_access_token(
            access_token="existing-token",
            remember=True,
            fallback_account="local-user",
        )
    )
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        client.cookies.set(auth_service.cookie_name, local_session.session_id, domain="testserver.local", path="/")
        client.cookies.set("access_token_cookie", local_session.access_token, domain="testserver.local", path="/")
        try:
            response = client.get("/api/v1/auth/unified/logout/start", follow_redirects=False)
            after_logout = client.get("/api/v1/auth/me")
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    assert response.headers["location"] == "/login"
    assert GROUP_GLO_URL not in response.headers["location"]
    assert after_logout.status_code == 401


def test_unified_auth_trace_logs_full_chain_with_redaction(capsys):
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient(
        token_payload={
            "access_token": "unified-token-super-secret",
            "refresh_token": "refresh-token-super-secret",
            "uid": "token-uid",
        },
        login_sync_payload={
            "status_code": 200,
            "data": {
                "token": "bisheng-token",
                "user_id": 1001,
            },
        },
    )
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            state_payload = decode_state_payload(state)
            assert state_payload["trace_id"]
            response = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            assert response.status_code == 307
            me_response = client.get("/api/v1/auth/me")
            assert me_response.status_code == 200
        finally:
            restore_services(client, previous_auth, previous_unified)

    output = capsys.readouterr().out
    events = parse_trace_events(output)
    assert events
    trace_ids = {event.get("trace_id") for event in events if event.get("trace_id")}
    assert trace_ids == {state_payload["trace_id"]}

    stages = {event["stage"] for event in events}
    assert {
        "start",
        "callback",
        "state",
        "get_token",
        "get_userinfo",
        "mapper",
        "login_sync",
        "session",
        "auth_me",
    }.issubset(stages)

    assert any(event["stage"] == "mapper" and event["payload"]["mapped_user"]["external_user_id"] == "zhangs001" for event in events)
    assert any(event["stage"] == "auth_me" and event["payload"]["user"]["account"] == "token-user" for event in events)

    forbidden_values = [
        "oauth-secret",
        "hmac-secret",
        "unified-token-super-secret",
        "refresh-token-super-secret",
        "bisheng-token",
    ]
    for value in forbidden_values:
        assert value not in output
    assert '"redacted": true' in output


def test_unified_auth_trace_logs_failure_stage_and_safe_error(capsys):
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient(
        token_payload={"access_token": "unified-token-super-secret"},
        userinfo_payload={"displayName": "无主键用户"},
    )
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            state_payload = decode_state_payload(state)
            response = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.headers["location"] == "/login?auth_error=identity_missing&redirect=%2Fadmin"
    events = parse_trace_events(capsys.readouterr().out)
    failure_events = [event for event in events if event["stage"] == "failure"]
    assert failure_events
    assert failure_events[-1]["trace_id"] == state_payload["trace_id"]
    assert failure_events[-1]["payload"]["auth_error"] == "identity_missing"
    assert failure_events[-1]["payload"]["redirect"] == "/admin"


def test_callback_uses_form_token_param_style_when_configured():
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    unified_service = make_unified_service(
        settings=make_settings(unified_auth_token_param_style="form"),
        auth_service=auth_service,
        http_client=http_client,
    )
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            response = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.status_code == 307
    assert http_client.calls[0]["params"] is None
    assert http_client.calls[0]["data"]["grant_type"] == "authorization_code"


def test_callback_rejects_missing_and_mismatched_state_without_oauth_calls():
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            missing = client.get("/api/v1/auth/unified/callback?code=oauth-code", follow_redirects=False)
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            mismatched = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}tampered",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert missing.headers["location"] == "/login?auth_error=invalid_callback&redirect=%2F"
    assert mismatched.headers["location"] == "/login?auth_error=invalid_state&redirect=%2F"
    assert http_client.calls == []


def test_callback_rejects_expired_state_without_oauth_calls():
    auth_service = make_auth_service()
    http_client = RecordingUnifiedHttpClient()
    clock = FakeClock()
    unified_service = make_unified_service(auth_service=auth_service, http_client=http_client, clock=clock)
    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, unified_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            clock.now += 301
            response = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert response.headers["location"] == "/login?auth_error=invalid_state&redirect=%2F"
    assert http_client.calls == []


def test_callback_maps_oauth_document_errors_to_safe_login_errors():
    auth_service = make_auth_service()
    token_error_client = RecordingUnifiedHttpClient(token_payload={"errcode": "1009", "msg": "缺少参数code"})
    token_error_service = make_unified_service(auth_service=auth_service, http_client=token_error_client)
    userinfo_error_client = RecordingUnifiedHttpClient(userinfo_payload={"errcode": "2002", "msg": "token过期"})
    userinfo_error_service = make_unified_service(auth_service=auth_service, http_client=userinfo_error_client)

    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, token_error_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            token_error = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            client.cookies.clear()
            client.app.state.portal_unified_auth_service = userinfo_error_service
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            userinfo_error = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert token_error.headers["location"] == "/login?auth_error=oauth_token_failed&redirect=%2Fadmin"
    assert userinfo_error.headers["location"] == "/login?auth_error=oauth_userinfo_failed&redirect=%2Fadmin"
    assert "oauth-code" not in token_error.headers["location"]
    assert "unified-token" not in userinfo_error.headers["location"]


def test_callback_maps_missing_identity_and_login_sync_failure_to_safe_errors():
    auth_service = make_auth_service()
    missing_identity_client = RecordingUnifiedHttpClient(
        token_payload={"access_token": "unified-token"},
        userinfo_payload={"name": "无主键用户"},
    )
    invalid_account_client = RecordingUnifiedHttpClient(
        login_sync_payload={
            "status_code": 19319,
            "status_message": "SSO login account does not exist in Bisheng",
            "data": {},
        },
    )
    permission_client = RecordingUnifiedHttpClient(login_sync_payload={"status_code": 200, "data": {"token": ""}})
    missing_identity_service = make_unified_service(auth_service=auth_service, http_client=missing_identity_client)
    invalid_account_service = make_unified_service(auth_service=auth_service, http_client=invalid_account_client)
    permission_service = make_unified_service(auth_service=auth_service, http_client=permission_client)

    with TestClient(app) as client:
        previous_auth, previous_unified = install_services(client, missing_identity_service, auth_service)
        try:
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            missing_identity = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            client.cookies.clear()
            client.app.state.portal_unified_auth_service = invalid_account_service
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            invalid_account = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
            client.cookies.clear()
            client.app.state.portal_unified_auth_service = permission_service
            start = client.get("/api/v1/auth/unified/start?redirect=/admin", follow_redirects=False)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            permission_denied = client.get(
                f"/api/v1/auth/unified/callback?code=oauth-code&state={state}",
                follow_redirects=False,
            )
        finally:
            restore_services(client, previous_auth, previous_unified)

    assert missing_identity.headers["location"] == "/login?auth_error=identity_missing&redirect=%2Fadmin"
    assert invalid_account.headers["location"] == "/login?auth_error=invalid_account&redirect=%2Fadmin"
    assert permission_denied.headers["location"] == "/login?auth_error=permission_denied&redirect=%2Fadmin"


def test_mapper_prefers_login_name_and_maps_captured_userinfo_fields():
    mapped = map_unified_userinfo(
        {
            "spRoleList": [],
            "mail": "lisi@example.com",
            "displayName": "李四",
            "loginName": "lisi001",
            "mobile": "13900000000",
            "title": "lisi001#stockOA,lisi001#oa_group",
        },
        {"uid": "token-uid"},
    )

    assert mapped.external_user_id == "lisi001"
    assert mapped.user_attrs == {
        "name": "李四",
        "email": "lisi@example.com",
        "phone": "13900000000",
    }
    assert mapped.primary_dept_external_id is None


def test_mapper_supports_uid_fallback_aliases_and_department_mapping():
    mapped = map_unified_userinfo(
        {
            "userId": "u-100",
            "real_name": "李四",
            "mail": "lisi@example.com",
            "mobile": "13800000000",
            "department_id": "D-02",
        },
        {},
    )
    uid_only = map_unified_userinfo({}, {"uid": "token-only-uid"})

    assert mapped.external_user_id == "u-100"
    assert mapped.user_attrs == {
        "name": "李四",
        "email": "lisi@example.com",
        "phone": "13800000000",
    }
    assert mapped.primary_dept_external_id == "D-02"
    assert uid_only.external_user_id == "token-only-uid"
    assert uid_only.user_attrs["name"] == "token-only-uid"


def test_mapper_rejects_payload_without_stable_identifier():
    try:
        map_unified_userinfo({"name": "无主键用户"}, {})
    except ValueError as err:
        assert "stable" in str(err)
    else:
        raise AssertionError("expected mapper to reject missing stable identifier")


def test_login_sync_hmac_signature_matches_bisheng_contract():
    raw_body = b'{"external_user_id":"u-1"}'
    expected = hmac.new(
        b"hmac-secret",
        b"POST\n/api/v1/internal/sso/login-sync\n" + raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert compute_login_sync_signature("POST", LOGIN_SYNC_PATH, raw_body, "hmac-secret") == expected


def test_create_session_from_access_token_recovers_me_and_logout():
    auth_service = make_auth_service()

    session = asyncio.run(
        auth_service.create_session_from_access_token(
            access_token="bisheng-token",
            remember=True,
            fallback_account="token-uid",
        )
    )

    assert session.user.account == "token-user"
    assert session.user.name == "统一认证用户"
