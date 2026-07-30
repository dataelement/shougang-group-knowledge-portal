import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI

import app.main as main_module
from app.main import lifespan
from app.settings import Settings


def run_lifespan(app):
    async def scenario():
        async with lifespan(app):
            return None

    return asyncio.run(scenario())


def test_production_without_redis_configuration_fails_startup(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(app_env="production", redis_url=None),
    )

    with pytest.raises(RuntimeError, match="必须配置 PORTAL_REDIS_URL"):
        run_lifespan(FastAPI())


def test_production_with_unreachable_redis_fails_without_leaking_url(
    monkeypatch,
):
    class FailingRedis:
        closed = False

        async def ping(self):
            raise ConnectionError("redis://user:secret@redis.internal")

        async def aclose(self):
            self.closed = True

    redis = FailingRedis()
    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            app_env="production",
            redis_url="redis://user:secret@redis.internal",
        ),
    )
    monkeypatch.setattr(
        main_module.redis_asyncio,
        "from_url",
        lambda *args, **kwargs: redis,
    )

    with pytest.raises(RuntimeError) as exc_info:
        run_lifespan(FastAPI())

    assert str(exc_info.value) == "Redis 不可用，无法启动门户认证服务"
    assert "secret" not in str(exc_info.value)
    assert redis.closed is True


def test_development_redis_failure_uses_explicit_single_process_fallback(
    monkeypatch,
    caplog,
):
    class FailingRedis:
        async def ping(self):
            raise ConnectionError("redis unavailable")

        async def aclose(self):
            return None

    class FakeRuntimeService:
        def __init__(self, *args, **kwargs):
            return None

        async def initialize(self):
            return None

        async def aclose(self):
            return None

    class FakeRemoteStore:
        skip_startup_seed = True

        def __init__(self, *, runtime_service):
            self.runtime_service = runtime_service

        def load_remote_aggregate(self):
            return None

        def get_document(self, table_name, legacy_key=None):
            return None

        def upsert_document(self, table_name, payload):
            return SimpleNamespace(document=payload, version=None)

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            app_env="development",
            redis_url="redis://redis.internal",
        ),
    )
    monkeypatch.setattr(
        main_module.redis_asyncio,
        "from_url",
        lambda *args, **kwargs: FailingRedis(),
    )
    monkeypatch.setattr(main_module, "BishengRuntimeService", FakeRuntimeService)
    monkeypatch.setattr(
        main_module,
        "RemotePortalAdminConfigStore",
        FakeRemoteStore,
    )

    app = FastAPI()
    run_lifespan(app)

    assert app.state.portal_runtime_config_coordinator is None
    assert "开发环境已降级为进程内会话存储" in caplog.text


def test_runtime_snapshot_is_initialized_before_listener_and_readiness(
    monkeypatch,
):
    events = []

    class HealthyRedis:
        async def ping(self):
            return True

        async def aclose(self):
            events.append("redis-close")

    class FakeRuntimeService:
        def __init__(self, *args, **kwargs):
            return None

        async def initialize(self):
            return None

        async def aclose(self):
            events.append("runtime-close")

    class FakeRemoteStore:
        skip_startup_seed = True

        def __init__(self, *, runtime_service):
            self.runtime_service = runtime_service

        def load_remote_aggregate(self):
            return None

        def enable_shared_cache(self):
            events.append("cache-enabled")

        def get_document(self, table_name, legacy_key=None):
            return None

        def upsert_document(self, table_name, payload):
            return SimpleNamespace(document=payload, version=None)

    class FakeCoordinator:
        def __init__(self, **kwargs):
            self.local_version = 0

        async def initialize(self):
            events.append("snapshot-initialized")
            self.local_version = 1

        async def start_listener(self):
            events.append("listener-started")

        async def stop_listener(self):
            events.append("listener-stopped")

    monkeypatch.setattr(
        main_module,
        "get_settings",
        lambda: Settings(
            app_env="production",
            redis_url="redis://redis.internal",
        ),
    )
    monkeypatch.setattr(
        main_module.redis_asyncio,
        "from_url",
        lambda *args, **kwargs: HealthyRedis(),
    )
    monkeypatch.setattr(main_module, "BishengRuntimeService", FakeRuntimeService)
    monkeypatch.setattr(
        main_module,
        "RemotePortalAdminConfigStore",
        FakeRemoteStore,
    )
    monkeypatch.setattr(
        main_module,
        "PortalRuntimeConfigCoordinator",
        FakeCoordinator,
    )

    run_lifespan(FastAPI())

    assert events.index("snapshot-initialized") < events.index("listener-started")
    assert events.index("listener-stopped") < events.index("runtime-close")
    assert events.index("runtime-close") < events.index("redis-close")
