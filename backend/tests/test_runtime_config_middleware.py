from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.api.dependencies import (
    get_portal_config_service,
    require_admin_session,
)
from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.main import app
from app.schemas.portal_admin_config import (
    PortalAdminAggregateConfig,
    PortalBishengPersistentConfig,
)
from app.services.config_store import ConfigStoreWriteResult
from app.services.portal_config_service import PortalConfigService


class SavedAggregateStore:
    skip_startup_seed = True

    def __init__(self):
        self.aggregate = PortalAdminAggregateConfig(
            version=1,
            portal=DEFAULT_PORTAL_CONFIG,
            bisheng=PortalBishengPersistentConfig(
                base_url="http://bisheng.example.com"
            ),
        )
        self.last_saved_aggregate = None

    def get_document(self, table_name, legacy_key=None):
        assert table_name == "portal_config"
        return self.aggregate.portal.model_dump(mode="json")

    def upsert_document(self, table_name, payload):
        assert table_name == "portal_config"
        aggregate_data = self.aggregate.model_dump(mode="json")
        aggregate_data.update(
            {
                "version": self.aggregate.version + 1,
                "portal": payload,
            }
        )
        self.aggregate = PortalAdminAggregateConfig.model_validate(aggregate_data)
        self.last_saved_aggregate = self.aggregate
        return ConfigStoreWriteResult(
            document=self.aggregate.portal.model_dump(mode="json"),
            version=self.aggregate.version,
        )


class RecordingCoordinator:
    def __init__(self):
        self.local_version = 1
        self.ensure_calls = 0
        self.committed = []

    async def ensure_current(self):
        self.ensure_calls += 1
        return False

    async def commit_saved_snapshot(self, snapshot):
        self.committed.append(snapshot)
        self.local_version = snapshot.version
        return True

    async def stop_listener(self):
        return None


def test_config_write_middleware_commits_saved_database_snapshot():
    store = SavedAggregateStore()
    service = PortalConfigService(
        config_path=Path("/tmp/unused-portal-config.json"),
        store=store,
    )
    coordinator = RecordingCoordinator()
    app.dependency_overrides[require_admin_session] = lambda: SimpleNamespace()
    app.dependency_overrides[get_portal_config_service] = lambda: service

    with TestClient(app) as client:
        original_store = client.app.state.portal_admin_config_store
        original_coordinator = client.app.state.portal_runtime_config_coordinator
        client.app.state.portal_admin_config_store = store
        client.app.state.portal_runtime_config_coordinator = coordinator
        response = client.post(
            "/api/v1/admin/config/banners",
            json={"banners": []},
        )
        client.app.state.portal_admin_config_store = original_store
        client.app.state.portal_runtime_config_coordinator = original_coordinator

    app.dependency_overrides.pop(require_admin_session, None)
    app.dependency_overrides.pop(get_portal_config_service, None)

    assert response.status_code == 200
    assert coordinator.ensure_calls == 1
    assert [snapshot.version for snapshot in coordinator.committed] == [2]
