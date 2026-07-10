import json

from fastapi.testclient import TestClient

from app.api.routes.knowledge import get_domain_file_count_service
from app.api.dependencies import get_portal_config_service
from app.main import app
from app.schemas.portal_config import DomainsConfigUpdate
from app.services.domain_file_count_service import DomainFileCountService, reset_domain_file_count_cache
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService


class FakeBisheng:
    def __init__(self, counts):
        self.counts = counts

    async def post_json(self, path, json=None):
        codes = (json or {}).get("codes", [])
        return {"status_code": 200, "data": {"counts": {c: self.counts.get(c, 0) for c in codes}}}


class InMemoryRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int]] = []

    async def get(self, name: str):
        return self.values.get(name)

    async def set(self, name: str, value: str, ex: int):
        self.values[name] = value
        self.set_calls.append((name, value, ex))
        return True


def test_domain_file_counts_route(tmp_path):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {"name": "生产", "space_ids": [], "color": "#1", "bg": "#2", "icon": "Factory",
                 "background_image": "", "enabled": True, "code": "PP"},
                {"name": "质量", "space_ids": [], "color": "#1", "bg": "#2", "icon": "CheckCircle",
                 "background_image": "", "enabled": True, "code": "QM"},
            ]
        )
    )
    bisheng = FakeBisheng({"PP": 12, "QM": 3})

    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    app.dependency_overrides[get_domain_file_count_service] = lambda: DomainFileCountService(
        bisheng_client=bisheng, config_service=config_service
    )
    try:
        client = TestClient(app)
        first = client.get("/api/v1/knowledge/domain-file-counts")
        assert first.status_code == 200
        assert set(first.json()["data"]["counts"].keys()) == {"PP", "QM"}
        second = client.get("/api/v1/knowledge/domain-file-counts")
        assert second.json()["data"]["counts"] == {"PP": 12, "QM": 3}
    finally:
        app.dependency_overrides.clear()
        reset_domain_file_count_cache()


def test_domain_file_counts_serves_redis_cached_response(tmp_path):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "生产",
                    "space_ids": [],
                    "color": "#1",
                    "bg": "#2",
                    "icon": "Factory",
                    "background_image": "",
                    "enabled": True,
                    "code": "PP",
                }
            ]
        )
    )
    redis = InMemoryRedis()
    cache_service = PortalHomeCacheService(redis)
    redis.values[cache_service.domain_file_counts_key(["PP"])] = json.dumps({"counts": {"PP": 12}})

    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        with TestClient(app) as client:
            client.app.state.portal_home_cache_service = cache_service
            response = client.get("/api/v1/knowledge/domain-file-counts")
    finally:
        app.dependency_overrides.clear()
        reset_domain_file_count_cache()

    assert response.status_code == 200
    assert response.json()["data"] == {"counts": {"PP": 12}}


def test_domain_file_counts_does_not_cache_stale_response(tmp_path):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "生产",
                    "space_ids": [],
                    "color": "#1",
                    "bg": "#2",
                    "icon": "Factory",
                    "background_image": "",
                    "enabled": True,
                    "code": "PP",
                }
            ]
        )
    )
    redis = InMemoryRedis()
    bisheng = FakeBisheng({"PP": 12})

    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    app.dependency_overrides[get_domain_file_count_service] = lambda: DomainFileCountService(
        bisheng_client=bisheng,
        config_service=config_service,
    )
    try:
        with TestClient(app) as client:
            client.app.state.portal_home_cache_service = PortalHomeCacheService(redis)
            response = client.get("/api/v1/knowledge/domain-file-counts")
    finally:
        app.dependency_overrides.clear()
        reset_domain_file_count_cache()

    assert response.status_code == 200
    assert redis.set_calls == []
