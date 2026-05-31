from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.bisheng_runtime_service import BishengRuntimeService


class FakeBootstrapBishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: str | None = None,
        *,
        asset_base_url: str | None = None,
    ):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token
        self.asset_base_url = asset_base_url

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/get_captcha":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"captcha_key": "cap", "user_capthca": False, "captcha": ""},
            }
        if path == "/api/v1/user/public_key":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"public_key": "fake-public-key"},
            }
        if path == "/api/v1/user/info":
            if self.api_token != "runtime-token":
                raise RuntimeError("bad token")
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {
                    "user_name": "portal-admin",
                    "nick_name": "门户服务账号",
                    "role_name": "管理员",
                },
            }
        raise AssertionError(f"Unexpected bootstrap path: {path}")

    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            assert json["user_name"] == "portal-admin"
            assert json["password"] == "encrypted-password"
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"access_token": "runtime-token"},
            }
        raise AssertionError(f"Unexpected bootstrap path: {path}")

    async def aclose(self):
        return None


def create_runtime_service(tmp_path: Path, *, api_token: str = "") -> BishengRuntimeService:
    service = BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://broken.example.com",
        default_timeout_seconds=30.0,
        default_api_token=api_token,
        client_factory=FakeBootstrapBishengClient,
        password_encryptor=lambda _public_key, _password: "encrypted-password",
    )
    return service


def test_bootstrap_status_is_open_when_bisheng_connection_is_unavailable(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/bootstrap/bisheng/status")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["required"] is True
    assert body["connected"] is False


def test_bootstrap_config_updates_runtime_without_login_session(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/bootstrap/bisheng",
            json={
                "base_url": "http://example.com",
                "username": "portal-admin",
                "password": "super-secret",
                "timeout_seconds": 45,
            },
        )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["base_url"] == "http://example.com/"
    assert body["username"] == "portal-admin"
    assert body["has_token"] is True
    assert body["connected"] is True
    assert body["auth_message"] == "已连接"
    assert "password" not in body


def test_bootstrap_config_rejects_empty_password(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/bootstrap/bisheng",
            json={
                "base_url": "http://example.com",
                "username": "portal-admin",
                "password": "",
                "timeout_seconds": 45,
            },
        )

    assert response.status_code == 400
    assert "密码" in response.json()["status_message"]


def test_bootstrap_config_closes_when_bisheng_connection_is_available(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path, api_token="runtime-token")

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/bootstrap/bisheng",
            json={
                "base_url": "http://example.com",
                "username": "portal-admin",
                "password": "super-secret",
                "timeout_seconds": 45,
            },
        )

    assert response.status_code == 409
    assert "已完成" in response.json()["status_message"]
