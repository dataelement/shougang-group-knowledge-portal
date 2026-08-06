from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.portal_config import WatermarkConfig
from app.services.portal_config_service import PortalConfigService


def test_public_watermark_config_returns_resolved_text(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    service.update_watermark(WatermarkConfig(horizontal_text="测试环境水印文案"))

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        bisheng_response = client.get("/api/v1/shougang-portal/config/watermark")
        knowledge_response = client.get("/api/v1/knowledge/config/watermark")

    assert bisheng_response.status_code == 200
    assert bisheng_response.json()["data"] == {
        "horizontal_text": "测试环境水印文案",
    }
    assert knowledge_response.status_code == 200
    assert knowledge_response.json()["data"] == {
        "horizontal_text": "测试环境水印文案",
    }


def test_public_watermark_config_falls_back_to_default_when_empty(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        response = client.get("/api/v1/shougang-portal/config/watermark")

    assert response.status_code == 200
    assert response.json()["data"]["horizontal_text"] == "首钢股份内部资料，严禁外传，违者必究"
