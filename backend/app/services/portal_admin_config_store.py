import logging
from copy import deepcopy
from pathlib import Path
from threading import Lock
from typing import Any

import httpx

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import (
    PortalAdminAggregateConfig,
    PortalBishengPersistentConfig,
)
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import SQLiteConfigStore


logger = logging.getLogger(__name__)

REMOTE_CONFIG_PATH = "/api/v1/shougang-portal/config"
REMOTE_CONFIG_INTERNAL_PATH = "/api/v1/shougang-portal/config/internal"


class RemotePortalAdminConfigStore:
    skip_startup_seed = True

    _REMOTE_TABLES = {
        "portal_config": "portal",
        "bisheng_runtime_config": "bisheng",
        "unified_auth_runtime_config": "unified_auth",
    }

    def __init__(
        self,
        *,
        runtime_service: BishengRuntimeService,
        database_path: Path,
    ):
        self._runtime_service = runtime_service
        self._fallback_store = SQLiteConfigStore(database_path)
        self._memory_documents: dict[str, dict[str, Any]] = {}
        self._memory_lock = Lock()

    @property
    def database_path(self) -> Path:
        return self._fallback_store.database_path

    @property
    def runtime_service(self) -> BishengRuntimeService:
        return self._runtime_service

    def get_document(self, table_name: str, legacy_key: str | None = None) -> dict[str, Any] | None:
        if table_name not in self._REMOTE_TABLES:
            return self._get_memory_document(table_name)

        aggregate = self._load_remote_aggregate()
        if aggregate is not None:
            return self._section_from_aggregate(aggregate, table_name)
        return self._get_memory_document(table_name)

    def upsert_document(self, table_name: str, payload: dict[str, Any]) -> None:
        if table_name not in self._REMOTE_TABLES:
            self._set_memory_document(table_name, payload)
            return

        aggregate = self._load_remote_aggregate() or self._build_aggregate_from_memory()
        section = self._REMOTE_TABLES[table_name]
        next_data = aggregate.model_dump(mode="json")
        next_data[section] = payload
        next_aggregate = PortalAdminAggregateConfig.model_validate(next_data)
        self._save_remote_aggregate(next_aggregate)
        self._set_memory_document(table_name, payload)

    def migrate_from_sqlite(self, *, overwrite: bool = False) -> dict[str, Any]:
        existing = self._load_remote_aggregate()
        if existing is not None and not overwrite:
            return {
                "migrated": False,
                "skipped": True,
                "reason": "remote_config_exists",
            }
        aggregate = self._build_aggregate_from_fallback()
        self._save_remote_aggregate(aggregate)
        return {
            "migrated": True,
            "skipped": False,
            "version": aggregate.version,
        }

    def _section_from_aggregate(
        self,
        aggregate: PortalAdminAggregateConfig,
        table_name: str,
    ) -> dict[str, Any]:
        section = self._REMOTE_TABLES[table_name]
        return getattr(aggregate, section).model_dump(mode="json")

    def _build_aggregate_from_memory(self) -> PortalAdminAggregateConfig:
        portal = self._get_memory_document("portal_config")
        runtime = self._get_memory_document("bisheng_runtime_config")
        unified_auth = self._get_memory_document("unified_auth_runtime_config")
        return PortalAdminAggregateConfig(
            portal=portal or deepcopy(DEFAULT_PORTAL_CONFIG),
            bisheng=runtime or self._runtime_service.get_persistent_config().model_dump(mode="json"),
            unified_auth=unified_auth or UnifiedAuthRuntimeConfig().model_dump(mode="json"),
        )

    def _build_aggregate_from_fallback(self) -> PortalAdminAggregateConfig:
        portal = self._fallback_store.get_document("portal_config", legacy_key="portal_config")
        runtime = self._fallback_store.get_document(
            "bisheng_runtime_config",
            legacy_key="bisheng_runtime",
        )
        unified_auth = self._fallback_store.get_document("unified_auth_runtime_config")
        return PortalAdminAggregateConfig(
            portal=portal or DEFAULT_PORTAL_CONFIG,
            bisheng=self._runtime_persistent_payload(runtime),
            unified_auth=unified_auth or UnifiedAuthRuntimeConfig().model_dump(mode="json"),
        )

    def _runtime_persistent_payload(self, fallback: dict[str, Any] | None) -> dict[str, Any]:
        current = self._runtime_service.get_persistent_config()
        data = current.model_dump(mode="json")
        if fallback:
            data = {
                **data,
                **{
                    key: value
                    for key, value in fallback.items()
                    if key in PortalBishengPersistentConfig.model_fields and value not in (None, "")
                },
            }
        return data

    def _get_memory_document(self, table_name: str) -> dict[str, Any] | None:
        with self._memory_lock:
            payload = self._memory_documents.get(table_name)
            return deepcopy(payload) if payload is not None else None

    def _set_memory_document(self, table_name: str, payload: dict[str, Any]) -> None:
        with self._memory_lock:
            self._memory_documents[table_name] = deepcopy(payload)

    def _load_remote_aggregate(self) -> PortalAdminAggregateConfig | None:
        try:
            payload = self._request("GET", REMOTE_CONFIG_INTERNAL_PATH)
        except Exception:
            logger.debug("Bisheng portal config load failed", exc_info=True)
            return None
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data:
            return None
        return PortalAdminAggregateConfig.model_validate(data)

    def _save_remote_aggregate(self, aggregate: PortalAdminAggregateConfig) -> None:
        payload = self._request(
            "PUT",
            REMOTE_CONFIG_PATH,
            json=aggregate.model_dump(mode="json"),
        )
        status_code = payload.get("status_code") if isinstance(payload, dict) else None
        if status_code not in (None, 200):
            raise RuntimeError(str(payload.get("status_message") or "Bisheng config save failed"))

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        runtime = self._runtime_service.get_runtime_config_snapshot()
        base_url = str(runtime.base_url).rstrip("/")
        headers: dict[str, str] = {}
        cookies: dict[str, str] = {}
        if runtime.api_token:
            headers["Authorization"] = f"Bearer {runtime.api_token}"
            cookies["access_token_cookie"] = runtime.api_token
        with httpx.Client(
            base_url=base_url,
            timeout=runtime.timeout_seconds,
            headers=headers,
            cookies=cookies,
            follow_redirects=True,
        ) as client:
            response = client.request(method, path, json=json)
            response.raise_for_status()
            return response.json()
