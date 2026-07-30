from copy import deepcopy
from threading import Lock
from typing import Any

import httpx

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_admin_config import PortalAdminAggregateConfig
from app.schemas.rest_auth_runtime import (
    RestAuthRuntimeConfig,
    merge_rest_auth_into_unified_auth,
    rest_auth_document_from_unified_auth,
    rest_auth_payload_has_content,
    unified_auth_has_rest_content,
)
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import ConfigStoreWriteResult


REMOTE_CONFIG_PATH = "/api/v1/shougang-portal/config"
REMOTE_CONFIG_INTERNAL_PATH = "/api/v1/shougang-portal/config/internal"
REST_AUTH_RUNTIME_TABLE = "rest_auth_runtime_config"


class PortalAdminConfigValidationError(ValueError):
    """The remote aggregate rejected a semantically invalid admin config."""


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
    ):
        self._runtime_service = runtime_service
        self._memory_documents: dict[str, dict[str, Any]] = {}
        self._memory_lock = Lock()
        self._last_version: int | None = None
        self._cached_aggregate: PortalAdminAggregateConfig | None = None
        self._last_saved_aggregate: PortalAdminAggregateConfig | None = None
        self._shared_cache_enabled = False

    @property
    def runtime_service(self) -> BishengRuntimeService:
        return self._runtime_service

    @property
    def version(self) -> int | None:
        return self._last_version

    @property
    def last_saved_aggregate(self) -> PortalAdminAggregateConfig | None:
        return (
            self._last_saved_aggregate.model_copy(deep=True)
            if self._last_saved_aggregate is not None
            else None
        )

    def enable_shared_cache(self) -> None:
        self._shared_cache_enabled = True

    def set_cached_aggregate(self, aggregate: PortalAdminAggregateConfig) -> None:
        validated = PortalAdminAggregateConfig.model_validate(aggregate)
        if (
            self._cached_aggregate is not None
            and validated.version < self._cached_aggregate.version
        ):
            return
        self._cached_aggregate = validated.model_copy(deep=True)
        self._last_version = validated.version

    def get_cached_aggregate(self) -> PortalAdminAggregateConfig | None:
        return (
            self._cached_aggregate.model_copy(deep=True)
            if self._cached_aggregate is not None
            else None
        )

    def load_remote_aggregate(self) -> PortalAdminAggregateConfig | None:
        return self._load_remote_aggregate()

    def get_document(self, table_name: str, legacy_key: str | None = None) -> dict[str, Any] | None:
        if table_name == REST_AUTH_RUNTIME_TABLE:
            return self._get_rest_auth_runtime_document()
        if table_name not in self._REMOTE_TABLES:
            return self._get_memory_document(table_name)

        aggregate = self._aggregate_for_read()
        if aggregate is not None:
            return self._section_from_aggregate(aggregate, table_name)
        return None

    def upsert_document(
        self,
        table_name: str,
        payload: dict[str, Any],
    ) -> ConfigStoreWriteResult:
        if table_name == REST_AUTH_RUNTIME_TABLE:
            return self._upsert_rest_auth_runtime_document(payload)
        if table_name not in self._REMOTE_TABLES:
            self._set_memory_document(table_name, payload)
            return ConfigStoreWriteResult(document=deepcopy(payload))

        aggregate = self._load_remote_aggregate() or self._build_default_aggregate()
        section = self._REMOTE_TABLES[table_name]
        next_data = aggregate.model_dump(mode="json")
        next_data[section] = payload
        next_aggregate = PortalAdminAggregateConfig.model_validate(next_data)
        # Keep compatibility with lightweight test/local subclasses that only
        # persist in ``_save_remote_aggregate`` and historically returned None.
        saved_aggregate = self._save_remote_aggregate(next_aggregate) or next_aggregate
        self._record_saved_aggregate(saved_aggregate)
        return ConfigStoreWriteResult(
            document=self._section_from_aggregate(saved_aggregate, table_name),
            version=saved_aggregate.version,
        )

    def _get_rest_auth_runtime_document(self) -> dict[str, Any] | None:
        aggregate = self._aggregate_for_read()
        if aggregate is None:
            return None
        return rest_auth_document_from_unified_auth(
            aggregate.unified_auth.model_dump(mode="json")
        )

    def _upsert_rest_auth_runtime_document(self, payload: dict[str, Any]) -> ConfigStoreWriteResult:
        runtime_config = RestAuthRuntimeConfig.model_validate(payload)
        aggregate = self._load_remote_aggregate() or self._build_default_aggregate()
        unified_dump = merge_rest_auth_into_unified_auth(
            aggregate.unified_auth.model_dump(mode="json"),
            runtime_config.model_dump(mode="json"),
        )
        unified_auth = UnifiedAuthRuntimeConfig.model_validate(unified_dump)
        next_aggregate = aggregate.model_copy(update={"unified_auth": unified_auth})
        saved_aggregate = self._save_remote_aggregate(next_aggregate) or next_aggregate
        self._record_saved_aggregate(saved_aggregate)
        saved_document = rest_auth_document_from_unified_auth(
            saved_aggregate.unified_auth.model_dump(mode="json")
        )
        if not rest_auth_payload_has_content(saved_document):
            saved_document = runtime_config.model_dump(mode="json")
        return ConfigStoreWriteResult(
            document=saved_document,
            version=saved_aggregate.version,
        )

    def _section_from_aggregate(
        self,
        aggregate: PortalAdminAggregateConfig,
        table_name: str,
    ) -> dict[str, Any]:
        section = self._REMOTE_TABLES[table_name]
        return getattr(aggregate, section).model_dump(mode="json")

    def _build_default_aggregate(self) -> PortalAdminAggregateConfig:
        return PortalAdminAggregateConfig(
            portal=deepcopy(DEFAULT_PORTAL_CONFIG),
            bisheng=self._runtime_service.get_persistent_config().model_dump(mode="json"),
            unified_auth=UnifiedAuthRuntimeConfig().model_dump(mode="json"),
        )

    def _get_memory_document(self, table_name: str) -> dict[str, Any] | None:
        with self._memory_lock:
            payload = self._memory_documents.get(table_name)
            return deepcopy(payload) if payload is not None else None

    def _set_memory_document(self, table_name: str, payload: dict[str, Any]) -> None:
        with self._memory_lock:
            self._memory_documents[table_name] = deepcopy(payload)

    def _load_remote_aggregate(self) -> PortalAdminAggregateConfig | None:
        payload = self._request("GET", REMOTE_CONFIG_INTERNAL_PATH)
        data = payload.get("data") if isinstance(payload, dict) else None
        if not data:
            return None
        aggregate = PortalAdminAggregateConfig.model_validate(
            self._normalize_remote_aggregate_data(data)
        )
        self._last_version = aggregate.version
        return aggregate

    def _aggregate_for_read(self) -> PortalAdminAggregateConfig | None:
        if self._shared_cache_enabled and self._cached_aggregate is not None:
            return self._cached_aggregate.model_copy(deep=True)
        aggregate = self._load_remote_aggregate()
        if self._shared_cache_enabled and aggregate is not None:
            self.set_cached_aggregate(aggregate)
        return aggregate

    def _record_saved_aggregate(
        self,
        aggregate: PortalAdminAggregateConfig,
    ) -> None:
        saved = PortalAdminAggregateConfig.model_validate(aggregate)
        self._last_saved_aggregate = saved.model_copy(deep=True)
        self._last_version = saved.version
        if not self._shared_cache_enabled:
            self._cached_aggregate = saved.model_copy(deep=True)

    def _normalize_remote_aggregate_data(self, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        next_data = deepcopy(data)
        portal = next_data.get("portal")
        if isinstance(portal, dict):
            document_types = portal.get("document_types")
            if document_types is None:
                document_types = []
            portal["document_types"] = self._fill_empty_document_type_children(document_types)

        unified_auth = next_data.get("unified_auth")
        if not isinstance(unified_auth, dict):
            unified_auth = {}
            next_data["unified_auth"] = unified_auth

        legacy_rest_auth = self._extract_legacy_rest_auth_payload(next_data)
        if legacy_rest_auth and not unified_auth_has_rest_content(unified_auth):
            unified_auth.update(
                merge_rest_auth_into_unified_auth(unified_auth, legacy_rest_auth)
            )
        unified_auth.pop("rest_auth", None)

        return next_data

    @staticmethod
    def _extract_legacy_rest_auth_payload(data: dict[str, Any]) -> dict[str, Any] | None:
        unified_auth = data.get("unified_auth")
        if isinstance(unified_auth, dict):
            nested = unified_auth.get("rest_auth")
            if isinstance(nested, dict) and rest_auth_payload_has_content(nested):
                return nested

        top_level = data.get("rest_auth")
        if isinstance(top_level, dict) and rest_auth_payload_has_content(top_level):
            return top_level

        portal = data.get("portal")
        if isinstance(portal, dict):
            integrations = portal.get("integrations")
            if isinstance(integrations, dict):
                nested = integrations.get("rest_auth_runtime")
                if isinstance(nested, dict) and rest_auth_payload_has_content(nested):
                    return nested
        return None

    @staticmethod
    def _fill_empty_document_type_children(document_types: Any) -> Any:
        if not isinstance(document_types, list):
            return document_types

        normalized = []
        for item in document_types:
            if not isinstance(item, dict):
                normalized.append(item)
                continue

            next_item = dict(item)
            code = str(next_item.get("code") or "").strip()
            label = str(next_item.get("label") or "").strip()
            if not next_item.get("children") and code and label:
                # 兼容早期远端配置：旧文档类型只有一级分类，新模型要求至少一个子类目。
                next_item["children"] = [{"code": code, "label": label}]
            normalized.append(next_item)
        return normalized

    def _save_remote_aggregate(
        self,
        aggregate: PortalAdminAggregateConfig,
    ) -> PortalAdminAggregateConfig:
        payload = self._request(
            "PUT",
            REMOTE_CONFIG_PATH,
            json=aggregate.model_dump(mode="json"),
        )
        status_code = payload.get("status_code") if isinstance(payload, dict) else None
        if status_code not in (None, 200):
            message = str(payload.get("status_message") or "Bisheng config save failed")
            if status_code == 422:
                raise PortalAdminConfigValidationError(message)
            raise RuntimeError(message)
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise RuntimeError("Bisheng config save response is missing normalized data")
        saved = PortalAdminAggregateConfig.model_validate(
            self._normalize_remote_aggregate_data(data)
        )
        self._record_saved_aggregate(saved)
        return saved

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        runtime = self._runtime_service.get_runtime_config_snapshot()
        base_url = str(runtime.base_url).rstrip("/")
        headers: dict[str, str] = {}
        cookies: dict[str, str] = {}
        is_internal_config_read = (
            method.upper() == "GET"
            and path == REMOTE_CONFIG_INTERNAL_PATH
        )
        if runtime.api_token and not is_internal_config_read:
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
            if response.status_code == 422:
                try:
                    payload = response.json()
                except (TypeError, ValueError):
                    payload = None
                message = "BiSheng 配置校验失败"
                if isinstance(payload, dict):
                    status_message = payload.get("status_message")
                    detail = payload.get("detail")
                    if status_message:
                        message = str(status_message)
                    elif isinstance(detail, str) and detail.strip():
                        message = detail.strip()
                raise PortalAdminConfigValidationError(message)
            if response.status_code >= 400:
                message = f"BiSheng 配置保存失败（HTTP {response.status_code}）"
                try:
                    payload = response.json()
                except (TypeError, ValueError):
                    payload = None
                if isinstance(payload, dict):
                    status_message = payload.get("status_message")
                    detail = payload.get("detail")
                    if status_message:
                        message = str(status_message)
                    elif isinstance(detail, str) and detail.strip():
                        message = detail.strip()
                raise RuntimeError(message)
            response.raise_for_status()
            return response.json()
