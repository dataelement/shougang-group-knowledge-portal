from __future__ import annotations

import asyncio
import inspect
import json
import logging
import random
import re
from collections.abc import Awaitable, Callable
from typing import Any

from redis.exceptions import RedisError

from app.schemas.portal_admin_config import PortalAdminAggregateConfig

logger = logging.getLogger(__name__)

_SCOPE_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_TRANSIENT_REDIS_ERRORS = (RedisError, ConnectionError, TimeoutError, OSError)
_CAS_LATEST_SCRIPT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local candidate = tonumber(ARGV[1])
if candidate <= current then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
"""

LoadRemote = Callable[
    [],
    PortalAdminAggregateConfig
    | dict[str, Any]
    | Awaitable[PortalAdminAggregateConfig | dict[str, Any] | None]
    | None,
]
ApplySnapshot = Callable[
    [PortalAdminAggregateConfig],
    None | Awaitable[None],
]


class RuntimeConfigSyncError(RuntimeError):
    """The DB snapshot exists but cluster-wide Redis coordination failed."""


class PortalRuntimeConfigCoordinator:
    CHANNEL = "portal:runtime-config:v1:invalidate"

    def __init__(
        self,
        *,
        redis_client,
        scope: str,
        load_remote: LoadRemote,
        apply_snapshot: ApplySnapshot,
        cache_ttl_seconds: int = 900,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        normalized_scope = scope.strip()
        if not _SCOPE_PATTERN.fullmatch(normalized_scope):
            raise ValueError("runtime config scope contains unsupported characters")
        if cache_ttl_seconds <= 0:
            raise ValueError("runtime config cache TTL must be positive")

        self._redis = redis_client
        self._scope = normalized_scope
        self._load_remote = load_remote
        self._apply_snapshot = apply_snapshot
        self._cache_ttl_seconds = cache_ttl_seconds
        self._sleeper = sleeper
        self._lock = asyncio.Lock()
        self._local_version = 0
        self._current_aggregate: PortalAdminAggregateConfig | None = None
        self._listener_task: asyncio.Task | None = None
        self._stopping = asyncio.Event()

    @property
    def scope(self) -> str:
        return self._scope

    @property
    def local_version(self) -> int:
        return self._local_version

    @property
    def latest_key(self) -> str:
        return f"portal:runtime-config:v1:{self._scope}:latest"

    def snapshot_key(self, version: int) -> str:
        return f"portal:runtime-config:v1:{self._scope}:snapshot:{int(version)}"

    async def initialize(self) -> PortalAdminAggregateConfig:
        await self.ensure_current(force_database=self._redis is None)
        if self._local_version <= 0 or self._current_aggregate is None:
            raise RuntimeConfigSyncError("门户运行时配置未初始化")
        return self._current_aggregate.model_copy(deep=True)

    async def ensure_current(self, *, force_database: bool = False) -> bool:
        async with self._lock:
            return await self._ensure_current_locked(force_database=force_database)

    async def commit_saved_snapshot(
        self,
        snapshot: PortalAdminAggregateConfig | dict[str, Any],
    ) -> bool:
        aggregate = PortalAdminAggregateConfig.model_validate(snapshot)
        async with self._lock:
            if aggregate.version <= self._local_version:
                return False

            await self._call_apply_snapshot(aggregate)
            self._local_version = aggregate.version
            self._current_aggregate = aggregate.model_copy(deep=True)
            try:
                advanced = await self._write_shared_snapshot(
                    aggregate,
                    publish=True,
                )
            except _TRANSIENT_REDIS_ERRORS as exc:
                logger.error(
                    "portal runtime config Redis sync failed scope=%s version=%s",
                    self._scope,
                    aggregate.version,
                )
                raise RuntimeConfigSyncError(
                    "配置已保存，但跨实例同步未完成，请稍后重试确认"
                ) from exc
            logger.info(
                "portal runtime config committed scope=%s local_version=%s "
                "shared_advanced=%s",
                self._scope,
                self._local_version,
                advanced,
            )
            return advanced

    async def start_listener(self) -> None:
        if self._redis is None or (
            self._listener_task is not None and not self._listener_task.done()
        ):
            return
        self._stopping.clear()
        self._listener_task = asyncio.create_task(
            self._listener_loop(),
            name=f"portal-runtime-config-listener:{self._scope}",
        )

    async def stop_listener(self) -> None:
        self._stopping.set()
        task = self._listener_task
        self._listener_task = None
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _ensure_current_locked(self, *, force_database: bool) -> bool:
        latest_version = 0
        if self._redis is not None and not force_database:
            try:
                latest_version = self._parse_version(
                    await self._redis.get(self.latest_key)
                )
            except _TRANSIENT_REDIS_ERRORS:
                if self._local_version > 0:
                    logger.warning(
                        "portal runtime config version check unavailable; "
                        "using last valid snapshot scope=%s local_version=%s",
                        self._scope,
                        self._local_version,
                    )
                    return False
                force_database = True

        if (
            not force_database
            and latest_version > 0
            and latest_version <= self._local_version
        ):
            return False

        aggregate = None
        refresh_source = "redis-cache"
        if self._redis is not None and latest_version > self._local_version:
            try:
                aggregate = await self._read_cached_snapshot(latest_version)
            except _TRANSIENT_REDIS_ERRORS:
                aggregate = None

        if aggregate is None:
            refresh_source = "database"
            aggregate = await self._call_load_remote()
            if aggregate is None:
                raise RuntimeConfigSyncError("BiSheng 数据库中没有可用的门户配置")

        if aggregate.version <= self._local_version:
            return False
        if latest_version > aggregate.version:
            raise RuntimeConfigSyncError(
                "Redis 配置版本高于数据库版本，已拒绝应用不一致快照"
            )

        await self._call_apply_snapshot(aggregate)
        self._local_version = aggregate.version
        self._current_aggregate = aggregate.model_copy(deep=True)
        logger.info(
            "portal runtime config refreshed scope=%s local_version=%s source=%s",
            self._scope,
            self._local_version,
            refresh_source,
        )

        if self._redis is not None:
            try:
                await self._write_shared_snapshot(aggregate, publish=False)
            except _TRANSIENT_REDIS_ERRORS:
                logger.warning(
                    "portal runtime config cache refresh failed scope=%s version=%s",
                    self._scope,
                    aggregate.version,
                )
        return True

    async def _read_cached_snapshot(
        self,
        version: int,
    ) -> PortalAdminAggregateConfig | None:
        raw = await self._redis.get(self.snapshot_key(version))
        if raw is None:
            return None
        try:
            envelope = json.loads(raw)
            if envelope.get("scope") != self._scope:
                return None
            if int(envelope.get("version") or 0) != version:
                return None
            aggregate = PortalAdminAggregateConfig.model_validate(
                envelope.get("config")
            )
        except (TypeError, ValueError, json.JSONDecodeError):
            await self._redis.delete(self.snapshot_key(version))
            return None
        if aggregate.version != version:
            await self._redis.delete(self.snapshot_key(version))
            return None
        return aggregate

    async def _write_shared_snapshot(
        self,
        aggregate: PortalAdminAggregateConfig,
        *,
        publish: bool,
    ) -> bool:
        if self._redis is None:
            return False
        envelope = json.dumps(
            {
                "scope": self._scope,
                "version": aggregate.version,
                "config": aggregate.model_dump(mode="json"),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        await self._redis.set(
            self.snapshot_key(aggregate.version),
            envelope,
            ex=self._cache_ttl_seconds,
        )
        advanced = bool(
            await self._redis.eval(
                _CAS_LATEST_SCRIPT,
                1,
                self.latest_key,
                str(aggregate.version),
            )
        )
        if advanced and publish:
            message = json.dumps(
                {
                    "scope": self._scope,
                    "version": aggregate.version,
                    "sections": ["portal", "bisheng", "unified_auth"],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            await self._redis.publish(self.CHANNEL, message)
        return advanced

    async def _listener_loop(self) -> None:
        backoff_seconds = 0.25
        while not self._stopping.is_set():
            pubsub = None
            try:
                pubsub = self._redis.pubsub()
                await pubsub.subscribe(self.CHANNEL)
                backoff_seconds = 0.25
                async for message in pubsub.listen():
                    if self._stopping.is_set():
                        return
                    if message.get("type") != "message":
                        continue
                    if not self._message_requires_refresh(message.get("data")):
                        continue
                    await self.ensure_current()
            except asyncio.CancelledError:
                raise
            except _TRANSIENT_REDIS_ERRORS:
                logger.warning(
                    "portal runtime config listener disconnected scope=%s",
                    self._scope,
                )
                delay = min(backoff_seconds, 10.0)
                await self._sleeper(delay + random.uniform(0, delay / 4))
                backoff_seconds = min(backoff_seconds * 2, 10.0)
            finally:
                if pubsub is not None:
                    try:
                        await pubsub.aclose()
                    except _TRANSIENT_REDIS_ERRORS:
                        logger.debug(
                            "portal runtime config pubsub cleanup failed scope=%s",
                            self._scope,
                        )

    def _message_requires_refresh(self, raw_message: object) -> bool:
        try:
            if isinstance(raw_message, bytes):
                raw_message = raw_message.decode("utf-8")
            payload = json.loads(str(raw_message))
            return (
                payload.get("scope") == self._scope
                and int(payload.get("version") or 0) > self._local_version
            )
        except (TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return False

    async def _call_load_remote(self) -> PortalAdminAggregateConfig | None:
        result = self._load_remote()
        if inspect.isawaitable(result):
            result = await result
        if result is None:
            return None
        return PortalAdminAggregateConfig.model_validate(result)

    async def _call_apply_snapshot(
        self,
        aggregate: PortalAdminAggregateConfig,
    ) -> None:
        result = self._apply_snapshot(aggregate)
        if inspect.isawaitable(result):
            await result

    @staticmethod
    def _parse_version(value: object) -> int:
        try:
            return max(int(value or 0), 0)
        except (TypeError, ValueError):
            return 0
