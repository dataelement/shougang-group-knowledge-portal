from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_config import AgentConfig, PortalConfig
from app.services.config_store import InMemoryConfigStore
from app.services.portal_config_service import PortalConfigService
from app.schemas.portal_config import DomainsConfigUpdate


def test_portal_config_service_seeds_default_config(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"

    service = PortalConfigService(config_path=config_path)
    config = service.get_config()

    assert not config_path.exists()
    assert len(config.domains) == 10
    assert all(domain.space_ids == [] for domain in config.domains)
    domain_names = [domain.name for domain in config.domains]
    assert domain_names == [
        "营销", "财务", "设备", "安全", "环保",
        "人力", "信息", "能源", "质量", "管理",
    ]
    assert all(domain.background_image for domain in config.domains)
    assert config.qa.general_model == ""
    assert config.qa.reasoning_model == ""
    assert config.qa.general_model_display_name == ""
    assert config.qa.reasoning_model_display_name == ""
    assert config.qa.quick_mode_system_prompt
    assert config.qa.normal_mode_system_prompt
    assert config.qa.expert_mode_system_prompt
    assert config.search.rerank_model_id == ""
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
        '{"domains": [{"name": "旧业务域", "space_ids": [], '
        '"color": "#111111", "bg": "#eeeeee", "icon": "Factory", '
        '"background_image": "", "enabled": true}], "sections": [], '
        '"qa": {"welcome_message": "旧欢迎语", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": "legacy-model"}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": []}',
        encoding="utf-8",
    )

    store = InMemoryConfigStore()
    service = PortalConfigService(config_path=config_path, store=store)
    assert service.get_config().domains[0].name == "旧业务域"
    assert service.get_config().qa.general_model == "legacy-model"
    assert service.get_config().qa.selected_model == "legacy-model"
    assert service.get_config().qa.general_model_display_name == ""
    assert service.get_config().qa.reasoning_model_display_name == ""
    assert service.get_config().qa.quick_mode_system_prompt
    assert service.get_config().qa.normal_mode_system_prompt
    assert service.get_config().qa.expert_mode_system_prompt
    assert service.get_config().qa.template_categories
    assert service.get_config().qa.templates
    assert service.get_config().search.rerank_model_id == ""

    config_path.write_text(
        config_path.read_text(encoding="utf-8").replace("旧业务域", "被忽略业务域"),
        encoding="utf-8",
    )

    reloaded = PortalConfigService(config_path=config_path, store=store).get_config()
    assert reloaded.domains[0].name == "旧业务域"


def test_portal_config_service_accepts_unbound_domain(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    store = InMemoryConfigStore()
    service = PortalConfigService(config_path=config_path, store=store)

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
    store = InMemoryConfigStore()
    service = PortalConfigService(config_path=config_path, store=store)

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

    reloaded = PortalConfigService(config_path=config_path, store=store).get_config()

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


def test_site_config_has_default_cache_ttl(tmp_path):
    from app.services.portal_config_service import PortalConfigService

    service = PortalConfigService(config_path=tmp_path / "portal.json")
    assert service.get_config().site.domain_count_cache_ttl_seconds == 43200


def test_portal_config_migrates_legacy_agents_and_only_valid_url_apps():
    payload = deepcopy(DEFAULT_PORTAL_CONFIG)
    payload["agent_config"] = {
        "categories": [{"id": "qa", "name": "AI问答", "enabled": True}],
        "agents": [
            {
                "id": "policy",
                "workflow_id": "wf-1",
                "name": "制度专家",
                "desc": "制度问答",
                "category_id": "qa",
                "tags": ["制度"],
                "icon": "BookOpen",
                "color": "#0f766e",
                "bg": "#ccfbf1",
                "enabled": True,
            }
        ],
    }
    payload["apps"] = [
        {
            "id": 7,
            "name": "有效 URL",
            "icon": "Globe",
            "desc": "可嵌入应用",
            "color": "#2563eb",
            "bg": "#eff6ff",
            "url": "https://apps.example.com/demo",
            "enabled": True,
        },
        {
            "id": 8,
            "name": "空 URL",
            "icon": "Globe",
            "desc": "不迁移",
            "color": "#2563eb",
            "bg": "#eff6ff",
            "url": "",
            "enabled": True,
        },
        {
            "id": 9,
            "name": "危险 URL",
            "icon": "Globe",
            "desc": "不迁移",
            "color": "#2563eb",
            "bg": "#eff6ff",
            "url": "javascript:alert(1)",
            "enabled": True,
        },
    ]

    config = PortalConfig.model_validate(payload)

    assert [category.id for category in config.agent_config.categories] == ["qa", "url-apps"]
    assert [item.id for item in config.agent_config.applications] == ["policy", "url-app-7"]
    assert config.agent_config.applications[0].type == "workflow"
    assert config.agent_config.applications[1].type == "url"
    assert config.agent_config.applications[1].url == "https://apps.example.com/demo"
    assert "apps" not in config.model_dump(mode="json")


def test_portal_config_legacy_url_migration_is_idempotent():
    payload = deepcopy(DEFAULT_PORTAL_CONFIG)
    payload["agent_config"] = {"categories": [], "applications": []}
    payload["apps"] = [
        {
            "id": 1,
            "name": "门户应用",
            "icon": "Globe",
            "desc": "门户应用",
            "color": "#2563eb",
            "bg": "#eff6ff",
            "url": "https://apps.example.com",
            "enabled": True,
        }
    ]

    first = PortalConfig.model_validate(payload)
    second_payload = first.model_dump(mode="json")
    second_payload["apps"] = payload["apps"]
    second = PortalConfig.model_validate(second_payload)

    assert [category.id for category in second.agent_config.categories] == ["url-apps"]
    assert [item.id for item in second.agent_config.applications] == ["url-app-1"]


def test_unified_application_validation_is_type_specific():
    category = {"id": "apps", "name": "应用", "enabled": True}
    shared = {
        "id": "item",
        "name": "应用",
        "desc": "",
        "category_id": "apps",
        "tags": [],
        "icon": "Globe",
        "icon_image_url": "",
        "color": "#2563eb",
        "bg": "#eff6ff",
        "enabled": True,
    }

    with pytest.raises(ValidationError):
        AgentConfig.model_validate({
            "categories": [category],
            "applications": [{**shared, "type": "workflow", "workflow_id": "", "url": ""}],
        })
    with pytest.raises(ValidationError):
        AgentConfig.model_validate({
            "categories": [category],
            "applications": [{**shared, "type": "url", "workflow_id": "", "url": "data:text/html,x"}],
        })

    config = AgentConfig.model_validate({
        "categories": [category],
        "applications": [
            {**shared, "id": "wf", "type": "workflow", "workflow_id": "wf-1", "url": ""},
            {**shared, "id": "url", "type": "url", "workflow_id": "", "url": "https://apps.example.com"},
        ],
    })
    assert [item.type for item in config.applications] == ["workflow", "url"]
