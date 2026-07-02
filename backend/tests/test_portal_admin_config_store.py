from pathlib import Path

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import PortalAdminAggregateConfig, PortalBishengPersistentConfig
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import InMemoryConfigStore, SQLiteConfigStore
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
    def __init__(self, *, database_path: Path, remote: PortalAdminAggregateConfig | None = None):
        super().__init__(runtime_service=FakeRuntimeService(), database_path=database_path)
        self.remote = remote
        self.save_count = 0

    def _load_remote_aggregate(self) -> PortalAdminAggregateConfig | None:
        return self.remote

    def _save_remote_aggregate(self, aggregate: PortalAdminAggregateConfig) -> None:
        self.remote = aggregate
        self.save_count += 1


def test_migrate_from_sqlite_saves_aggregate_without_runtime_token(tmp_path: Path):
    database_path = tmp_path / "portal.sqlite3"
    sqlite_store = SQLiteConfigStore(database_path)
    portal_payload = {
        **DEFAULT_PORTAL_CONFIG,
        "site": {
            **DEFAULT_PORTAL_CONFIG["site"],
            "browser_title": "SQLite 门户标题",
        },
    }
    runtime_payload = {
        "base_url": "http://sqlite-bisheng.example.com",
        "asset_base_url": "http://sqlite-assets.example.com",
        "username": "sqlite-admin",
        "timeout_seconds": 20,
        "api_token": "must-not-migrate",
        "saved_password": "sqlite-password",
        "last_auth_at": "2026-06-01T00:00:00+00:00",
    }
    unified_auth_payload = UnifiedAuthRuntimeConfig(
        enabled=True,
        provider="custom",
        client_id="sqlite-client",
        client_secret="sqlite-client-secret",
        redirect_uri="https://portal.example.com/callback",
        authorize_url="https://iam.example.com/authorize",
        token_url="https://iam.example.com/token",
        userinfo_url="https://iam.example.com/userinfo",
        state_secret="sqlite-state-secret",
        login_sync_hmac_secret="sqlite-login-sync-secret",
    ).model_dump(mode="json")
    sqlite_store.upsert_document("portal_config", portal_payload)
    sqlite_store.upsert_document("bisheng_runtime_config", runtime_payload)
    sqlite_store.upsert_document("unified_auth_runtime_config", unified_auth_payload)

    store = MemoryRemotePortalAdminConfigStore(database_path=database_path)
    result = store.migrate_from_sqlite()

    assert result == {"migrated": True, "skipped": False, "version": 1}
    assert store.save_count == 1
    assert store.remote is not None
    assert store.remote.portal.site.browser_title == "SQLite 门户标题"
    assert str(store.remote.bisheng.base_url) == "http://sqlite-bisheng.example.com/"
    assert store.remote.bisheng.username == "sqlite-admin"
    assert store.remote.bisheng.saved_password == "sqlite-password"
    assert store.remote.unified_auth.client_secret == "sqlite-client-secret"
    assert "api_token" not in store.remote.model_dump(mode="json")["bisheng"]


def test_migrate_from_sqlite_skips_existing_remote_config(tmp_path: Path):
    existing = PortalAdminAggregateConfig(
        portal=DEFAULT_PORTAL_CONFIG,
        bisheng=PortalBishengPersistentConfig(base_url="http://existing.example.com"),
    )
    store = MemoryRemotePortalAdminConfigStore(
        database_path=tmp_path / "portal.sqlite3",
        remote=existing,
    )

    result = store.migrate_from_sqlite()

    assert result == {
        "migrated": False,
        "skipped": True,
        "reason": "remote_config_exists",
    }
    assert store.remote is existing
    assert store.save_count == 0


def test_get_document_does_not_use_sqlite_as_runtime_fallback(tmp_path: Path):
    database_path = tmp_path / "portal.sqlite3"
    sqlite_store = SQLiteConfigStore(database_path)
    sqlite_store.upsert_document(
        "portal_config",
        {
            **DEFAULT_PORTAL_CONFIG,
            "site": {
                **DEFAULT_PORTAL_CONFIG["site"],
                "browser_title": "不应作为运行期配置",
            },
        },
    )
    store = MemoryRemotePortalAdminConfigStore(database_path=database_path)

    assert store.get_document("portal_config") is None


def test_upsert_document_updates_remote_section_without_sqlite_fallback(tmp_path: Path):
    store = MemoryRemotePortalAdminConfigStore(database_path=tmp_path / "portal.sqlite3")
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
    assert store.save_count == 1
    assert SQLiteConfigStore(tmp_path / "portal.sqlite3").get_document("portal_config") is None


def test_bisheng_runtime_service_can_store_runtime_state_in_memory(tmp_path: Path):
    runtime_service = BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://bisheng.example.com",
        default_timeout_seconds=30.0,
        database_path=tmp_path / "portal.sqlite3",
        store=InMemoryConfigStore(),
    )

    config = runtime_service.get_public_config()

    assert str(config.base_url) == "http://bisheng.example.com/"
    assert not (tmp_path / "portal.sqlite3").exists()
