import json

from fastapi.testclient import TestClient

from app.api.dependencies import get_portal_config_service
from app.main import app
from app.schemas.portal_config import CategoryCardsConfigUpdate
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService


class FakeBisheng:
    def __init__(self, counts: dict[str, int]):
        self.counts = counts
        self.count_requests: list[dict] = []

    async def get_json(self, path: str):
        assert path == "/api/v1/knowledge/space/grouped"
        return {
            "status_code": 200,
            "data": {
                "public_spaces": [{"id": 11, "name": "公开空间", "auth_type": "public"}],
                "team_spaces": [{"id": 12, "name": "团队空间", "auth_type": "private"}],
            },
        }

    async def post_json(self, path: str, json: dict | None = None):
        assert path == "/api/v1/knowledge/shougang-portal/category-file-counts"
        self.count_requests.append(json or {})
        categories = (json or {}).get("categories", [])
        return {
            "status_code": 200,
            "data": {
                "counts": {
                    item["code"]: self.counts.get(item["code"], 0) if item.get("space_ids") else 0
                    for item in categories
                }
            },
        }


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


def _config_service(tmp_path) -> PortalConfigService:
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_category_cards(
        CategoryCardsConfigUpdate(
            category_cards=[
                {
                    "code": "STD",
                    "name": "标准",
                    "image": "",
                    "space_ids": [11, 12],
                    "enabled": True,
                }
            ]
        )
    )
    return config_service


def test_category_file_counts_matches_anonymous_default_list_scope_and_uses_cache(tmp_path):
    config_service = _config_service(tmp_path)
    bisheng = FakeBisheng({"STD": 12})
    redis = InMemoryRedis()
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        with TestClient(app) as client:
            client.app.state.bisheng_client = bisheng
            client.app.state.portal_home_cache_service = PortalHomeCacheService(redis)

            first = client.get("/api/v1/knowledge/category-file-counts")
            second = client.get("/api/v1/knowledge/category-file-counts")
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == 200
    assert first.json()["data"] == {"counts": {"STD": 12}}
    assert second.json()["data"] == {"counts": {"STD": 12}}
    assert bisheng.count_requests == [{"categories": [{"code": "STD", "space_ids": [11]}]}]
    assert len(redis.set_calls) == 1
    assert redis.set_calls[0][2] == 1800


def test_category_file_count_cache_key_isolated_by_account_and_visible_scope():
    anonymous_key = PortalHomeCacheService.visible_category_file_counts_key(
        [{"code": "STD", "space_ids": [11]}]
    )
    alice_key = PortalHomeCacheService.visible_category_file_counts_key(
        [{"code": "STD", "space_ids": [11]}], account="alice"
    )
    bob_key = PortalHomeCacheService.visible_category_file_counts_key(
        [{"code": "STD", "space_ids": [11]}], account="bob"
    )
    alice_changed_scope_key = PortalHomeCacheService.visible_category_file_counts_key(
        [{"code": "STD", "space_ids": [11, 12]}], account="alice"
    )

    assert anonymous_key != alice_key
    assert alice_key != bob_key
    assert alice_key != alice_changed_scope_key


def test_category_file_counts_returns_zero_when_configured_space_scope_is_empty(tmp_path):
    config_service = _config_service(tmp_path)
    config_service.update_category_cards(
        CategoryCardsConfigUpdate(
            category_cards=[
                {
                    "code": "STD",
                    "name": "标准",
                    "image": "",
                    "space_ids": [],
                    "enabled": True,
                }
            ]
        )
    )
    bisheng = FakeBisheng({"STD": 12})
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        with TestClient(app) as client:
            client.app.state.bisheng_client = bisheng
            client.app.state.portal_home_cache_service = PortalHomeCacheService()
            response = client.get("/api/v1/knowledge/category-file-counts")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"] == {"counts": {"STD": 0}}
    assert bisheng.count_requests == [{"categories": [{"code": "STD", "space_ids": []}]}]


def test_invalid_cached_category_count_falls_back_to_bisheng(tmp_path):
    config_service = _config_service(tmp_path)
    bisheng = FakeBisheng({"STD": 12})
    redis = InMemoryRedis()
    cache_service = PortalHomeCacheService(redis)
    cache_key = cache_service.visible_category_file_counts_key([{"code": "STD", "space_ids": [11]}])
    redis.values[cache_key] = json.dumps({"counts": {"STD": "invalid"}})
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        with TestClient(app) as client:
            client.app.state.bisheng_client = bisheng
            client.app.state.portal_home_cache_service = cache_service
            response = client.get("/api/v1/knowledge/category-file-counts")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"] == {"counts": {"STD": 12}}
    assert len(bisheng.count_requests) == 1
    assert len(redis.set_calls) == 1


class BrokenBisheng(FakeBisheng):
    async def post_json(self, path: str, json: dict | None = None):
        raise RuntimeError("bisheng unavailable")


def test_category_file_counts_degrades_to_zero_when_bisheng_fails(tmp_path):
    config_service = _config_service(tmp_path)
    bisheng = BrokenBisheng({"STD": 12})
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        with TestClient(app) as client:
            client.app.state.bisheng_client = bisheng
            client.app.state.portal_home_cache_service = PortalHomeCacheService()
            response = client.get("/api/v1/knowledge/category-file-counts")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["data"] == {"counts": {"STD": 0}}
