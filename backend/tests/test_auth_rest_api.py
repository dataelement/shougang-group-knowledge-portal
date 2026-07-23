import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.rest_auth_runtime import RestAuthRuntimeConfigUpdate
from app.services.config_store import InMemoryConfigStore
from app.services.portal_auth_service import PortalAuthService
from app.services.portal_bisheng_user_lookup import PortalBishengUserLookup
from app.services.portal_rest_auth_service import PortalRestAuthService
from app.services.portal_unified_auth_service import LOGIN_SYNC_PATH, PortalUnifiedAuthService
from app.services.rest_auth_runtime_service import RestAuthRuntimeService
from app.settings import Settings


class FakeRuntimeService:
    def get_connection_settings(self):
        return "https://bisheng.example.com", 30.0

    async def sync_shared_auth_state(self):
        return None

    def get_client(self):
        return FakeLookupClient()


class FakeLookupClient:
    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/list":
            username = (params or {}).get("name") or (params or {}).get("keyword") or (params or {}).get("user_name")
            if username == "local-user":
                return {"status_code": 200, "data": {"data": [{"user_name": "local-user", "source": "local"}]}}
            return {"status_code": 200, "data": {"data": []}}
        raise AssertionError(path)


class FakeAuthBishengClient:
    def __init__(self, base_url: str, timeout_seconds: float, api_token: str | None = None):
        self.api_token = api_token

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/info":
            return {
                "status_code": 200,
                "data": {
                    "user_name": "rest-user",
                    "name": "REST 用户",
                    "department_name": "测试部门",
                },
            }
        if path == "/api/v1/user/get_captcha":
            return {"status_code": 200, "data": {"captcha_key": "ck", "captcha": "1234"}}
        raise AssertionError(path)

    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            return {"status_code": 200, "data": {"access_token": "local-token"}}
        raise AssertionError(path)

    async def aclose(self):
        return None


class RecordingRestHttpClient:
    def __init__(self):
        self.calls: list[dict] = []

    async def post(self, url: str, data=None, content=None, headers=None, params=None):
        self.calls.append({"method": "POST", "url": url, "data": data})
        if "IDPAuthenticate" in url:
            return httpx.Response(
                200,
                json={"data": {"tokenId": "rest-token-id"}},
                request=httpx.Request("POST", url),
            )
        if "isIDPTokenValid" in url:
            return httpx.Response(
                200,
                json={"data": {"isValid": True}},
                request=httpx.Request("POST", url),
            )
        if LOGIN_SYNC_PATH in url:
            return httpx.Response(
                200,
                json={"status_code": 200, "data": {"token": "bisheng-token"}},
                request=httpx.Request("POST", url),
            )
        raise AssertionError(url)

    async def get(self, url: str, params=None):
        self.calls.append({"method": "GET", "url": url, "params": params})
        if "getIDPUserAttributes" in url:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "attributes": {
                            "loginName": "rest-user",
                            "displayName": "REST 用户",
                            "mail": "rest@example.com",
                        }
                    }
                },
                request=httpx.Request("GET", url),
            )
        raise AssertionError(url)

    async def aclose(self):
        return None


def _wire_rest_auth(client: TestClient):
    settings = Settings(portal_session_cookie_secure=False)
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    runtime = FakeRuntimeService()
    auth_service = PortalAuthService(
        runtime_service=runtime,
        cookie_name=settings.portal_session_cookie_name,
        ttl_seconds=settings.portal_session_ttl_seconds,
        cookie_secure=False,
        client_factory=FakeAuthBishengClient,
    )
    rest_runtime = RestAuthRuntimeService(settings=settings, store=store)
    rest_runtime.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
            login_sync_hmac_secret="sync-secret",
        )
    )
    unified = PortalUnifiedAuthService(
        settings=settings,
        runtime_service=runtime,
        auth_service=auth_service,
        cookie_secure=False,
    )
    http_client = RecordingRestHttpClient()
    rest_service = PortalRestAuthService(
        settings=settings,
        auth_service=auth_service,
        unified_auth_service=unified,
        config_service=rest_runtime,
        user_lookup=PortalBishengUserLookup(runtime_service=runtime),
        cookie_secure=False,
        http_client_factory=lambda: http_client,
    )
    client.app.state.rest_auth_runtime_service = rest_runtime
    client.app.state.portal_rest_auth_service = rest_service
    client.app.state.portal_auth_service = auth_service
    return http_client


def test_rest_exchange_sets_session_and_idp_cookie():
    client = TestClient(app)
    http_client = _wire_rest_auth(client)

    response = client.post(
        "/api/v1/auth/rest/exchange",
        json={"token_id": "incoming-token", "redirect": "/"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["user"]["account"] == "rest-user"
    assert response.json()["data"]["auth_source"] == "rest_auth"
    assert client.cookies.get("sg_portal_session")
    assert client.cookies.get("sg_idp_token_id") == "incoming-token"
    assert any("isIDPTokenValid" in call["url"] for call in http_client.calls)


def test_rest_login_routes_local_user_to_bisheng_password():
    client = TestClient(app)
    _wire_rest_auth(client)

    response = client.post(
        "/api/v1/auth/rest/login",
        json={"account": "local-user", "password": "secret", "redirect": "/"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["auth_source"] == "local"
    assert client.cookies.get("sg_idp_token_id") is None


def test_unified_config_prefers_rest_mode():
    client = TestClient(app)
    _wire_rest_auth(client)

    response = client.get("/api/v1/auth/unified/config")
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["auth_mode"] == "rest"
    assert payload["enabled"] is True
