from __future__ import annotations

import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable

DOMAIN_FILE_COUNTS_PATH = "/api/v1/knowledge/shougang-portal/domain-file-counts"
_DEFAULT_TTL_SECONDS = 43200


@dataclass
class _CountEntry:
    count: int
    fetched_at: float


_MEMORY_CACHE: dict[str, _CountEntry] = {}
_INFLIGHT: set[frozenset[str]] = set()
_LOADED = False
_LOCK = Lock()


def reset_domain_file_count_cache() -> None:
    """Test helper: clear process-level cache + load flag."""
    global _LOADED
    with _LOCK:
        _MEMORY_CACHE.clear()
        _INFLIGHT.clear()
        _LOADED = False


class DomainFileCountService:
    def __init__(
        self,
        bisheng_client,
        config_service,
        now_fn: Callable[[], float] = time.time,
    ):
        self._bisheng = bisheng_client
        self._config_service = config_service
        self._now = now_fn

    def _ttl_seconds(self) -> int:
        ttl = self._config_service.get_config().site.domain_count_cache_ttl_seconds
        return ttl if isinstance(ttl, int) and ttl > 0 else _DEFAULT_TTL_SECONDS

    def _ensure_loaded(self) -> None:
        global _LOADED
        with _LOCK:
            if _LOADED:
                return
            doc = self._config_service.read_domain_count_cache() or {}
            for code, entry in doc.items():
                if isinstance(entry, dict):
                    _MEMORY_CACHE[code] = _CountEntry(
                        count=int(entry.get("count") or 0),
                        fetched_at=float(entry.get("fetched_at") or 0.0),
                    )
            _LOADED = True

    def read_cached(self, codes: list[str]) -> tuple[dict[str, int], bool]:
        self._ensure_loaded()
        now = self._now()
        ttl = self._ttl_seconds()
        counts: dict[str, int] = {}
        stale = False
        with _LOCK:
            for code in codes:
                entry = _MEMORY_CACHE.get(code)
                if entry is None:
                    counts[code] = 0
                    stale = True
                else:
                    counts[code] = entry.count
                    if now - entry.fetched_at > ttl:
                        stale = True
        return counts, stale

    async def refresh(self, codes: list[str]) -> dict[str, int]:
        if not codes:
            return {}
        response = await self._bisheng.post_json(DOMAIN_FILE_COUNTS_PATH, json={"codes": codes})
        data = response.get("data") or {}
        raw = data.get("counts") if isinstance(data, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        now = self._now()
        result: dict[str, int] = {}
        with _LOCK:
            for code in codes:
                count = int(raw.get(code) or 0)
                _MEMORY_CACHE[code] = _CountEntry(count=count, fetched_at=now)
                result[code] = count
            doc: dict[str, Any] = {
                code: {"count": entry.count, "fetched_at": entry.fetched_at}
                for code, entry in _MEMORY_CACHE.items()
            }
        self._config_service.write_domain_count_cache(doc)
        return result

    async def refresh_in_background(self, codes: list[str]) -> None:
        if not codes:
            return
        key = frozenset(codes)
        with _LOCK:
            if key in _INFLIGHT:
                return
            _INFLIGHT.add(key)
        try:
            await self.refresh(codes)
        except Exception:
            pass
        finally:
            with _LOCK:
                _INFLIGHT.discard(key)
