from pathlib import Path

from app.services.portal_config_service import PortalConfigService
from app.schemas.portal_config import DomainsConfigUpdate


def test_portal_config_service_seeds_default_config(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"

    service = PortalConfigService(config_path=config_path)
    config = service.get_config()

    assert not config_path.exists()
    assert (tmp_path / "portal.sqlite3").exists()
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
    assert config.qa.general_model == ""
    assert config.qa.reasoning_model == ""
    assert config.qa.quick_mode_system_prompt
    assert config.qa.normal_mode_system_prompt
    assert config.qa.expert_mode_system_prompt
    assert [category.name for category in config.qa.template_categories] == [
        "工作汇报", "方案策划", "研究报告", "政务公文",
    ]
    assert len(config.qa.templates) == 18
    assert {template.id for template in config.qa.templates if template.show_on_home} == {
        "office-writing", "hero-semantic-search", "hero-open-qa", "hero-doc-translate",
    }
    assert config.qa.templates[0].prompt


def test_portal_config_service_imports_legacy_json_once(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    config_path.write_text(
        '{"spaces": [], "domains": [{"name": "旧业务域", "space_ids": [], '
        '"color": "#111111", "bg": "#eeeeee", "icon": "Factory", '
        '"background_image": "", "enabled": true}], "sections": [], '
        '"qa": {"knowledge_space_ids": [], "welcome_message": "旧欢迎语", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": "legacy-model"}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": []}',
        encoding="utf-8",
    )

    service = PortalConfigService(config_path=config_path)
    assert service.get_config().domains[0].name == "旧业务域"
    assert service.get_config().qa.general_model == "legacy-model"
    assert service.get_config().qa.selected_model == "legacy-model"
    assert service.get_config().qa.quick_mode_system_prompt
    assert service.get_config().qa.normal_mode_system_prompt
    assert service.get_config().qa.expert_mode_system_prompt
    assert service.get_config().qa.template_categories
    assert service.get_config().qa.templates

    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace("旧业务域", "被忽略业务域"),
        encoding="utf-8",
    )

    reloaded = PortalConfigService(config_path=config_path).get_config()
    assert reloaded.domains[0].name == "旧业务域"


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


def test_domain_config_round_trips_code(tmp_path):
    from app.schemas.portal_config import DomainsConfigUpdate
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    service.update_domains(
        DomainsConfigUpdate(
            domains=[
                {
                    "name": "生产", "space_ids": [], "color": "#2563eb", "bg": "#eff6ff",
                    "icon": "Factory", "background_image": "", "enabled": True, "code": "PP",
                }
            ]
        )
    )
    assert service.get_config().domains[0].code == "PP"
