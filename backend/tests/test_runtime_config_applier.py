import asyncio

import pytest

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import (
    PortalAdminAggregateConfig,
    PortalBishengPersistentConfig,
)
from app.services.runtime_config_applier import RuntimeConfigApplier


def aggregate(version: int, *, base_url: str = "http://bisheng.example.com"):
    return PortalAdminAggregateConfig(
        version=version,
        portal=DEFAULT_PORTAL_CONFIG,
        bisheng=PortalBishengPersistentConfig(base_url=base_url),
    )


class FakeAggregateStore:
    def __init__(self):
        self.snapshot = None
        self.history = []

    def set_cached_aggregate(self, snapshot):
        self.snapshot = snapshot
        self.history.append(snapshot.version)


class FakeRuntimeService:
    def __init__(self):
        self.applied = []
        self.fail = False

    async def apply_persistent_config(self, config):
        if self.fail:
            raise ValueError("invalid runtime config")
        self.applied.append(str(config.base_url))


def run(coro):
    return asyncio.run(coro)


def test_applier_atomically_advances_store_and_runtime_version():
    store = FakeAggregateStore()
    runtime_service = FakeRuntimeService()
    applier = RuntimeConfigApplier(
        aggregate_store=store,
        bisheng_runtime_service=runtime_service,
    )

    changed = run(applier.apply(aggregate(2, base_url="http://new.example.com")))

    assert changed is True
    assert applier.local_version == 2
    assert store.snapshot.version == 2
    assert runtime_service.applied == ["http://new.example.com/"]


def test_applier_ignores_same_or_older_version_without_replacing_runtime():
    store = FakeAggregateStore()
    runtime_service = FakeRuntimeService()
    applier = RuntimeConfigApplier(
        aggregate_store=store,
        bisheng_runtime_service=runtime_service,
    )

    async def scenario():
        await applier.apply(aggregate(3))
        same = await applier.apply(aggregate(3))
        older = await applier.apply(aggregate(2))
        return same, older

    same, older = run(scenario())

    assert same is False
    assert older is False
    assert store.history == [3]
    assert len(runtime_service.applied) == 1


def test_invalid_runtime_snapshot_keeps_last_valid_aggregate():
    store = FakeAggregateStore()
    runtime_service = FakeRuntimeService()
    applier = RuntimeConfigApplier(
        aggregate_store=store,
        bisheng_runtime_service=runtime_service,
    )

    async def scenario():
        await applier.apply(aggregate(1))
        runtime_service.fail = True
        with pytest.raises(ValueError, match="invalid runtime config"):
            await applier.apply(aggregate(2, base_url="http://invalid.example.com"))

    run(scenario())

    assert applier.local_version == 1
    assert store.snapshot.version == 1
    assert store.history == [1]
