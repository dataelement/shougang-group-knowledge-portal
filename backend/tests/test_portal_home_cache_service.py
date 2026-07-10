import asyncio

from redis.exceptions import ConnectionError

from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int]] = []

    async def get(self, name: str):
        return self.values.get(name)

    async def set(self, name: str, value: str, ex: int):
        self.values[name] = value
        self.set_calls.append((name, value, ex))
        return True


def test_cache_round_trips_json_with_ttl():
    async def run():
        redis = FakeRedis()
        service = PortalHomeCacheService(redis)

        await service.set_json("portal:test", {"count": 3}, 1800)

        assert await service.get_json("portal:test") == {"count": 3}
        assert redis.set_calls == [("portal:test", '{"count":3}', 1800)]

    asyncio.run(run())


def test_cache_returns_miss_when_redis_is_disabled_or_fails():
    class FailingRedis(FakeRedis):
        async def get(self, name: str):
            raise ConnectionError("unavailable")

        async def set(self, name: str, value: str, ex: int):
            raise ConnectionError("unavailable")

    async def run():
        assert await PortalHomeCacheService().get_json("portal:test") is None
        service = PortalHomeCacheService(FailingRedis())
        assert await service.get_json("portal:test") is None
        await service.set_json("portal:test", {"count": 3}, 1800)

    asyncio.run(run())


def test_home_content_cache_key_isolated_by_user_and_visible_spaces(tmp_path):
    config = PortalConfigService(config_path=tmp_path / "portal.json").get_config()

    anonymous = PortalHomeCacheService.home_content_key(config=config)
    alice = PortalHomeCacheService.home_content_key(
        config=config,
        account="alice",
        visible_space_ids=[12, 18],
    )
    bob = PortalHomeCacheService.home_content_key(
        config=config,
        account="bob",
        visible_space_ids=[12, 18],
    )
    alice_changed_scope = PortalHomeCacheService.home_content_key(
        config=config,
        account="alice",
        visible_space_ids=[12, 25],
    )

    assert len({anonymous, alice, bob, alice_changed_scope}) == 4
    assert "alice" not in alice
    assert "bob" not in bob


def test_invalid_cached_json_is_treated_as_a_miss():
    async def run():
        redis = FakeRedis()
        redis.values["portal:invalid"] = "not-json"
        service = PortalHomeCacheService(redis)

        assert await service.get_json("portal:invalid") is None

    asyncio.run(run())
