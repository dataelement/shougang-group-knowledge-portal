import asyncio
import json

import pytest

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import (
    PortalAdminAggregateConfig,
    PortalBishengPersistentConfig,
)
from app.services.portal_runtime_config_coordinator import (
    PortalRuntimeConfigCoordinator,
    RuntimeConfigSyncError,
)


def aggregate(version: int, *, title: str = "门户", password: str = "runtime-secret"):
    portal = {
        **DEFAULT_PORTAL_CONFIG,
        "site": {
            **DEFAULT_PORTAL_CONFIG["site"],
            "browser_title": title,
        },
    }
    return PortalAdminAggregateConfig(
        version=version,
        portal=portal,
        bisheng=PortalBishengPersistentConfig(
            base_url="http://bisheng.example.com",
            username="portal-admin",
            saved_password=password,
        ),
    )


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.published = []
        self.raise_on_write = False
        self.raise_on_get = False

    async def get(self, key):
        if self.raise_on_get:
            raise ConnectionError("redis unavailable")
        return self.values.get(key)

    async def set(self, key, value, *, ex=None, nx=False):
        if self.raise_on_write:
            raise ConnectionError("redis unavailable")
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def delete(self, *keys):
        for key in keys:
            self.values.pop(key, None)

    async def eval(self, _script, _numkeys, key, candidate):
        if self.raise_on_write:
            raise ConnectionError("redis unavailable")
        current = int(self.values.get(key) or 0)
        candidate_version = int(candidate)
        if candidate_version <= current:
            return 0
        self.values[key] = str(candidate_version)
        return 1

    async def publish(self, channel, message):
        if self.raise_on_write:
            raise ConnectionError("redis unavailable")
        self.published.append((channel, message))
        return 1


def run(coro):
    return asyncio.run(coro)


def test_two_instances_converge_via_shared_version_without_pubsub_delivery():
    redis = FakeRedis()
    database = {"snapshot": aggregate(1)}
    applied_a = []
    applied_b = []

    async def load_database():
        return database["snapshot"]

    async def apply_a(snapshot):
        applied_a.append(snapshot)

    async def apply_b(snapshot):
        applied_b.append(snapshot)

    coordinator_a = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_a,
    )
    coordinator_b = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_b,
    )

    async def scenario():
        await coordinator_a.initialize()
        await coordinator_b.initialize()
        database["snapshot"] = aggregate(2, title="新标题")
        await coordinator_a.commit_saved_snapshot(database["snapshot"])
        refreshed = await coordinator_b.ensure_current()
        return refreshed

    refreshed = run(scenario())

    assert refreshed is True
    assert coordinator_a.local_version == 2
    assert coordinator_b.local_version == 2
    assert applied_b[-1].portal.site.browser_title == "新标题"


def test_cache_miss_with_new_shared_version_recovers_from_database():
    redis = FakeRedis()
    redis.values["portal:runtime-config:v1:tenant-1:latest"] = "3"
    database = aggregate(3, title="数据库恢复")
    applied = []

    async def load_database():
        return database

    async def apply_snapshot(snapshot):
        applied.append(snapshot)

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_snapshot,
    )

    run(coordinator.ensure_current())

    assert coordinator.local_version == 3
    assert applied[-1].portal.site.browser_title == "数据库恢复"
    assert coordinator.snapshot_key(3) in redis.values


def test_out_of_order_snapshot_never_downgrades_versions():
    redis = FakeRedis()
    applied = []

    async def load_database():
        return aggregate(4)

    async def apply_snapshot(snapshot):
        applied.append(snapshot.version)

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_snapshot,
    )

    async def scenario():
        await coordinator.commit_saved_snapshot(aggregate(4))
        await coordinator.commit_saved_snapshot(aggregate(2))

    run(scenario())

    assert coordinator.local_version == 4
    assert int(redis.values[coordinator.latest_key]) == 4
    assert applied == [4]
    assert len(redis.published) == 1


def test_redis_write_failure_is_reported_after_database_snapshot_is_applied():
    redis = FakeRedis()
    redis.raise_on_write = True
    applied = []

    async def load_database():
        return aggregate(2)

    async def apply_snapshot(snapshot):
        applied.append(snapshot.version)

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_snapshot,
    )

    with pytest.raises(RuntimeConfigSyncError):
        run(coordinator.commit_saved_snapshot(aggregate(2)))

    assert applied == [2]
    assert coordinator.local_version == 2


def test_keys_and_invalidation_messages_do_not_contain_secrets():
    redis = FakeRedis()

    async def load_database():
        return aggregate(2)

    async def apply_snapshot(_snapshot):
        return None

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_snapshot,
    )

    run(coordinator.commit_saved_snapshot(aggregate(2, password="do-not-leak")))

    channel, raw_message = redis.published[-1]
    message = json.loads(raw_message)
    assert "do-not-leak" not in coordinator.latest_key
    assert "do-not-leak" not in channel
    assert "do-not-leak" not in raw_message
    assert message == {
        "scope": "tenant-1",
        "version": 2,
        "sections": ["portal", "bisheng", "unified_auth"],
    }


def test_runtime_redis_disconnect_keeps_last_valid_read_snapshot():
    redis = FakeRedis()

    async def load_database():
        return aggregate(1)

    async def apply_snapshot(_snapshot):
        return None

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=redis,
        scope="tenant-1",
        load_remote=load_database,
        apply_snapshot=apply_snapshot,
    )

    async def scenario():
        await coordinator.commit_saved_snapshot(aggregate(1))
        redis.raise_on_get = True
        return await coordinator.ensure_current()

    refreshed = run(scenario())

    assert refreshed is False
    assert coordinator.local_version == 1


def test_listener_disconnect_uses_bounded_backoff_before_reconnect():
    delays = []
    holder = {}

    class DisconnectingPubSub:
        async def subscribe(self, _channel):
            return None

        async def listen(self):
            if False:
                yield None
            raise ConnectionError("listener disconnected")

        async def aclose(self):
            return None

    class DisconnectingRedis(FakeRedis):
        def pubsub(self):
            return DisconnectingPubSub()

    async def record_sleep(delay):
        delays.append(delay)
        holder["coordinator"]._stopping.set()

    coordinator = PortalRuntimeConfigCoordinator(
        redis_client=DisconnectingRedis(),
        scope="tenant-1",
        load_remote=lambda: aggregate(1),
        apply_snapshot=lambda _snapshot: None,
        sleeper=record_sleep,
    )
    holder["coordinator"] = coordinator

    run(coordinator._listener_loop())

    assert len(delays) == 1
    assert 0.25 <= delays[0] <= 0.3125
