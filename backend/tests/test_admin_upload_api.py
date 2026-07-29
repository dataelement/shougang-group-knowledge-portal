import io
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.dependencies import get_bisheng_client, require_admin_session
from app.main import app
from app.schemas.auth import PortalUserView
from app.services.portal_auth_service import PortalAuthError


def make_image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (100, 100)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(64, 96, 200)).save(buffer, format=fmt)
    return buffer.getvalue()


class FakeAdminAuthService:
    def __init__(self, role: str | None):
        self.role = role

    async def require_session(self, _request):
        if self.role is None:
            raise PortalAuthError("请先登录", status_code=401)
        return SimpleNamespace(
            user=PortalUserView(
                account="portal-user",
                name="门户用户",
                initial="门",
                role=self.role,
                external_id="00014",
                login_at=1,
            )
        )


class FakeAssetBishengClient:
    def __init__(self, payload=None, error: Exception | None = None):
        self.payload = payload or {
            "status_code": 200,
            "status_message": "SUCCESS",
            "data": {
                "image_url": "https://assets.example.com/portal-assets/1/banner/id.png",
                "object_key": "portal-assets/1/banner/id.png",
            },
        }
        self.error = error
        self.calls = []

    async def post_multipart(self, path, *, data=None, files=None, timeout=None):
        self.calls.append(
            {
                "path": path,
                "data": data,
                "files": files,
                "timeout": timeout,
            }
        )
        if self.error is not None:
            raise self.error
        return self.payload


def make_admin_session():
    return SimpleNamespace(
        user=PortalUserView(
            account="portal-admin",
            name="门户管理员",
            initial="门",
            role="管理员",
            external_id="",
            login_at=1,
        )
    )


@pytest.fixture(autouse=True)
def allow_admin_access_by_default():
    app.dependency_overrides[require_admin_session] = make_admin_session
    yield
    app.dependency_overrides.pop(require_admin_session, None)
    app.dependency_overrides.pop(get_bisheng_client, None)


def test_upload_banner_image_requires_login():
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_auth_service = FakeAdminAuthService(role=None)
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.jpg", make_image_bytes("JPEG"), "image/jpeg")},
        )

    assert response.status_code == 401


def test_upload_banner_image_rejects_non_admin_user():
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_auth_service = FakeAdminAuthService(role="内部员工")
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.jpg", make_image_bytes("JPEG"), "image/jpeg")},
        )

    assert response.status_code == 403


@pytest.mark.parametrize(
    ("portal_path", "category", "image_format", "content_type"),
    [
        ("/api/v1/admin/upload/banner", "banner", "WEBP", "image/webp"),
        ("/api/v1/admin/upload/app-icon", "app-icon", "PNG", "image/png"),
    ],
)
def test_upload_public_asset_proxies_to_bisheng_and_keeps_image_url_contract(
    portal_path,
    category,
    image_format,
    content_type,
):
    remote_url = f"https://assets.example.com/portal-assets/1/{category}/id.webp"
    bisheng_client = FakeAssetBishengClient(
        payload={
            "status_code": 200,
            "status_message": "SUCCESS",
            "data": {
                "image_url": remote_url,
                "object_key": f"portal-assets/1/{category}/id.webp",
            },
        }
    )
    app.dependency_overrides[get_bisheng_client] = lambda: bisheng_client

    with TestClient(app) as client:
        response = client.post(
            portal_path,
            files={
                "file": (
                    "asset.bin",
                    make_image_bytes(image_format),
                    content_type,
                )
            },
        )

    assert response.status_code == 200
    assert response.json()["data"] == {"image_url": remote_url}
    assert bisheng_client.calls[0]["path"] == (
        f"/api/v1/shougang-portal/assets/{category}"
    )
    proxied_file = bisheng_client.calls[0]["files"]["file"]
    assert proxied_file[0] == "asset.bin"
    assert proxied_file[2] == content_type
    assert not remote_url.startswith("/uploads/")


@pytest.mark.parametrize(
    ("remote_status", "expected_status"),
    [(413, 413), (415, 415), (422, 422), (503, 502)],
)
def test_upload_public_asset_maps_remote_failure(remote_status, expected_status):
    bisheng_client = FakeAssetBishengClient(
        payload={
            "status_code": remote_status,
            "status_message": "远端资源上传失败",
            "data": {},
        }
    )
    app.dependency_overrides[get_bisheng_client] = lambda: bisheng_client

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.png", make_image_bytes("PNG"), "image/png")},
        )

    assert response.status_code == expected_status
    assert "远端资源上传失败" in response.json()["detail"]


def test_upload_public_asset_hides_transport_error_details():
    request = httpx.Request("POST", "https://bisheng.internal/assets")
    bisheng_client = FakeAssetBishengClient(
        error=httpx.ConnectError("redis-password=secret", request=request)
    )
    app.dependency_overrides[get_bisheng_client] = lambda: bisheng_client

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/admin/upload/app-icon",
            files={"file": ("app.png", make_image_bytes("PNG"), "image/png")},
        )

    assert response.status_code == 502
    assert "secret" not in response.text


def test_portal_app_has_no_local_upload_state():
    assert not hasattr(app.state, "uploads_root")
    assert all(getattr(route, "path", None) != "/uploads" for route in app.routes)
