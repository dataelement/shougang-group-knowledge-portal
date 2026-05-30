import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api.dependencies import require_admin_session
from app.main import app
from app.schemas.auth import PortalUserView
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_auth_service import PortalAuthError
from tests.test_admin_config_api import FakeRuntimeBishengClient


def create_runtime_service(tmp_path: Path) -> BishengRuntimeService:
    return BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_api_token="",
        client_factory=FakeRuntimeBishengClient,
        password_encryptor=lambda _public_key, _password: "encrypted-password",
    )


def make_image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (100, 100)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color=(64, 96, 200)).save(buf, format=fmt)
    return buf.getvalue()


class FakeAdminAuthService:
    def __init__(self, role: str | None):
        self.role = role

    def require_session(self, _request):
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


def test_upload_banner_image_requires_login(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.portal_auth_service = FakeAdminAuthService(role=None)
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.jpg", make_image_bytes("JPEG"), "image/jpeg")},
        )

    assert response.status_code == 401


def test_upload_banner_image_rejects_non_admin_user(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.portal_auth_service = FakeAdminAuthService(role="内部员工")
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.jpg", make_image_bytes("JPEG"), "image/jpeg")},
        )

    assert response.status_code == 403


def test_upload_banner_image_persists_file_and_returns_relative_url(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.jpg", make_image_bytes("JPEG"), "image/jpeg")},
        )

    assert response.status_code == 200
    body = response.json()
    image_url = body["data"]["image_url"]
    assert image_url.startswith("/uploads/banners/")
    assert image_url.endswith(".jpg")

    on_disk = uploads_root / "banners" / image_url.rsplit("/", 1)[-1]
    assert on_disk.exists()
    assert on_disk.stat().st_size > 0


def test_upload_banner_image_rejects_disallowed_mime(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("logo.svg", b"<svg/>", "image/svg+xml")},
        )

    assert response.status_code == 415


def test_upload_banner_image_rejects_oversized_payload(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"
    big_payload = make_image_bytes("JPEG", size=(10, 10)) + b"\x00" * (5 * 1024 * 1024 + 1)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("huge.jpg", big_payload, "image/jpeg")},
        )

    assert response.status_code == 413


def test_upload_banner_image_rejects_forged_extension(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.uploads_root = uploads_root
        response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("fake.jpg", b"this is not an image", "image/jpeg")},
        )

    assert response.status_code == 415


def test_upload_banner_image_accepts_png_and_webp(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)
    uploads_root = tmp_path / "uploads"

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.uploads_root = uploads_root
        png_response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.png", make_image_bytes("PNG"), "image/png")},
        )
        webp_response = client.post(
            "/api/v1/admin/upload/banner",
            files={"file": ("hero.webp", make_image_bytes("WEBP"), "image/webp")},
        )

    assert png_response.status_code == 200
    assert png_response.json()["data"]["image_url"].endswith(".png")
    assert webp_response.status_code == 200
    assert webp_response.json()["data"]["image_url"].endswith(".webp")
