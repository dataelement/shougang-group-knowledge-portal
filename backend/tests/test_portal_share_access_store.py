import asyncio
import json
import time

import pytest
from redis.exceptions import ConnectionError

from app.services.portal_share_access_store import (
    InMemoryPortalShareAccessSessionStore,
    PortalShareAccessSession,
    PortalShareAccessStoreError,
    RedisPortalShareAccessSessionStore,
    build_portal_share_access_session_store,
)


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def get(self, name: str):
        return self.values.get(name)

    async def set(self, name: str, value: str, ex: int):
        self.values[name] = value
        self.ttls[name] = ex
        return True

    async def delete(self, name: str):
        self.values.pop(name, None)
        self.ttls.pop(name, None)
        return 1


class FailingRedis(FakeRedis):
    async def get(self, name: str):
        raise ConnectionError("secret redis endpoint")

    async def set(self, name: str, value: str, ex: int):
        raise ConnectionError("secret redis endpoint")


def _session(**overrides) -> PortalShareAccessSession:
    values = {
        "session_id": "opaque-session",
        "share_token": "share-1",
        "space_id": 12,
        "file_id": 1580,
        "allow_download": True,
        "download_grant": "opaque-grant",
        "portal_session_id": "portal-session-1",
        "expires_at": time.time() + 300,
    }
    values.update(overrides)
    return PortalShareAccessSession(**values)


def test_redis_store_serializes_with_v2_key_ttl_and_reads_across_instances():
    async def run():
        redis = FakeRedis()
        writer = RedisPortalShareAccessSessionStore(redis)
        reader = RedisPortalShareAccessSessionStore(redis)
        session = _session(expires_at=time.time() + 120)

        await writer.save(session)
        restored = await reader.get(
            session.session_id,
            share_token="share-1",
            space_id=12,
            file_id=1580,
            portal_session_id="portal-session-1",
            require_download=True,
        )

        key = "shougang_portal:share_access:v2:opaque-session"
        assert restored == session
        assert key in redis.values
        assert 1 <= redis.ttls[key] <= 120
        payload = json.loads(redis.values[key])
        assert payload["download_grant"] == "opaque-grant"

    asyncio.run(run())


def test_redis_store_rounds_subsecond_remaining_ttl_up_to_one_second():
    async def run():
        redis = FakeRedis()
        store = RedisPortalShareAccessSessionStore(redis)
        session = _session(expires_at=time.time() + 0.5)

        await store.save(session)

        assert redis.ttls[store.session_key(session.session_id)] == 1

    asyncio.run(run())


@pytest.mark.parametrize(
    ("overrides", "lookup"),
    [
        ({}, {"share_token": "other"}),
        ({}, {"space_id": 99}),
        ({}, {"file_id": 99}),
        ({}, {"portal_session_id": "other"}),
        ({"allow_download": False}, {}),
        ({"download_grant": ""}, {}),
    ],
)
def test_download_lookup_fails_closed_on_binding_or_grant_mismatch(overrides, lookup):
    async def run():
        store = InMemoryPortalShareAccessSessionStore()
        session = _session(**overrides)
        await store.save(session)
        params = {
            "share_token": "share-1",
            "space_id": 12,
            "file_id": 1580,
            "portal_session_id": "portal-session-1",
            "require_download": True,
        }
        params.update(lookup)

        assert await store.get(session.session_id, **params) is None

    asyncio.run(run())


def test_anonymous_view_session_is_valid_for_view_but_never_for_download():
    async def run():
        store = InMemoryPortalShareAccessSessionStore()
        session = _session(
            allow_download=True,
            download_grant="",
            portal_session_id="",
            expires_at=time.time() + 3600,
        )
        await store.save(session)

        view = await store.get(
            session.session_id,
            share_token="share-1",
            space_id=12,
            file_id=1580,
        )
        download = await store.get(
            session.session_id,
            share_token="share-1",
            space_id=12,
            file_id=1580,
            portal_session_id="portal-session-1",
            require_download=True,
        )

        assert view == session
        assert download is None

    asyncio.run(run())


def test_expired_or_invalid_payload_is_removed_and_ignored():
    async def run():
        redis = FakeRedis()
        store = RedisPortalShareAccessSessionStore(redis)
        key = store.session_key("expired")
        redis.values[key] = json.dumps(
            {
                "session_id": "expired",
                "share_token": "share-1",
                "space_id": 12,
                "file_id": 1580,
                "allow_download": False,
                "download_grant": "",
                "portal_session_id": "",
                "expires_at": time.time() - 1,
            }
        )

        assert await store.get("expired", share_token="share-1", space_id=12, file_id=1580) is None
        assert key not in redis.values

        redis.values[store.session_key("invalid")] = "not-json"
        assert await store.get("invalid", share_token="share-1", space_id=12, file_id=1580) is None

    asyncio.run(run())


def test_redis_errors_fail_closed_without_exposing_backend_details():
    async def run():
        store = RedisPortalShareAccessSessionStore(FailingRedis())
        with pytest.raises(PortalShareAccessStoreError, match="分享访问服务暂不可用") as error:
            await store.save(_session())
        assert "endpoint" not in str(error.value)

        with pytest.raises(PortalShareAccessStoreError, match="分享访问服务暂不可用"):
            await store.get("id", share_token="share-1", space_id=12, file_id=1580)

    asyncio.run(run())


def test_store_factory_uses_memory_only_for_development_without_redis():
    assert isinstance(
        build_portal_share_access_session_store(None, app_env="development"),
        InMemoryPortalShareAccessSessionStore,
    )
    with pytest.raises(RuntimeError, match="Redis"):
        build_portal_share_access_session_store(None, app_env="production")


def test_store_rejects_grant_without_portal_session_binding():
    async def run():
        store = InMemoryPortalShareAccessSessionStore()
        with pytest.raises(ValueError, match="portal session"):
            await store.save(_session(portal_session_id=""))

    asyncio.run(run())
