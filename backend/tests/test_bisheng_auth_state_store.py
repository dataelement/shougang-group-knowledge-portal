import asyncio
import json
import time

import pytest
from redis.exceptions import ConnectionError

from app.schemas.bisheng_runtime import BishengRuntimeAuthUser
from app.services.bisheng_auth_state_store import (
    BishengAuthStateStoreError,
    BishengSharedAuthState,
    RedisBishengAuthStateStore,
)


class FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.expirations: dict[str, int] = {}

    async def get(self, name: str):
        return self.values.get(name)

    async def set(self, name: str, value: str, *, ex: int, nx: bool = False):
        if nx and name in self.values:
            return False
        self.values[name] = value
        self.expirations[name] = ex
        return True

    async def delete(self, *names: str):
        deleted = 0
        for name in names:
            if name in self.values:
                deleted += 1
                self.values.pop(name, None)
                self.expirations.pop(name, None)
        return deleted

    async def eval(self, _script: str, _numkeys: int, key: str, owner: str):
        if self.values.get(key) != owner:
            return 0
        return await self.delete(key)


class FailingRedis(FakeRedis):
    async def get(self, name: str):
        raise ConnectionError("redis unavailable")


def build_state(**overrides) -> BishengSharedAuthState:
    values = {
        "access_token": "shared-token",
        "connected": True,
        "auth_message": "已连接",
        "auth_user": BishengRuntimeAuthUser(
            account="portal-admin",
            name="门户服务账号",
            role="管理员",
            external_id="E1001",
        ),
        "last_auth_at": "2026-07-17T10:00:00+00:00",
        "expires_at": time.time() + 3600,
        "version": "state-v1",
    }
    values.update(overrides)
    return BishengSharedAuthState(**values)


def test_redis_auth_state_roundtrip_uses_token_ttl_and_excludes_credentials():
    redis = FakeRedis()
    store = RedisBishengAuthStateStore(redis)

    asyncio.run(store.save("config-fingerprint", build_state()))
    loaded = asyncio.run(store.get("config-fingerprint"))

    assert loaded is not None
    assert loaded.access_token == "shared-token"
    assert loaded.auth_user is not None
    assert loaded.auth_user.account == "portal-admin"
    state_key = store.state_key("config-fingerprint")
    raw = redis.values[state_key]
    payload = json.loads(raw)
    assert payload["access_token"] == "shared-token"
    assert "password" not in raw.lower()
    assert "saved_password" not in raw
    assert 3500 <= redis.expirations[state_key] <= 3600


def test_expired_shared_state_is_deleted_and_not_returned():
    redis = FakeRedis()
    store = RedisBishengAuthStateStore(redis)
    state_key = store.state_key("config-fingerprint")
    redis.values[state_key] = build_state(expires_at=time.time() - 1).model_dump_json()

    assert asyncio.run(store.get("config-fingerprint")) is None
    assert state_key not in redis.values


def test_refresh_lock_release_is_owner_safe():
    redis = FakeRedis()
    store = RedisBishengAuthStateStore(redis)

    assert asyncio.run(store.acquire_refresh_lock("config-fingerprint", "owner-a", ttl_seconds=10))
    assert not asyncio.run(store.acquire_refresh_lock("config-fingerprint", "owner-b", ttl_seconds=10))

    asyncio.run(store.release_refresh_lock("config-fingerprint", "owner-b"))
    assert not asyncio.run(store.acquire_refresh_lock("config-fingerprint", "owner-b", ttl_seconds=10))

    asyncio.run(store.release_refresh_lock("config-fingerprint", "owner-a"))
    assert asyncio.run(store.acquire_refresh_lock("config-fingerprint", "owner-b", ttl_seconds=10))


def test_redis_failures_are_fail_closed_without_secret_leakage():
    store = RedisBishengAuthStateStore(FailingRedis())

    with pytest.raises(BishengAuthStateStoreError) as exc_info:
        asyncio.run(store.get("config-fingerprint"))

    assert "Redis" in str(exc_info.value)
    assert "shared-token" not in str(exc_info.value)
