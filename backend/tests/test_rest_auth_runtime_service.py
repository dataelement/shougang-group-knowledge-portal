from app.schemas.rest_auth_runtime import RestAuthRuntimeConfigUpdate
from app.services.config_store import InMemoryConfigStore
from app.services.rest_auth_runtime_service import RestAuthRuntimeService
from app.settings import Settings


def test_rest_auth_runtime_service_defaults_and_update():
    settings = Settings(
        rest_auth_enabled=True,
        rest_auth_base_url="https://iam.example.com",
        rest_auth_app_id="portal-rest",
    )
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    service = RestAuthRuntimeService(settings=settings, store=store)

    view = service.get_public_config()
    assert view.enabled is True
    assert view.rest_base_url == "https://iam.example.com"
    assert view.rest_app_id == "portal-rest"

    updated = service.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
            login_sync_hmac_secret="secret-value",
        )
    )
    assert updated.has_login_sync_hmac_secret is True
    assert updated.missing_fields == []


def test_rest_auth_runtime_secret_not_in_public_view():
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    service = RestAuthRuntimeService(settings=Settings(), store=store)
    service.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
            login_sync_hmac_secret="top-secret",
        )
    )
    raw = store.get_document("rest_auth_runtime_config")
    assert raw is not None
    assert raw.get("login_sync_hmac_secret") == "top-secret"
    public = service.get_public_config().model_dump()
    assert "login_sync_hmac_secret" not in public


def test_rest_auth_runtime_login_sync_secret_falls_back_to_unified_auth():
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    unified_store = InMemoryConfigStore()
    unified_store.skip_startup_seed = True
    from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfigUpdate
    from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService

    unified_service = UnifiedAuthRuntimeService(settings=Settings(), store=unified_store)
    unified_service.update_config(
        UnifiedAuthRuntimeConfigUpdate(
            enabled=True,
            provider="group",
            client_id="oauth-client",
            client_secret="oauth-secret",
            redirect_uri="https://portal.example.com/callback",
            state_secret="state-secret",
            login_sync_hmac_secret="shared-sync-secret",
        )
    )
    rest_service = RestAuthRuntimeService(
        settings=Settings(),
        store=store,
        unified_auth_runtime_service=unified_service,
    )
    rest_service.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
        )
    )
    assert rest_service.get_effective_login_sync_hmac_secret() == "shared-sync-secret"
    assert rest_service.list_missing_fields() == []
    assert rest_service.get_public_config().has_login_sync_hmac_secret is True


def test_rest_auth_runtime_resolves_relative_iam_urls():
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    service = RestAuthRuntimeService(settings=Settings(), store=store)
    updated = service.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
            user_attributes_url="/idp/restful/getIDPUserAttributes",
            login_sync_hmac_secret="secret-value",
        )
    )
    assert (
        updated.user_attributes_url
        == "https://iam.example.com/idp/restful/getIDPUserAttributes"
    )


def test_rest_auth_runtime_resolves_bare_idp_path():
    store = InMemoryConfigStore()
    store.skip_startup_seed = True
    service = RestAuthRuntimeService(settings=Settings(), store=store)
    updated = service.update_config(
        RestAuthRuntimeConfigUpdate(
            enabled=True,
            rest_base_url="https://iam.example.com",
            rest_app_id="portal-rest",
            user_attributes_url="idp/restful/getIDPUserAttributes",
            login_sync_hmac_secret="secret-value",
        )
    )
    assert (
        updated.user_attributes_url
        == "https://iam.example.com/idp/restful/getIDPUserAttributes"
    )
