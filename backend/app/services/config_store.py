import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any


class SQLiteConfigStore:
    _ALLOWED_TABLES = {"portal_config", "bisheng_runtime_config"}

    def __init__(self, database_path: Path):
        self._database_path = database_path
        self._lock = Lock()

    @property
    def database_path(self) -> Path:
        return self._database_path

    def get_document(self, table_name: str, legacy_key: str | None = None) -> dict[str, Any] | None:
        table_name = self._validate_table_name(table_name)
        self._ensure_table(table_name, legacy_key=legacy_key)
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT payload FROM {table_name} WHERE id = 1",
            ).fetchone()
        if row is None:
            return None
        return json.loads(row[0])

    def upsert_document(self, table_name: str, payload: dict[str, Any]) -> None:
        table_name = self._validate_table_name(table_name)
        self._ensure_table(table_name)
        now = datetime.now(UTC).isoformat()
        payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    f"""
                    INSERT INTO {table_name} (id, payload, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        payload = excluded.payload,
                        updated_at = excluded.updated_at
                    """,
                    (1, payload_text, now, now),
                )

    def _ensure_table(self, table_name: str, legacy_key: str | None = None) -> None:
        table_name = self._validate_table_name(table_name)
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {table_name} (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        payload TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                if legacy_key:
                    self._copy_legacy_document_if_needed(conn, table_name, legacy_key)
        os.chmod(self._database_path, 0o600)

    def _copy_legacy_document_if_needed(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        legacy_key: str,
    ) -> None:
        current_count = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
        if current_count:
            return
        legacy_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'config_documents'"
        ).fetchone()
        if legacy_exists is None:
            return
        legacy = conn.execute(
            "SELECT payload, created_at, updated_at FROM config_documents WHERE key = ?",
            (legacy_key,),
        ).fetchone()
        if legacy is None:
            return
        conn.execute(
            f"""
            INSERT INTO {table_name} (id, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (1, legacy[0], legacy[1], legacy[2]),
        )

    def _validate_table_name(self, table_name: str) -> str:
        if table_name not in self._ALLOWED_TABLES:
            raise ValueError(f"Unsupported config table: {table_name}")
        return table_name

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._database_path)
