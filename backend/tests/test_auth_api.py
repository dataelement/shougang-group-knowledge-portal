import asyncio
import json
import time

from app.main import app
from app.schemas.auth import PortalUserView
from app.services.portal_auth_service import PortalAuthError, PortalAuthService, RedisPortalSessionStore
from fastapi.testclient import TestClient


class FakeRuntimeService:
    def get_connection_settings(self):
        return "http://bisheng.example.com", 30.0


class FakeAuthBishengClient:
    login_payload = None

    def __init__(self, base_url: str, timeout_seconds: float, api_token: str | None = None):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/get_captcha":
            return {
                "status_code": 200,
                "data": {
                    "captcha_key": "captcha-demo",
                    "user_capthca": False,
                },
            }
        if path == "/api/v1/user/public_key":
            return {"status_code": 200, "data": {"public_key": "fake-public-key"}}
        if path == "/api/v1/user/info":
            assert self.api_token in {"user-token", "existing-token"}
            return {
                "status_code": 200,
                "data": {
                    "user_name": "bisheng-user",
                    "name": "王工",
                    "department_name": "设备管理部",
                    "is_department_admin": True,
                },
            }
        raise AssertionError(f"Unexpected get path: {path}")

    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            FakeAuthBishengClient.login_payload = json
            return {"status_code": 200, "data": {"access_token": "user-token"}}
        raise AssertionError(f"Unexpected post path: {path}")

    async def aclose(self):
        return None


class FakeAuthFailureBishengClient(FakeAuthBishengClient):
    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            return {
                "status_code": 401,
                "status_message": "Invalid username or password",
                "data": {},
            }
        raise AssertionError(f"Unexpected post path: {path}")


class FakeAuthConflictBishengClient(FakeAuthBishengClient):
    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            FakeAuthBishengClient.login_payload = json
            return {
                "status_code": 10612,
                "status_message": "该用户已在其它设备登录，是否继续登录？",
                "data": {},
            }
        raise AssertionError(f"Unexpected post path: {path}")


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}

    async def get(self, name: str):
        return self.values.get(name)

    async def set(self, name: str, value: str, ex: int):
        self.values[name] = value
        return True

    async def delete(self, *names: str):
        for name in names:
            self.values.pop(name, None)
        return len(names)


class FailingRedis(FakeRedis):
    async def set(self, name: str, value: str, ex: int):
        from redis.exceptions import ConnectionError

        raise ConnectionError("unavailable")


def make_auth_service() -> PortalAuthService:
    return PortalAuthService(
        runtime_service=FakeRuntimeService(),
        cookie_name="test_portal_session",
        ttl_seconds=7 * 24 * 60 * 60,
        cookie_secure=False,
        client_factory=FakeAuthBishengClient,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )


def make_failing_auth_service() -> PortalAuthService:
    return PortalAuthService(
        runtime_service=FakeRuntimeService(),
        cookie_name="test_portal_session",
        ttl_seconds=7 * 24 * 60 * 60,
        cookie_secure=False,
        client_factory=FakeAuthFailureBishengClient,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )


def make_conflict_auth_service() -> PortalAuthService:
    return PortalAuthService(
        runtime_service=FakeRuntimeService(),
        cookie_name="test_portal_session",
        ttl_seconds=7 * 24 * 60 * 60,
        cookie_secure=False,
        client_factory=FakeAuthConflictBishengClient,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )


def test_login_me_logout_roundtrip_sets_httponly_session_cookie():
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = make_auth_service()
        try:
            login_response = client.post(
                "/api/v1/auth/login",
                json={"account": "bisheng-user", "password": "secret", "remember": True},
            )
            me_response = client.get("/api/v1/auth/me")
            logout_response = client.post("/api/v1/auth/logout")
            after_logout_response = client.get("/api/v1/auth/me")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert login_response.status_code == 200
    assert "httponly" in login_response.headers["set-cookie"].lower()
    assert FakeAuthBishengClient.login_payload == {
        "user_name": "bisheng-user",
        "password": "encrypted-secret",
        "captcha_key": "captcha-demo",
        "captcha": "",
        "force_login": False,
    }
    user = login_response.json()["data"]["user"]
    assert user["name"] == "王工"
    assert user["role"] == "设备管理部"
    assert user["department_name"] == "设备管理部"
    assert user["is_department_admin"] is True

    assert me_response.status_code == 200
    me_user = me_response.json()["data"]["user"]
    assert me_user["account"] == "bisheng-user"
    assert me_user["is_department_admin"] is True
    assert logout_response.status_code == 200
    assert after_logout_response.status_code == 401


def test_me_recovers_portal_session_from_bisheng_cookie():
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = make_auth_service()
        try:
            client.cookies.set("access_token_cookie", "existing-token")
            me_response = client.get("/api/v1/auth/me")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert me_response.status_code == 200
    assert "test_portal_session=" in me_response.headers["set-cookie"]
    user = me_response.json()["data"]["user"]
    assert user["account"] == "bisheng-user"
    assert user["name"] == "王工"


def test_login_failure_maps_upstream_english_message_to_chinese():
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = make_failing_auth_service()
        try:
            response = client.post(
                "/api/v1/auth/login",
                json={"account": "bisheng-user", "password": "bad", "remember": True},
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 401
    assert response.json()["detail"] == "账号或密码错误，请检查后重试"


def test_login_multi_login_conflict_returns_business_code():
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = make_conflict_auth_service()
        try:
            response = client.post(
                "/api/v1/auth/login",
                json={"account": "bisheng-user", "password": "secret", "remember": True},
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 409
    payload = response.json()
    assert payload["status_code"] == 10612
    assert payload["data"]["code"] == 10612


def test_login_force_login_is_forwarded_to_bisheng():
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_auth_service = make_auth_service()
        try:
            response = client.post(
                "/api/v1/auth/login",
                json={"account": "bisheng-user", "password": "secret", "remember": True, "force_login": True},
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 200
    assert FakeAuthBishengClient.login_payload["force_login"] is True


def test_force_login_replaces_existing_portal_session_for_same_account():
    service = make_auth_service()

    first = asyncio.run(service.login(account="bisheng-user", password="secret", remember=True))
    second = asyncio.run(service.login(account="bisheng-user", password="secret", remember=True, force_login=True))

    assert first.session_id != second.session_id
    assert asyncio.run(service._session_store.get(first.session_id)) is None
    assert asyncio.run(service._session_store.get(second.session_id)) is second


def test_redis_session_store_is_shared_by_separate_auth_service_instances():
    async def run():
        redis = FakeRedis()
        first_service = PortalAuthService(
            runtime_service=FakeRuntimeService(),
            cookie_name="test_portal_session",
            ttl_seconds=7 * 24 * 60 * 60,
            cookie_secure=False,
            client_factory=FakeAuthBishengClient,
            password_encryptor=lambda _public_key, password: f"encrypted-{password}",
            session_store=RedisPortalSessionStore(redis),
        )
        second_service = PortalAuthService(
            runtime_service=FakeRuntimeService(),
            cookie_name="test_portal_session",
            ttl_seconds=7 * 24 * 60 * 60,
            cookie_secure=False,
            client_factory=FakeAuthBishengClient,
            password_encryptor=lambda _public_key, password: f"encrypted-{password}",
            session_store=RedisPortalSessionStore(redis),
        )
        session = await first_service.login(account="bisheng-user", password="secret", remember=True)
        request = type("RequestWithCookies", (), {"cookies": {"test_portal_session": session.session_id}})()

        recovered = await second_service.require_session(request)
        assert recovered.session_id == session.session_id
        assert recovered.user.account == "bisheng-user"

        await second_service.logout(request)
        assert await first_service.get_session(request) is None

    asyncio.run(run())


def test_login_fails_closed_when_redis_session_store_is_unavailable():
    async def run():
        service = PortalAuthService(
            runtime_service=FakeRuntimeService(),
            cookie_name="test_portal_session",
            ttl_seconds=7 * 24 * 60 * 60,
            cookie_secure=False,
            client_factory=FakeAuthBishengClient,
            password_encryptor=lambda _public_key, password: f"encrypted-{password}",
            session_store=RedisPortalSessionStore(FailingRedis()),
        )
        try:
            await service.login(account="bisheng-user", password="secret", remember=True)
        except PortalAuthError as err:
            assert err.status_code == 503
            assert err.message == "登录服务暂不可用，请稍后重试"
        else:
            raise AssertionError("Redis 不可用时不应创建门户会话")

    asyncio.run(run())


def test_portal_user_view_keeps_legacy_sessions_compatible_without_numeric_identity():
    user = PortalUserView.model_validate(
        {
            "account": "legacy-user",
            "name": "旧会话用户",
            "initial": "旧",
            "role": "内部员工",
            "external_id": "EMP-1",
            "login_at": 1,
        }
    )

    assert user.user_id is None
    assert user.tenant_id is None
    assert user.is_department_admin is False


def test_fetch_user_maps_is_department_admin_from_bisheng_info():
    async def run():
        service = make_auth_service()
        user = await service._fetch_user(
            base_url="http://bisheng.example.com",
            timeout_seconds=30.0,
            access_token="user-token",
            fallback_account="bisheng-user",
        )
        assert user.is_department_admin is True
        assert user.name == "王工"

    asyncio.run(run())


def test_redis_session_store_deserializes_legacy_user_without_user_and_tenant_ids():
    async def run():
        redis = FakeRedis()
        store = RedisPortalSessionStore(redis)
        session_id = "legacy-session"
        redis.values[store._session_key(session_id)] = json.dumps(
            {
                "session_id": session_id,
                "access_token": "legacy-token",
                "user": {
                    "account": "legacy-user",
                    "name": "旧会话用户",
                    "initial": "旧",
                    "role": "内部员工",
                    "external_id": "EMP-1",
                    "login_at": 1,
                },
                "base_url": "http://bisheng.example.com",
                "timeout_seconds": 30,
                "expires_at": time.time() + 300,
            },
            ensure_ascii=False,
        )

        session = await store.get(session_id)

        assert session is not None
        assert session.user.user_id is None
        assert session.user.tenant_id is None

    asyncio.run(run())


def test_user_info_extracts_numeric_user_id_and_leaf_tenant_id():
    class IdentityAuthBishengClient(FakeAuthBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/user/info":
                return {
                    "status_code": 200,
                    "data": {
                        "id": "10086",
                        "leaf_tenant_id": 9,
                        "user_name": "bisheng-user",
                        "name": "王工",
                        "department_name": "设备管理部",
                    },
                }
            return await super().get_json(path, params=params)

    service = PortalAuthService(
        runtime_service=FakeRuntimeService(),
        cookie_name="test_portal_session",
        ttl_seconds=7 * 24 * 60 * 60,
        cookie_secure=False,
        client_factory=IdentityAuthBishengClient,
        password_encryptor=lambda _public_key, password: f"encrypted-{password}",
    )

    session = asyncio.run(service.login(account="bisheng-user", password="secret", remember=True))

    assert session.user.user_id == 10086
    assert session.user.tenant_id == 9
