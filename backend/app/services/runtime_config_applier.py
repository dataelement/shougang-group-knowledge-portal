from __future__ import annotations

import asyncio
from typing import Any

from app.schemas.portal_admin_config import PortalAdminAggregateConfig
from app.services.bisheng_runtime_service import BishengRuntimeService


class RuntimeConfigApplier:
    """Atomically exposes one validated aggregate version to local services."""

    def __init__(
        self,
        *,
        aggregate_store: Any,
        bisheng_runtime_service: BishengRuntimeService,
    ):
        self._aggregate_store = aggregate_store
        self._bisheng_runtime_service = bisheng_runtime_service
        self._local_version = 0
        self._lock = asyncio.Lock()

    @property
    def local_version(self) -> int:
        return self._local_version

    async def apply(
        self,
        snapshot: PortalAdminAggregateConfig | dict,
    ) -> bool:
        aggregate = PortalAdminAggregateConfig.model_validate(snapshot)
        async with self._lock:
            if aggregate.version <= self._local_version:
                return False

            await self._bisheng_runtime_service.apply_persistent_config(
                aggregate.bisheng.with_env_base_url_override()
            )
            self._aggregate_store.set_cached_aggregate(aggregate)
            self._local_version = aggregate.version
            return True
