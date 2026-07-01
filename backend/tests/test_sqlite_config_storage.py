import json
import sqlite3
from pathlib import Path

from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_config_service import PortalConfigService


def test_config_services_share_default_sqlite_database(tmp_path: Path):
    portal_config_path = tmp_path / "portal_config.json"
    runtime_config_path = tmp_path / "bisheng_runtime.json"

    PortalConfigService(config_path=portal_config_path).get_config()
    BishengRuntimeService(
        config_path=runtime_config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
    ).get_public_config()

    assert (tmp_path / "portal.sqlite3").exists()
    assert not (tmp_path / "portal_config.sqlite3").exists()
    assert not (tmp_path / "bisheng_runtime.sqlite3").exists()


def test_config_services_use_distinct_tables_in_shared_sqlite_database(tmp_path: Path):
    portal_config_path = tmp_path / "portal_config.json"
    runtime_config_path = tmp_path / "bisheng_runtime.json"

    PortalConfigService(config_path=portal_config_path).get_config()
    BishengRuntimeService(
        config_path=runtime_config_path,
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
    ).get_public_config()

    with sqlite3.connect(tmp_path / "portal.sqlite3") as conn:
        table_names = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        portal_rows = conn.execute("SELECT COUNT(*) FROM portal_config").fetchone()[0]
        runtime_rows = conn.execute("SELECT COUNT(*) FROM bisheng_runtime_config").fetchone()[0]

    assert {"portal_config", "bisheng_runtime_config"}.issubset(table_names)
    assert portal_rows == 1
    assert runtime_rows == 1


def test_config_services_migrate_legacy_document_rows_to_distinct_tables(tmp_path: Path):
    database_path = tmp_path / "portal.sqlite3"
    portal_payload = {
        "domains": [
            {
                "name": "旧表业务域",
                "space_ids": [],
                "color": "#111111",
                "bg": "#eeeeee",
                "icon": "Factory",
                "background_image": "",
                "enabled": True,
            }
        ],
        "sections": [],
        "qa": {
            "welcome_message": "旧表欢迎语",
            "hot_questions": [],
            "ai_search_system_prompt": "",
            "qa_system_prompt": "",
            "selected_model": "",
        },
        "recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"},
        "display": {"home": {}, "list": {}, "search": {}, "detail": {}},
        "apps": [],
    }
    runtime_payload = {
        "base_url": "http://legacy.example.com",
        "asset_base_url": "",
        "username": "legacy-admin",
        "timeout_seconds": 15.0,
        "api_token": "legacy-token",
        "last_auth_at": "",
    }
    with sqlite3.connect(database_path) as conn:
        conn.execute(
            """
            CREATE TABLE config_documents (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO config_documents (key, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("portal_config", json.dumps(portal_payload), "2026-05-01T00:00:00+00:00", "2026-05-01T00:00:00+00:00"),
        )
        conn.execute(
            "INSERT INTO config_documents (key, payload, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("bisheng_runtime", json.dumps(runtime_payload), "2026-05-01T00:00:00+00:00", "2026-05-01T00:00:00+00:00"),
        )

    portal_config = PortalConfigService(config_path=tmp_path / "portal_config.json").get_config()
    runtime_config = BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
    ).get_public_config()

    assert portal_config.domains[0].name == "旧表业务域"
    assert runtime_config.username == "legacy-admin"

    with sqlite3.connect(database_path) as conn:
        portal_rows = conn.execute("SELECT COUNT(*) FROM portal_config").fetchone()[0]
        runtime_rows = conn.execute("SELECT COUNT(*) FROM bisheng_runtime_config").fetchone()[0]

    assert portal_rows == 1
    assert runtime_rows == 1


def test_domain_count_cache_read_write(tmp_path):
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    assert service.read_domain_count_cache() == {}

    doc = {"PP": {"count": 12, "fetched_at": 1000.0}}
    service.write_domain_count_cache(doc)
    assert service.read_domain_count_cache() == doc
    assert service.get_config().domains is not None  # main config table unaffected
