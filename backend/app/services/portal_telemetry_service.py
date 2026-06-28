import logging
from typing import Any, Literal

import httpx

from app.clients.bisheng import BishengClient
from app.services.error_messages import normalize_user_facing_message

logger = logging.getLogger(__name__)

PORTAL_BFF_TELEMETRY_SOURCE_HEADER = "X-Portal-Telemetry-Source"
PORTAL_BFF_TELEMETRY_SOURCE = "shougang_portal_bff"
PORTAL_BFF_TELEMETRY_HEADERS = {
    PORTAL_BFF_TELEMETRY_SOURCE_HEADER: PORTAL_BFF_TELEMETRY_SOURCE,
}

PortalEventType = Literal["portal_favorite", "portal_qa", "portal_document_read", "portal_document_download"]


class PortalTelemetryStatsError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class PortalTelemetryService:
    def __init__(self, bisheng_client: BishengClient):
        self._bisheng = bisheng_client

    async def record_event(
        self,
        *,
        event_type: PortalEventType,
        source_app: str,
        scene: str,
        entry_point: str,
        resource_type: str = "document",
        space_id: int | str | None = None,
        file_id: int | str | None = None,
        target_space_id: int | str | None = None,
        source_space_id: int | str | None = None,
        source_file_id: int | str | None = None,
        conversation_id: str | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "event_type": event_type,
            "source_app": source_app,
            "scene": scene,
            "entry_point": entry_point,
            "resource_type": resource_type,
            "status": "success",
        }
        optional_fields = {
            "space_id": space_id,
            "file_id": file_id,
            "target_space_id": target_space_id,
            "source_space_id": source_space_id,
            "source_file_id": source_file_id,
            "conversation_id": conversation_id,
        }
        payload.update({key: value for key, value in optional_fields.items() if value not in (None, "")})
        try:
            await self._bisheng.post_json("/api/v1/knowledge/shougang-portal/telemetry/events", json=payload)
        except (httpx.HTTPError, RuntimeError, ValueError, TypeError):
            logger.exception(
                "portal telemetry event failed event_type=%s scene=%s entry_point=%s",
                event_type,
                scene,
                entry_point,
            )

    async def fetch_home_stats_counts(self) -> dict[str, int]:
        try:
            response = await self._bisheng.get_json("/api/v1/knowledge/shougang-portal/home/stats")
        except httpx.HTTPError as exc:
            raise PortalTelemetryStatsError(
                normalize_user_facing_message("Failed to fetch home stats", fallback="首页统计数据加载失败，请稍后重试")
            ) from exc

        if not isinstance(response, dict):
            raise PortalTelemetryStatsError(
                normalize_user_facing_message(
                    "Invalid home stats response from BiSheng",
                    fallback="首页统计数据加载失败，请稍后重试",
                )
            )

        status_code = response.get("status_code")
        if status_code not in (None, 200):
            status_message = str(response.get("status_message") or "BiSheng home stats query failed")
            numeric_status_code = int(status_code) if isinstance(status_code, int) else None
            raise PortalTelemetryStatsError(
                normalize_user_facing_message(
                    status_message,
                    fallback="首页统计数据加载失败，请稍后重试",
                    status_code=numeric_status_code,
                ),
                status_code=numeric_status_code,
            )

        data = response.get("data")
        if not isinstance(data, dict):
            raise PortalTelemetryStatsError(
                normalize_user_facing_message(
                    "Invalid home stats response from BiSheng",
                    fallback="首页统计数据加载失败，请稍后重试",
                )
            )

        required_fields = ("read_count", "favorite_count", "qa_count")
        if any(field not in data for field in required_fields):
            raise PortalTelemetryStatsError(
                normalize_user_facing_message(
                    "Invalid home stats response from BiSheng",
                    fallback="首页统计数据加载失败，请稍后重试",
                )
            )

        try:
            return {
                "read_count": int(data["read_count"]),
                "favorite_count": int(data["favorite_count"]),
                "qa_count": int(data["qa_count"]),
            }
        except (TypeError, ValueError) as exc:
            raise PortalTelemetryStatsError(
                normalize_user_facing_message(
                    "Invalid home stats response from BiSheng",
                    fallback="首页统计数据加载失败，请稍后重试",
                )
            ) from exc
