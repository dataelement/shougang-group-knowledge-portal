from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dependencies import require_admin_session
from app.main import app
from app.schemas.auth import PortalUserView
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfigUpdate
from app.services.portal_auth_service import PortalSession
from app.services.portal_unified_auth_service import PortalUnifiedAuthService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService
from app.settings import Settings


class FakeRuntimeService:
    def get_connection_settings(self):
        return "https://bisheng.example.com", 30.0


def make_admin_session():
    return PortalSession(
        session_id="admin-session",
        access_token="admin-token",
        base_url="https://bisheng.example.com",
        timeout_seconds=30,
        expires_at=9_999_999_999,
        user=PortalUserView(
            account="admin",
            name="管理员",
            initial="管",
            role="管理员",
            external_id="",
            login_at=1,
        ),
    )


@pytest.fixture(autouse=True)
def allow_admin_access():
    app.dependency_overrides[require_admin_session] = make_admin_session
    yield
    app.dependency_overrides.pop(require_admin_session, None)


def make_settings(**overrides) -> Settings:
    defaults = {
        "unified_auth_enabled": True,
        "unified_auth_provider": "group",
        "unified_auth_client_id": "seed-client",
        "unified_auth_client_secret": "seed-secret",
        "unified_auth_redirect_uri": "https://portal.example.com/api/v1/auth/unified/callback",
        "unified_auth_state_secret": "seed-state-secret",
        "unified_auth_login_sync_hmac_secret": "seed-login-sync-secret",
        "unified_auth_state_ttl_seconds": 300,
        "unified_auth_http_timeout_seconds": 5,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def make_service(tmp_path: Path, **settings_overrides) -> UnifiedAuthRuntimeService:
    return UnifiedAuthRuntimeService(
        database_path=tmp_path / "portal.sqlite3",
        settings=make_settings(**settings_overrides),
        state_secret_factory=lambda: "generated-state-secret",
    )


def test_runtime_config_seeds_from_settings_and_hides_secrets(tmp_path: Path):
    service = make_service(tmp_path)

    config = service.get_config()
    view = service.get_public_config()

    assert config.enabled is True
    assert config.client_id == "seed-client"
    assert config.client_secret == "seed-secret"
    assert config.login_sync_hmac_secret == "seed-login-sync-secret"
    assert view.has_client_secret is True
    assert view.has_state_secret is True
    assert view.has_login_sync_hmac_secret is True
    serialized = view.model_dump_json()
    assert "seed-secret" not in serialized
    assert "seed-state-secret" not in serialized
    assert "seed-login-sync-secret" not in serialized


def test_runtime_config_update_preserves_blank_secrets_and_generates_state_secret(tmp_path: Path):
    service = make_service(
        tmp_path,
        unified_auth_client_secret="",
        unified_auth_state_secret="",
        unified_auth_login_sync_hmac_secret="",
    )

    updated = service.update_config(
        UnifiedAuthRuntimeConfigUpdate(
            enabled=True,
            provider="custom",
            client_id="client-a",
            client_secret="secret-a",
            redirect_uri="https://portal.example.com/api/v1/auth/unified/callback",
            authorize_url="https://iam.example.com/oauth/authorize",
            token_url="https://iam.example.com/oauth/token",
            userinfo_url="https://iam.example.com/oauth/userinfo",
            token_param_style="form",
            state_secret="",
            state_ttl_seconds=180,
            http_timeout_seconds=8,
            login_sync_hmac_secret="login-sync-a",
            login_sync_signature_header="X-Test-Signature",
        )
    )

    assert updated.has_client_secret is True
    assert updated.has_state_secret is True
    assert updated.has_login_sync_hmac_secret is True
    config = service.get_config()
    assert config.client_secret == "secret-a"
    assert config.state_secret == "generated-state-secret"
    assert config.login_sync_hmac_secret == "login-sync-a"

    service.update_config(
        UnifiedAuthRuntimeConfigUpdate(
            enabled=True,
            provider="custom",
            client_id="client-b",
            client_secret="",
            redirect_uri="https://portal.example.com/api/v1/auth/unified/callback",
            authorize_url="https://iam.example.com/oauth/authorize",
            token_url="https://iam.example.com/oauth/token",
            userinfo_url="https://iam.example.com/oauth/userinfo",
            token_param_style="query",
            state_secret="",
            state_ttl_seconds=240,
            http_timeout_seconds=9,
            login_sync_hmac_secret="",
            login_sync_signature_header="X-Signature",
        )
    )

    config = service.get_config()
    assert config.client_id == "client-b"
    assert config.client_secret == "secret-a"
    assert config.state_secret == "generated-state-secret"
    assert config.login_sync_hmac_secret == "login-sync-a"


def test_runtime_config_validation_rejects_invalid_provider_and_token_style(tmp_path: Path):
    service = make_service(tmp_path)

    with pytest.raises(ValidationError):
        service.update_config(
            UnifiedAuthRuntimeConfigUpdate(
                enabled=True,
                provider="invalid",
                client_id="client",
                redirect_uri="https://portal.example.com/callback",
            )
        )

    with pytest.raises(ValidationError):
        service.update_config(
            UnifiedAuthRuntimeConfigUpdate(
                enabled=True,
                provider="group",
                client_id="client",
                redirect_uri="https://portal.example.com/callback",
                token_param_style="header",
            )
        )


def test_admin_unified_auth_config_get_post_does_not_echo_secrets(tmp_path: Path):
    service = make_service(tmp_path)

    with TestClient(app) as client:
        previous = getattr(client.app.state, "unified_auth_runtime_service", None)
        client.app.state.unified_auth_runtime_service = service
        try:
            response = client.post(
                "/api/v1/admin/config/unified-auth",
                json={
                    "enabled": True,
                    "provider": "stock",
                    "client_id": "admin-client",
                    "client_secret": "admin-secret",
                    "redirect_uri": "https://portal.example.com/api/v1/auth/unified/callback",
                    "authorize_url": "",
                    "token_url": "",
                    "userinfo_url": "",
                    "token_param_style": "query",
                    "state_secret": "",
                    "state_ttl_seconds": 300,
                    "http_timeout_seconds": 10,
                    "login_sync_hmac_secret": "admin-login-sync-secret",
                    "login_sync_signature_header": "X-Signature",
                },
            )
            get_response = client.get("/api/v1/admin/config/unified-auth")
        finally:
            if previous is not None:
                client.app.state.unified_auth_runtime_service = previous

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["provider"] == "stock"
    assert body["client_id"] == "admin-client"
    assert body["has_client_secret"] is True
    assert body["has_state_secret"] is True
    assert body["has_login_sync_hmac_secret"] is True
    assert "admin-secret" not in response.text
    assert "admin-login-sync-secret" not in response.text
    assert get_response.status_code == 200
    assert "admin-secret" not in get_response.text
    assert "admin-login-sync-secret" not in get_response.text


def test_unified_auth_start_uses_latest_admin_runtime_config(tmp_path: Path):
    runtime_config_service = make_service(tmp_path, unified_auth_client_id="old-client")
    unified_service = PortalUnifiedAuthService(
        settings=make_settings(),
        runtime_service=FakeRuntimeService(),
        auth_service=None,
        cookie_secure=False,
        config_service=runtime_config_service,
        clock=lambda: 1_700_000_000,
        nonce_factory=lambda _size: "nonce-for-test",
    )

    runtime_config_service.update_config(
        UnifiedAuthRuntimeConfigUpdate(
            enabled=True,
            provider="custom",
            client_id="runtime-client",
            client_secret="runtime-secret",
            redirect_uri="https://runtime.example.com/callback",
            authorize_url="https://iam.runtime.example.com/authorize",
            token_url="https://iam.runtime.example.com/token",
            userinfo_url="https://iam.runtime.example.com/userinfo",
            token_param_style="query",
            login_sync_hmac_secret="runtime-login-sync-secret",
        )
    )

    start = unified_service.build_start("/admin")
    parsed = urlparse(start.authorize_url)
    query = parse_qs(parsed.query)

    assert start.authorize_url.startswith("https://iam.runtime.example.com/authorize?")
    assert query["client_id"] == ["runtime-client"]
    assert query["redirect_uri"] == ["https://runtime.example.com/callback"]
    assert query["response_type"] == ["code"]
    assert query["state"]
