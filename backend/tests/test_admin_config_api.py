from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.schemas.portal_config import SpacesConfigUpdate
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_config_service import PortalConfigService


class FakeBishengClient:
    def __init__(self):
        self.post_calls: list[tuple[str, dict | None]] = []

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/workstation/config/daily":
            return {
                "data": {
                    "models": [
                        {
                            "key": "daily-1",
                            "id": "1",
                            "name": "",
                            "displayName": "日常模型 1",
                            "visual": False,
                        }
                    ]
                }
            }
        if path.startswith("/api/v1/knowledge/space/") and path.endswith("/info"):
            space_id = int(path.split("/")[5])
            return {
                "data": {
                    "id": space_id,
                    "name": f"空间{space_id}",
                    "file_num": space_id + 1,
                }
            }
        if path == "/api/v1/knowledge":
            return {
                "data": {
                    "data": [
                        {
                            "id": 19,
                            "name": "知识空间测试",
                            "description": "测试空间",
                            "type": 3,
                        }
                    ]
                }
            }
        if path == "/api/v1/knowledge/file_list/19":
            return {
                "data": {
                    "data": [
                        {
                            "id": 101,
                            "file_name": "操作手册.pdf",
                        },
                        {
                            "id": 102,
                            "file_name": "点检标准.docx",
                        },
                    ]
                }
            }
        raise AssertionError(f"Unexpected path: {path}")

    async def post_json(self, path: str, json=None):
        self.post_calls.append((path, json))
        if path == "/api/v1/knowledge/shougang-portal/spaces/info":
            space_ids = (json or {}).get("space_ids", [])
            return {
                "data": {
                    "spaces": [
                        {
                            "id": space_id,
                            "data": {
                            "id": space_id,
                            "name": f"空间{space_id}",
                            "file_num": space_id + 1,
                            "space_level": "department" if space_id == 19 else "personal",
                        },
                            "error": None,
                        }
                        for space_id in space_ids
                    ]
                }
            }
        raise AssertionError(f"Unexpected post path: {path}")

    async def aclose(self):
        return None


class FakeRuntimeBishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: str | None = None,
        *,
        asset_base_url: str | None = None,
    ):
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.api_token = api_token
        self.asset_base_url = asset_base_url

    async def get_json(self, path: str, params=None):
        if path == "/api/v1/user/get_captcha":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"captcha_key": "cap", "user_capthca": False, "captcha": ""},
            }
        if path == "/api/v1/user/public_key":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"public_key": "fake-public-key"},
            }
        if path == "/api/v1/user/info":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {
                    "user_name": "portal-admin",
                    "nick_name": "门户服务账号",
                    "role_name": "管理员",
                },
            }
        raise AssertionError(f"Unexpected runtime path: {path}")

    async def post_json(self, path: str, json=None):
        if path == "/api/v1/user/login":
            return {
                "status_code": 200,
                "status_message": "SUCCESS",
                "data": {"access_token": "runtime-token"},
            }
        raise AssertionError(f"Unexpected runtime path: {path}")

    async def aclose(self):
        return None


def create_runtime_service(tmp_path: Path) -> BishengRuntimeService:
    return BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_api_token="",
        client_factory=FakeRuntimeBishengClient,
        password_encryptor=lambda _public_key, _password: "encrypted-password",
    )


def test_get_admin_config_uses_portal_config_service(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    service.update_spaces(
        SpacesConfigUpdate(
            spaces=[
                {"id": 12, "name": "占位", "file_count": 0, "tag_count": 0, "enabled": True},
            ]
        )
    )
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = bisheng_client
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config")

    assert response.status_code == 200
    body = response.json()
    assert body["status_code"] == 200
    assert "spaces" in body["data"]
    assert "domains" in body["data"]
    assert "welcome_message" in body["data"]["qa"]
    assert "ai_search_system_prompt" in body["data"]["qa"]
    assert "qa_system_prompt" in body["data"]["qa"]
    assert "selected_model" in body["data"]["qa"]
    assert body["data"]["spaces"][0]["name"] == "空间12"
    assert body["data"]["spaces"][0]["file_count"] == 13
    assert bisheng_client.post_calls == [
        ("/api/v1/knowledge/shougang-portal/spaces/info", {"space_ids": [12]})
    ]


def test_post_admin_domains_updates_persisted_config(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "炼钢",
                        "space_ids": [25],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["domains"][0]["name"] == "炼钢"
    assert body["data"]["domains"][0]["background_image"] == "/steel.png"
    assert service.get_config().domains[0].name == "炼钢"


def test_post_admin_qa_updates_prompt_fields(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/qa",
            json={
                "knowledge_space_ids": [12, 18],
                "welcome_message": "你好，我是首钢设备诊断助手，请问有什么可以帮您？",
                "hot_questions": ["振动纹通常如何排查？"],
                "ai_search_system_prompt": "搜索提示词",
                "qa_system_prompt": "问答提示词",
                "selected_model": "1",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["welcome_message"] == "你好，我是首钢设备诊断助手，请问有什么可以帮您？"
    assert body["data"]["ai_search_system_prompt"] == "搜索提示词"
    assert body["data"]["qa_system_prompt"] == "问答提示词"
    assert body["data"]["selected_model"] == "1"
    assert service.get_config().qa.welcome_message == "你好，我是首钢设备诊断助手，请问有什么可以帮您？"
    assert service.get_config().qa.ai_search_system_prompt == "搜索提示词"
    assert service.get_config().qa.qa_system_prompt == "问答提示词"
    assert service.get_config().qa.selected_model == "1"


def test_post_admin_sections_persists_icon_and_color_fields(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/sections",
            json={
                "sections": [
                    {
                        "title": "知识推荐 · 最新精选",
                        "tag": "最新精选",
                        "link": "/list?tag=%E6%9C%80%E6%96%B0%E7%B2%BE%E9%80%89",
                        "icon": "Star",
                        "color": "#2563eb",
                        "bg": "#eff6ff",
                        "enabled": True,
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["sections"][0]["icon"] == "Star"
    assert body["data"]["sections"][0]["color"] == "#2563eb"
    assert body["data"]["sections"][0]["bg"] == "#eff6ff"
    assert service.get_config().sections[0].color == "#2563eb"
    assert service.get_config().sections[0].bg == "#eff6ff"


def test_get_admin_qa_model_options_uses_bisheng_daily_config(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    service.update_qa(
        service.get_config().qa.model_copy(
            update={"selected_model": "1"}
        )
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/qa/model-options")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["selected_model"] == "1"
    assert body["models"] == [
        {
            "key": "daily-1",
            "id": "1",
            "name": "",
            "display_name": "日常模型 1",
            "visual": False,
        }
    ]


def test_get_admin_space_options_uses_bisheng_knowledge_list(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = bisheng_client
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/space-options")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "options": [
            {
                "id": 19,
                "name": "空间19",
                "description": "测试空间",
                "file_count": 20,
                "space_level": "department",
            }
        ]
    }
    assert bisheng_client.post_calls == [
        ("/api/v1/knowledge/shougang-portal/spaces/info", {"space_ids": [19]})
    ]


def test_get_admin_space_files_uses_bisheng_file_list(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/spaces/19/files")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "space_id": 19,
        "files": [
            {"id": 101, "name": "操作手册.pdf"},
            {"id": 102, "name": "点检标准.docx"},
        ],
    }


def test_admin_config_endpoints_fail_soft_when_bisheng_is_unauthorized(tmp_path: Path):
    class UnauthorizedBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path in {
                "/api/v1/knowledge",
                "/api/v1/workstation/config/daily",
                "/api/v1/knowledge/file_list/19",
            }:
                raise RuntimeError("401 Unauthorized")
            return await super().get_json(path, params=params)

    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = UnauthorizedBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        space_options_response = client.get("/api/v1/admin/config/space-options")
        model_options_response = client.get("/api/v1/admin/config/qa/model-options")
        space_files_response = client.get("/api/v1/admin/config/spaces/19/files")

    assert space_options_response.status_code == 200
    assert space_options_response.json()["data"]["options"] == []

    assert model_options_response.status_code == 200
    model_options = model_options_response.json()["data"]
    assert model_options["models"] == []
    assert model_options["selected_model"] == service.get_config().qa.selected_model

    assert space_files_response.status_code == 200
    assert space_files_response.json()["data"]["files"] == []


def test_post_admin_banners_persists_full_payload(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/banners",
            json={
                "banners": [
                    {
                        "id": 1,
                        "label": "新春活动",
                        "title": "首钢股份知库 — 2026 春季技术月",
                        "desc": "聚焦冷轧、能源、智能制造三大主题",
                        "image_url": "/uploads/banners/abc123.jpg",
                        "link_url": "https://intranet.example.com/spring",
                        "enabled": True,
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["banners"][0]["title"] == "首钢股份知库 — 2026 春季技术月"
    assert body["data"]["banners"][0]["image_url"] == "/uploads/banners/abc123.jpg"
    assert body["data"]["banners"][0]["link_url"] == "https://intranet.example.com/spring"
    persisted = service.get_config().banners
    assert persisted[0].title == "首钢股份知库 — 2026 春季技术月"
    assert persisted[0].image_url == "/uploads/banners/abc123.jpg"


def test_post_admin_banners_rejects_missing_required_fields(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/banners",
            json={"banners": [{"id": 1, "label": "缺标题"}]},
        )

    assert response.status_code == 422


def test_get_admin_banners_seeds_defaults_when_missing(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    config_path.write_text(
        '{"spaces": [], "domains": [], "sections": [], '
        '"qa": {"knowledge_space_ids": [], "welcome_message": "", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": ""}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": []}',
        encoding="utf-8",
    )
    service = PortalConfigService(config_path=config_path)
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/banners")

    assert response.status_code == 200
    banners = response.json()["data"]["banners"]
    assert len(banners) >= 3
    assert banners[0]["image_url"] == "/banner-hero-1.jpg"
    assert banners[0]["title"]


def test_post_admin_bisheng_config_updates_runtime_without_echoing_secret(tmp_path: Path):
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/bisheng",
            json={
                "base_url": "http://example.com",
                "username": "portal-admin",
                "password": "super-secret",
                "timeout_seconds": 45,
            },
        )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["base_url"] == "http://example.com/"
    assert body["username"] == "portal-admin"
    assert body["has_token"] is True
    assert body["connected"] is True
    assert body["auth_message"] == "已连接"
    assert body["auth_user"] == {
        "account": "portal-admin",
        "name": "门户服务账号",
        "role": "管理员",
        "external_id": "",
    }
    assert "password" not in body


def test_get_admin_integrations_defaults_to_empty(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "bisheng_admin_entry_url": "",
        "bisheng_knowledge_entry_url": "",
    }


def test_post_admin_integrations_persists_url(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    url = "http://192.168.106.120:3002/workspace/shougang-portal-admin"
    knowledge_url = "http://192.168.106.120:3002/workspace/knowledge"
    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        post_response = client.post(
            "/api/v1/admin/config/integrations",
            json={
                "bisheng_admin_entry_url": url,
                "bisheng_knowledge_entry_url": knowledge_url,
            },
        )
        get_response = client.get("/api/v1/admin/config/integrations")

    assert post_response.status_code == 200
    assert post_response.json()["data"]["bisheng_admin_entry_url"] == url
    assert post_response.json()["data"]["bisheng_knowledge_entry_url"] == knowledge_url
    assert get_response.json()["data"]["bisheng_admin_entry_url"] == url
    assert get_response.json()["data"]["bisheng_knowledge_entry_url"] == knowledge_url
    assert service.get_config().integrations.bisheng_admin_entry_url == url
    assert service.get_config().integrations.bisheng_knowledge_entry_url == knowledge_url


def test_post_admin_integrations_accepts_empty_to_clear(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    service.update_integrations(
        type(service.get_config().integrations)(bisheng_admin_entry_url="http://example.com/admin")
    )
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/integrations",
            json={"bisheng_admin_entry_url": ""},
        )

    assert response.status_code == 200
    assert response.json()["data"]["bisheng_admin_entry_url"] == ""
    assert response.json()["data"]["bisheng_knowledge_entry_url"] == ""
    assert service.get_config().integrations.bisheng_admin_entry_url == ""
    assert service.get_config().integrations.bisheng_knowledge_entry_url == ""


def test_get_admin_config_seeds_integrations_when_missing_from_legacy_json(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    config_path.write_text(
        '{"spaces": [], "domains": [], "sections": [], '
        '"qa": {"knowledge_space_ids": [], "welcome_message": "", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": ""}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": []}',
        encoding="utf-8",
    )
    service = PortalConfigService(config_path=config_path)
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "bisheng_admin_entry_url": "",
        "bisheng_knowledge_entry_url": "",
    }


def test_get_admin_config_backfills_missing_integration_keys(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    config_path.write_text(
        '{"spaces": [], "domains": [], "sections": [], '
        '"qa": {"knowledge_space_ids": [], "welcome_message": "", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": ""}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": [], "integrations": {"bisheng_admin_entry_url": "http://example.com/admin"}}',
        encoding="utf-8",
    )
    service = PortalConfigService(config_path=config_path)
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "bisheng_admin_entry_url": "http://example.com/admin",
        "bisheng_knowledge_entry_url": "",
    }


def test_get_admin_site_defaults_to_brand_values(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/site")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "header_brand_name": "首钢股份知库",
        "header_logo_url": "/site-logo-new.png",
        "login_brand_name": "首钢股份知库",
        "login_logo_url": "/shougang-stock-logo.png",
        "browser_title": "首钢股份知库",
        "favicon_url": "/site-favicon-horizontal-v2.png",
    }


def test_post_admin_site_persists_brand_values(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    payload = {
        "header_brand_name": "集团知识门户",
        "header_logo_url": "/custom-header.png",
        "login_brand_name": "集团知库",
        "login_logo_url": "https://assets.example.com/login.png",
        "browser_title": "集团知识门户",
        "favicon_url": "/custom-favicon.svg",
    }
    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        post_response = client.post("/api/v1/admin/config/site", json=payload)
        get_response = client.get("/api/v1/admin/config/site")

    assert post_response.status_code == 200
    assert post_response.json()["data"] == payload
    assert get_response.json()["data"] == payload
    assert service.get_config().site.browser_title == "集团知识门户"


def test_get_admin_config_backfills_missing_site_from_legacy_json(tmp_path: Path):
    config_path = tmp_path / "portal_config.json"
    config_path.write_text(
        '{"spaces": [], "domains": [], "sections": [], '
        '"qa": {"knowledge_space_ids": [], "welcome_message": "", '
        '"hot_questions": [], "ai_search_system_prompt": "", "qa_system_prompt": "", "selected_model": ""}, '
        '"recommendation": {"provider": "tag_feed", "home_strategy": "x", "detail_strategy": "y"}, '
        '"display": {"home": {}, "list": {}, "search": {}, "detail": {}}, '
        '"apps": [], "integrations": {"bisheng_admin_entry_url": "", "bisheng_knowledge_entry_url": ""}}',
        encoding="utf-8",
    )
    service = PortalConfigService(config_path=config_path)
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/site")

    assert response.status_code == 200
    assert response.json()["data"]["header_brand_name"] == "首钢股份知库"
    assert response.json()["data"]["favicon_url"] == "/site-favicon-horizontal-v2.png"
