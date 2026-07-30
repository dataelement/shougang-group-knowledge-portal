from copy import deepcopy
from dataclasses import dataclass
from threading import Lock
from typing import Any


@dataclass(frozen=True)
class ConfigStoreWriteResult:
    document: dict[str, Any]
    version: int | None = None


class InMemoryConfigStore:
    def __init__(self):
        self._documents: dict[str, dict[str, Any]] = {}
        self._lock = Lock()

    def get_document(self, table_name: str, legacy_key: str | None = None) -> dict[str, Any] | None:
        with self._lock:
            payload = self._documents.get(table_name)
            return deepcopy(payload) if payload is not None else None

    def upsert_document(
        self,
        table_name: str,
        payload: dict[str, Any],
    ) -> ConfigStoreWriteResult:
        with self._lock:
            self._documents[table_name] = deepcopy(payload)
            return ConfigStoreWriteResult(document=deepcopy(payload))


class RuntimeSnapshotConfigStore(InMemoryConfigStore):
    """Non-authoritative local copy of the last DB/Redis-coordinated snapshot."""
