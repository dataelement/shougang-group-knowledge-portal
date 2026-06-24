from fastapi.testclient import TestClient

from app.api.dependencies import get_portal_config_service
from app.main import app
from app.schemas.portal_config import DomainsConfigUpdate
from app.services.portal_config_service import PortalConfigService


def _seed_config(tmp_path):
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {"name": "生产", "space_ids": [104], "color": "#1", "bg": "#2",
                 "icon": "Factory", "background_image": "", "enabled": True, "code": "PP"},
                {"name": "能源", "space_ids": [110], "color": "#1", "bg": "#2",
                 "icon": "Zap", "background_image": "", "enabled": True, "code": "EM"},
            ]
        )
    )
    return config_service


def test_precheck_allows_matching_domain(tmp_path):
    config_service = _seed_config(tmp_path)
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/v1/knowledge/publish/precheck",
            json={"file_encoding": "SGGF-STD-PP-001", "target_space_id": 104},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["allowed"] is True
        assert data["reason_code"] == "OK"
    finally:
        app.dependency_overrides.clear()


def test_precheck_blocks_mismatch(tmp_path):
    config_service = _seed_config(tmp_path)
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/v1/knowledge/publish/precheck",
            json={"file_encoding": "SGGF-STD-PP-001", "target_space_id": 110},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["allowed"] is False
        assert data["reason_code"] == "DOMAIN_MISMATCH"
    finally:
        app.dependency_overrides.clear()


def test_precheck_blocks_when_file_code_missing(tmp_path):
    config_service = _seed_config(tmp_path)
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/v1/knowledge/publish/precheck",
            json={"file_encoding": "SGGF-STD", "target_space_id": 104},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["allowed"] is False
        assert data["reason_code"] == "FILE_CODE_MISSING"
    finally:
        app.dependency_overrides.clear()


def test_precheck_blocks_when_space_unconfigured(tmp_path):
    config_service = _seed_config(tmp_path)
    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/v1/knowledge/publish/precheck",
            json={"file_encoding": "SGGF-STD-PP-001", "target_space_id": 999},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["allowed"] is False
        assert data["reason_code"] == "SPACE_DOMAIN_UNCONFIGURED"
    finally:
        app.dependency_overrides.clear()
