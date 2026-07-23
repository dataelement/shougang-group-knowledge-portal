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
                    "BiSheng 用户 source 查询命中: account=%s source=%s params=%s",
                    account,
                    matched.get("source"),
                    {key: value for key, value in params.items() if key != "page_size"},
                )
                return matched
        logger.warning("BiSheng 用户 source 查询未命中: account=%s", account)
        return None

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
            candidate = str(
                row.get("user_name")
                or row.get("username")
                or row.get("account")
                or row.get("login_name")
                or ""
            ).strip()
            if candidate.casefold() == target:
                return row
        return None
