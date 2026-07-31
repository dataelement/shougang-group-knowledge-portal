from types import SimpleNamespace

import httpx

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import PortalAdminAggregateConfig, PortalBishengPersistentConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import InMemoryConfigStore
from app.services.portal_admin_config_store import RemotePortalAdminConfigStore


class FakeRuntimeService:
    def __init__(self, *, saved_password: str = "runtime-password"):
        self._persistent = PortalBishengPersistentConfig(
            base_url="http://bisheng.example.com",
            asset_base_url="http://assets.example.com",
            username="portal-admin",
            timeout_seconds=12,
            saved_password=saved_password,
            last_auth_at="2026-05-31T10:00:00+00:00",
        )

    def get_persistent_config(self) -> PortalBishengPersistentConfig:
        return self._persistent

    def get_runtime_config_snapshot(self):
        return SimpleNamespace(
            base_url=self._persistent.base_url,
            timeout_seconds=self._persistent.timeout_seconds,
            api_token="runtime-token",
        )


class MemoryRemotePortalAdminConfigStore(RemotePortalAdminConfigStore):
    def __init__(self, *, remote: PortalAdminAggregateConfig | None = None):
        super().__init__(runtime_service=FakeRuntimeService())
        self.remote = remote
        self.save_count = 0

    def _load_remote_aggregate(self) -> PortalAdminAggregateConfig | None:
        return self.remote

    def _save_remote_aggregate(self, aggregate: PortalAdminAggregateConfig) -> None:
        self.remote = aggregate
        self.save_count += 1


class RedactingUnifiedAuthRemoteStore(MemoryRemotePortalAdminConfigStore):
    def _save_remote_aggregate(self, aggregate: PortalAdminAggregateConfig) -> PortalAdminAggregateConfig:
        self.save_count += 1
        redacted_data = aggregate.model_dump(mode="json")
        redacted_data["unified_auth"]["login_sync_hmac_secret"] = ""
        redacted_data["unified_auth"]["client_secret"] = ""
        redacted = PortalAdminAggregateConfig.model_validate(redacted_data)
        saved = self._merge_unified_auth_secrets(redacted, aggregate)
        self.remote = saved
        self._record_saved_aggregate(saved)
        return saved


class RawMemoryRemotePortalAdminConfigStore(RemotePortalAdminConfigStore):
    def __init__(self, *, remote_data: dict | None = None):
        super().__init__(runtime_service=FakeRuntimeService())
        self.remote_data = remote_data

    def _request(self, method: str, path: str, json: dict | None = None) -> dict:
        return {"data": self.remote_data}


def test_get_document_loads_remote_section():
    existing = PortalAdminAggregateConfig(
        portal={
            **DEFAULT_PORTAL_CONFIG,
            "site": {
                **DEFAULT_PORTAL_CONFIG["site"],
                "browser_title": "远程门户标题",
            },
        },
        bisheng=PortalBishengPersistentConfig(base_url="http://existing.example.com"),
    )
    store = MemoryRemotePortalAdminConfigStore(remote=existing)

    payload = store.get_document("portal_config")

    assert payload is not None
    assert payload["site"]["browser_title"] == "远程门户标题"


def test_shared_cache_exposes_saved_version_only_after_applier_advances_it():
    version_one = PortalAdminAggregateConfig(
        version=1,
        portal=DEFAULT_PORTAL_CONFIG,
        bisheng=PortalBishengPersistentConfig(
            base_url="http://existing.example.com"
        ),
    )
    store = MemoryRemotePortalAdminConfigStore(remote=version_one)
    store.enable_shared_cache()
    store.set_cached_aggregate(version_one)
    next_portal = version_one.portal.model_copy(
        update={
            "site": version_one.portal.site.model_copy(
                update={"browser_title": "待发布标题"}
            )
        }
    )

    result = store.upsert_document(
        "portal_config",
        next_portal.model_dump(mode="json"),
    )

    assert result.document["site"]["browser_title"] == "待发布标题"
    assert store.get_document("portal_config")["site"]["browser_title"] != "待发布标题"
    assert store.last_saved_aggregate is not None
    store.set_cached_aggregate(store.last_saved_aggregate)
    assert store.get_document("portal_config")["site"]["browser_title"] == "待发布标题"


def test_get_document_normalizes_legacy_empty_document_type_children():
    store = RawMemoryRemotePortalAdminConfigStore(
        remote_data={
            "portal": {
                **DEFAULT_PORTAL_CONFIG,
                "document_types": [
                    {"code": "POL", "label": "政策制度", "children": []},
                ],
            },
            "bisheng": {
                "base_url": "http://existing.example.com",
            },
            "unified_auth": {
                "enabled": True,
                "provider": "stock",
                "client_id": "portal-client",
            },
        }
    )

    unified_auth_payload = store.get_document("unified_auth_runtime_config")
    portal_payload = store.get_document("portal_config")

    assert unified_auth_payload is not None
    assert unified_auth_payload["enabled"] is True
    assert unified_auth_payload["provider"] == "stock"
    assert portal_payload is not None
    assert portal_payload["document_types"][0]["children"] == [
        {"code": "POL", "label": "政策制度", "description_examples": ""},
    ]


def test_get_document_returns_none_when_remote_config_is_empty():
    store = MemoryRemotePortalAdminConfigStore()

    assert store.get_document("portal_config") is None


def test_upsert_document_updates_remote_section():
    existing = PortalAdminAggregateConfig(
        portal=DEFAULT_PORTAL_CONFIG,
        bisheng=PortalBishengPersistentConfig(base_url="http://existing.example.com"),
    )
    store = MemoryRemotePortalAdminConfigStore(remote=existing)
    payload = {
        **DEFAULT_PORTAL_CONFIG,
        "site": {
            **DEFAULT_PORTAL_CONFIG["site"],
            "browser_title": "远程写入标题",
        },
    }

    store.upsert_document("portal_config", payload)

    assert store.remote is not None
    assert store.remote.portal.site.browser_title == "远程写入标题"
    assert str(store.remote.bisheng.base_url) == "http://existing.example.com/"
    assert store.save_count == 1


def test_upsert_document_preserves_home_cache_ttl():
    existing = PortalAdminAggregateConfig(
        portal=DEFAULT_PORTAL_CONFIG,
        bisheng=PortalBishengPersistentConfig(base_url="http://existing.example.com"),
    )
    store = MemoryRemotePortalAdminConfigStore(remote=existing)
    payload = {
        **DEFAULT_PORTAL_CONFIG,
        "site": {
            **DEFAULT_PORTAL_CONFIG["site"],
            "home_cache_ttl_seconds": 900,
        },
    }

    store.upsert_document("portal_config", payload)

    assert store.get_document("portal_config")["site"]["home_cache_ttl_seconds"] == 900


def test_upsert_document_creates_remote_aggregate_from_defaults():
    store = MemoryRemotePortalAdminConfigStore()
    payload = {
        **DEFAULT_PORTAL_CONFIG,
        "site": {
            **DEFAULT_PORTAL_CONFIG["site"],
            "browser_title": "首次远程写入标题",
        },
    }

    store.upsert_document("portal_config", payload)

    assert store.remote is not None
    assert store.remote.portal.site.browser_title == "首次远程写入标题"
    assert str(store.remote.bisheng.base_url) == "http://bisheng.example.com/"
    assert store.remote.bisheng.saved_password == "runtime-password"
    assert store.save_count == 1


def test_upsert_document_persists_rest_auth_runtime_config():
    store = MemoryRemotePortalAdminConfigStore()
    payload = {
        "enabled": True,
        "rest_base_url": "https://iam.example.com",
        "rest_app_id": "portal-rest",
        "authenticate_url": "",
        "token_valid_url": "",
        "user_attributes_url": "",
        "rest_token_id_param": "tokenId",
        "http_timeout_seconds": 10.0,
        "token_check_interval_seconds": 300,
        "verify_tls": True,
        "bisheng_lookup_required": False,
        "login_sync_hmac_secret": "sync-secret",
        "login_sync_signature_header": "X-Signature",
    }

    store.upsert_document("rest_auth_runtime_config", payload)

    assert store.remote is not None
    assert store.remote.unified_auth.enabled is True
    assert store.remote.unified_auth.provider == "custom"
    assert store.remote.unified_auth.client_id == "portal-rest"
    assert store.remote.unified_auth.login_sync_hmac_secret == "sync-secret"
    assert store.remote.unified_auth.state_ttl_seconds == 300
    assert store.remote.unified_auth.state_secret.startswith("sg-rest-meta:")
    saved = store.get_document("rest_auth_runtime_config")
    assert saved is not None
    assert saved["enabled"] is True
    assert saved["rest_base_url"] == "https://iam.example.com"
    assert saved["rest_app_id"] == "portal-rest"
    assert store.save_count == 1


def test_upsert_rest_auth_preserves_login_sync_secret_when_remote_save_redacts():
    store = RedactingUnifiedAuthRemoteStore()
    store.enable_shared_cache()
    payload = {
        "enabled": True,
        "rest_base_url": "https://iam.example.com",
        "rest_app_id": "portal-rest",
        "authenticate_url": "",
        "token_valid_url": "",
        "user_attributes_url": "",
        "rest_token_id_param": "tokenId",
        "http_timeout_seconds": 10.0,
        "token_check_interval_seconds": 300,
        "verify_tls": True,
        "bisheng_lookup_required": False,
        "login_sync_hmac_secret": "sync-secret",
        "login_sync_signature_header": "X-Signature",
    }

    store.upsert_document("rest_auth_runtime_config", payload)

    assert store.remote is not None
    assert store.remote.unified_auth.login_sync_hmac_secret == "sync-secret"
    assert store.last_saved_aggregate is not None
    assert store.last_saved_aggregate.unified_auth.login_sync_hmac_secret == "sync-secret"
    store.set_cached_aggregate(store.last_saved_aggregate)
    cached = store.get_cached_aggregate()
    assert cached is not None
    assert cached.unified_auth.login_sync_hmac_secret == "sync-secret"
    saved = store.get_document("rest_auth_runtime_config")
    assert saved is not None
    assert saved["login_sync_hmac_secret"] == "sync-secret"


def test_get_rest_auth_runtime_document_migrates_nested_rest_auth_object():
    store = RawMemoryRemotePortalAdminConfigStore(
        remote_data={
            "portal": {
                **DEFAULT_PORTAL_CONFIG,
                "document_types": [],
            },
            "bisheng": {"base_url": "http://existing.example.com"},
            "unified_auth": {
                "rest_auth": {
                    "enabled": True,
                    "rest_base_url": "https://nested.example.com",
                    "rest_app_id": "nested-app",
                },
            },
        }
    )

    payload = store.get_document("rest_auth_runtime_config")

    assert payload is not None
    assert payload["enabled"] is True
    assert payload["rest_base_url"] == "https://nested.example.com"
    assert payload["rest_app_id"] == "nested-app"


def test_get_rest_auth_runtime_document_backfills_missing_rest_section():
    store = MemoryRemotePortalAdminConfigStore(
        remote=PortalAdminAggregateConfig(
            portal=DEFAULT_PORTAL_CONFIG,
            bisheng=PortalBishengPersistentConfig(base_url="http://existing.example.com"),
        ),
    )

    payload = store.get_document("rest_auth_runtime_config")

    assert payload is not None
    assert payload["enabled"] is False


def test_get_rest_auth_runtime_document_migrates_legacy_portal_integrations():
    store = RawMemoryRemotePortalAdminConfigStore(
        remote_data={
            "portal": {
                **DEFAULT_PORTAL_CONFIG,
                "integrations": {
                    "bisheng_admin_entry_url": "",
                    "bisheng_knowledge_entry_url": "",
                    "rest_auth_runtime": {
                        "enabled": True,
                        "rest_base_url": "https://legacy.example.com",
                        "rest_app_id": "legacy-app",
                    },
                },
            },
            "bisheng": {"base_url": "http://existing.example.com"},
            "unified_auth": {},
        }
    )

    payload = store.get_document("rest_auth_runtime_config")

    assert payload is not None
    assert payload["enabled"] is True
    assert payload["rest_base_url"] == "https://legacy.example.com"
    assert payload["rest_app_id"] == "legacy-app"


def test_non_remote_documents_are_process_memory_only():
    store = MemoryRemotePortalAdminConfigStore()

    store.upsert_document("domain_count_cache", {"counts": {"PP": 3}})

    assert store.get_document("domain_count_cache") == {"counts": {"PP": 3}}
    assert store.remote is None
    assert store.save_count == 0


def test_load_remote_aggregate_backfills_legacy_empty_document_type_children():
    """Regression guard: document types persisted before ``children`` became a
    required field (empty list) must not crash config loading for every
    dependent endpoint. New admin writes still reject empty children."""
    store = RemotePortalAdminConfigStore(runtime_service=FakeRuntimeService())
    store._request = lambda method, path, json=None: {  # type: ignore[method-assign]
        "data": {
            "portal": {
                **DEFAULT_PORTAL_CONFIG,
                "document_types": [
                    {"code": "POL", "label": "政策制度", "children": []},
                ],
            },
            "bisheng": {"base_url": "http://existing.example.com"},
            "unified_auth": {},
        }
    }

    payload = store.get_document("portal_config")

    assert payload is not None
    assert payload["document_types"][0]["children"] == [{"code": "POL", "label": "政策制度", "description_examples": ""}]


def test_bisheng_runtime_service_can_store_runtime_state_in_memory(tmp_path):
    runtime_service = BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://bisheng.example.com",
        default_timeout_seconds=30.0,
        store=InMemoryConfigStore(),
    )

    config = runtime_service.get_public_config()

    assert str(config.base_url) == "http://bisheng.example.com/"


def test_internal_config_read_omits_user_token_but_admin_write_keeps_it(monkeypatch):
    requests: list[httpx.Request] = []
    original_client = httpx.Client

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            request=request,
            json={"status_code": 200, "data": {}},
        )

    def build_client(**kwargs):
        return original_client(
            **kwargs,
            transport=httpx.MockTransport(handle_request),
        )

    monkeypatch.setattr(httpx, "Client", build_client)
    store = RemotePortalAdminConfigStore(runtime_service=FakeRuntimeService())

    store._request("GET", "/api/v1/shougang-portal/config/internal")
    store._request("PUT", "/api/v1/shougang-portal/config", json={})

    internal_get, admin_put = requests
    assert "Authorization" not in internal_get.headers
    assert "access_token_cookie" not in internal_get.headers.get("cookie", "")
    assert admin_put.headers["Authorization"] == "Bearer runtime-token"
    assert "access_token_cookie=runtime-token" in admin_put.headers["cookie"]
