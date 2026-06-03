from fastapi.testclient import TestClient

from app.api.routes.knowledge import get_domain_file_count_service
from app.api.dependencies import get_portal_config_service
from app.main import app
from app.schemas.portal_config import DomainsConfigUpdate
from app.services.domain_file_count_service import DomainFileCountService, reset_domain_file_count_cache
from app.services.portal_config_service import PortalConfigService


class FakeBisheng:
    def __init__(self, counts):
        self.counts = counts

    async def post_json(self, path, json=None):
        codes = (json or {}).get("codes", [])
        return {"status_code": 200, "data": {"counts": {c: self.counts.get(c, 0) for c in codes}}}


def test_domain_file_counts_route(tmp_path):
    reset_domain_file_count_cache()
    config_service = PortalConfigService(config_path=tmp_path / "portal.json")
    config_service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {"name": "生产", "space_ids": [], "color": "#1", "bg": "#2", "icon": "Factory",
                 "background_image": "", "enabled": True, "code": "PP"},
                {"name": "质量", "space_ids": [], "color": "#1", "bg": "#2", "icon": "CheckCircle",
                 "background_image": "", "enabled": True, "code": "QM"},
            ]
        )
    )
    bisheng = FakeBisheng({"PP": 12, "QM": 3})

    app.dependency_overrides[get_portal_config_service] = lambda: config_service
    app.dependency_overrides[get_domain_file_count_service] = lambda: DomainFileCountService(
        bisheng_client=bisheng, config_service=config_service
    )
    try:
        client = TestClient(app)
        first = client.get("/api/v1/knowledge/domain-file-counts")
        assert first.status_code == 200
        assert set(first.json()["data"]["counts"].keys()) == {"PP", "QM"}
        second = client.get("/api/v1/knowledge/domain-file-counts")
        assert second.json()["data"]["counts"] == {"PP": 12, "QM": 3}
    finally:
        app.dependency_overrides.clear()
        reset_domain_file_count_cache()
