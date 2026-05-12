from pathlib import Path

from app.services.portal_config_service import PortalConfigService
from app.schemas.portal_config import DomainsConfigUpdate


def test_portal_config_service_seeds_default_config(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"

    service = PortalConfigService(config_path=config_path)
    config = service.get_config()

    assert config_path.exists()
    assert len(config.domains) == 10
    assert all(domain.space_ids == [] for domain in config.domains)
    domain_names = [domain.name for domain in config.domains]
    assert domain_names == [
        "营销", "财务", "设备", "安全", "环保",
        "人力", "信息", "能源", "质量", "管理",
    ]
    assert all(domain.background_image for domain in config.domains)
    assert config.spaces == []
    assert config.qa.knowledge_space_ids == []


def test_portal_config_service_accepts_unbound_domain(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    service = PortalConfigService(config_path=config_path)

    updated = service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "未绑定域",
                    "space_ids": [],
                    "color": "#000000",
                    "bg": "#ffffff",
                    "icon": "Factory",
                    "background_image": "",
                    "enabled": True,
                }
            ]
        )
    )

    assert updated.domains[0].space_ids == []


def test_portal_config_service_persists_domain_updates(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    service = PortalConfigService(config_path=config_path)

    updated = service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "新业务域",
                    "space_ids": [12, 18],
                    "color": "#000000",
                    "bg": "#ffffff",
                    "icon": "Factory",
                    "background_image": "/demo.png",
                    "enabled": True,
                }
            ]
        )
    )

    reloaded = PortalConfigService(config_path=config_path).get_config()

    assert updated.domains[0].name == "新业务域"
    assert reloaded.domains[0].space_ids == [12, 18]
    assert reloaded.domains[0].background_image == "/demo.png"
