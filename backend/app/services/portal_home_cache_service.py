from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Protocol

from redis.exceptions import RedisError

from app.schemas.portal_config import PortalConfig

logger = logging.getLogger(__name__)

_KEY_PREFIX = "shougang_portal:home_cache:v1"


class RedisJsonClient(Protocol):
    async def get(self, name: str) -> str | bytes | None: ...

    async def set(self, name: str, value: str, ex: int) -> bool | None: ...


class PortalHomeCacheService:
    """Best-effort JSON cache for portal home endpoints."""

    def __init__(self, redis_client: RedisJsonClient | None = None):
        self._redis = redis_client

    async def get_json(self, key: str) -> Any | None:
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(key)
        except (RedisError, OSError, TypeError, ValueError):
            logger.warning("portal home cache read failed key=%s", key, exc_info=True)
            return None
        if raw is None:
            return None
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            return json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            logger.warning("portal home cache payload is invalid key=%s", key, exc_info=True)
            return None

    async def set_json(self, key: str, value: Any, ttl_seconds: int) -> None:
        if self._redis is None:
            return
        try:
            payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            await self._redis.set(key, payload, ex=ttl_seconds)
        except (RedisError, OSError, TypeError, ValueError):
            logger.warning("portal home cache write failed key=%s", key, exc_info=True)

    @staticmethod
    def home_content_key(
        *,
        config: PortalConfig,
        account: str | None = None,
        visible_space_ids: list[int] | None = None,
    ) -> str:
        config_snapshot = {
            "sections": [
                {
                    "tag": section.tag,
                    "enabled": section.enabled,
                    "builtin_key": section.builtin_key,
                }
                for section in config.sections
            ],
            "domains": [
                {"code": domain.code, "enabled": domain.enabled, "space_ids": sorted(domain.space_ids)}
                for domain in config.domains
            ],
            "home_page_size": config.display.home.section_page_size,
        }
        normalized_account = (account or "").strip().lower()
        scope = {
            "account": normalized_account or "anonymous",
            "visible_space_ids": sorted(set(visible_space_ids or [])) if normalized_account else [],
            "config": config_snapshot,
        }
        return f"{_KEY_PREFIX}:content:{_digest(scope)}"

    @staticmethod
    def home_stats_key() -> str:
        return f"{_KEY_PREFIX}:stats"

    @staticmethod
    def domain_file_counts_key(codes: list[str]) -> str:
        normalized_codes = sorted({code.strip().upper() for code in codes if code and code.strip()})
        return f"{_KEY_PREFIX}:domain-file-counts:{_digest(normalized_codes)}"

    @staticmethod
    def visible_domain_file_counts_key(domains: list[dict[str, Any]], account: str | None = None) -> str:
        normalized_domains = sorted(
            {
                (
                    str(domain.get("code") or "").strip().upper(),
                    tuple(sorted({int(space_id) for space_id in domain.get("space_ids", [])})),
                )
                for domain in domains
                if str(domain.get("code") or "").strip()
            }
        )
        scope = {"account": (account or "").strip().lower() or "anonymous", "domains": normalized_domains}
        return f"{_KEY_PREFIX}:visible-domain-file-counts:{_digest(scope)}"

    @staticmethod
    def visible_category_file_counts_key(categories: list[dict[str, Any]], account: str | None = None) -> str:
        normalized_categories = sorted(
            {
                (
                    str(category.get("code") or "").strip().upper(),
                    tuple(sorted({int(space_id) for space_id in category.get("space_ids", [])})),
                )
                for category in categories
                if str(category.get("code") or "").strip()
            }
        )
        scope = {"account": (account or "").strip().lower() or "anonymous", "categories": normalized_categories}
        return f"{_KEY_PREFIX}:visible-category-file-counts:{_digest(scope)}"


def _digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
