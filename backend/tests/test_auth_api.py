from fastapi.testclient import TestClient

from app.main import app
from app.services.portal_auth_service import PortalAuthService


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
    }
    user = login_response.json()["data"]["user"]
    assert user["name"] == "王工"
    assert user["role"] == "设备管理部"

    assert me_response.status_code == 200
    assert me_response.json()["data"]["user"]["account"] == "bisheng-user"
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
