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
    assert payload["document_types"][0]["children"] == [{"code": "POL", "label": "政策制度"}]


def test_bisheng_runtime_service_can_store_runtime_state_in_memory(tmp_path):
    runtime_service = BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://bisheng.example.com",
        default_timeout_seconds=30.0,
        store=InMemoryConfigStore(),
    )

    config = runtime_service.get_public_config()

    assert str(config.base_url) == "http://bisheng.example.com/"
