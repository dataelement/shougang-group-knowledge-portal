import logging
from typing import Any

from app.clients.bisheng import BishengClient
from app.services.bisheng_runtime_service import BishengRuntimeService

logger = logging.getLogger(__name__)


def is_local_bisheng_user(source: str | None) -> bool:
    return (source or "").strip().casefold() == "local"


class PortalBishengUserLookup:
    def __init__(self, *, runtime_service: BishengRuntimeService):
        self._runtime_service = runtime_service

    async def resolve_user_source(self, account: str) -> str | None:
        normalized = account.strip()
        if not normalized:
            return None
        try:
            await self._runtime_service.sync_shared_auth_state()
            client = self._runtime_service.get_client()
            user = await self._lookup_user(client, normalized)
            if not user:
                return None
            source = str(user.get("source") or "").strip()
            return source.casefold() if source else None
        except Exception as err:
            logger.warning("BiSheng 用户 source 查询失败: %s", err)
            raise

    async def _lookup_user(self, client: BishengClient, account: str) -> dict[str, Any] | None:
        matched = await self._lookup_user_by_external_id(client, account)
        if matched is not None:
            print("BiSheng 用户 source 查询命中: ", matched)
            logger.info(
                "BiSheng 用户 source 查询命中(by-external-id): account=%s source=%s external_id=%s",
                account,
                matched.get("source"),
                matched.get("external_id"),
            )
            return matched

        for params in (
            {"name": account, "page_num": 1, "page_size": 20},
            {"keyword": account, "page_num": 1, "page_size": 20},
            {"user_name": account, "page_num": 1, "page_size": 20},
        ):
            response = await client.get_json("/api/v1/user/list", params=params)
            rows = self._extract_rows(response)
            matched = self._match_account(rows, account)
            if matched is not None:
                logger.info(
                    "BiSheng 用户 source 查询命中: account=%s source=%s external_id=%s params=%s",
                    account,
                    matched.get("source"),
                    matched.get("external_id"),
                    {key: value for key, value in params.items() if key != "page_size"},
                )
                return self._normalize_user_record(matched)
        logger.warning("BiSheng 用户 source 查询未命中: account=%s", account)
        return None

    async def _lookup_user_by_external_id(
        self,
        client: BishengClient,
        account: str,
    ) -> dict[str, Any] | None:
        try:
            response = await client.get_json(
                "/api/v1/user/by-external-id",
                params={"external_id": account},
            )
        except Exception as err:
            logger.debug(
                "BiSheng by-external-id 查询失败，将回退 user/list: account=%s error=%s",
                account,
                err,
            )
            return None

        status_code = response.get("status_code")
        if status_code == 404:
            return None
        if status_code not in (None, 200):
            logger.debug(
                "BiSheng by-external-id 未命中: account=%s status_code=%s",
                account,
                status_code,
            )
            return None

        rows = self._extract_by_external_id_rows(response)
        if not rows:
            return None

        matched = self._match_account(rows, account) or rows[0]
        logger.info(
            "BiSheng 用户 source 查询命中(by-external-id): account=%s source=%s external_id=%s",
            account,
            matched.get("source"),
            matched.get("external_id"),
        )
        return self._normalize_user_record(matched)

    @staticmethod
    def _normalize_user_record(row: dict[str, Any]) -> dict[str, Any]:
        user_name = str(
            row.get("user_name")
            or row.get("username")
            or row.get("account")
            or row.get("login_name")
            or ""
        ).strip()
        external_id = str(row.get("external_id") or row.get("external_code") or "").strip()
        source = str(row.get("source") or "").strip()
        return {
            **row,
            "user_name": user_name,
            "external_id": external_id,
            "source": source,
        }

    @staticmethod
    def _extract_by_external_id_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
        data = payload.get("data")
        if not isinstance(data, dict):
            return []
        nested_rows = data.get("data")
        if isinstance(nested_rows, list):
            return [row for row in nested_rows if isinstance(row, dict)]
        if any(key in data for key in ("user_id", "user_name", "source", "external_id")):
            return [data]
        return []

    @staticmethod
    def _extract_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
        data = payload.get("data", payload)
        if isinstance(data, dict):
            for key in ("data", "list", "items", "records", "users"):
                rows = data.get(key)
                if isinstance(rows, list):
                    return [row for row in rows if isinstance(row, dict)]
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        return []

    @staticmethod
    def _match_account(rows: list[dict[str, Any]], account: str) -> dict[str, Any] | None:
        target = account.strip().casefold()
        for row in rows:
            candidates = (
                row.get("user_name"),
                row.get("username"),
                row.get("account"),
                row.get("login_name"),
                row.get("external_id"),
                row.get("external_code"),
            )
            for candidate in candidates:
                text = str(candidate or "").strip()
                if text and text.casefold() == target:
                    return row
        return None
