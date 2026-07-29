import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import require_admin_session
from app.main import app
from app.schemas.auth import PortalUserView
from app.schemas.portal_config import DomainsConfigUpdate, PortalConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import InMemoryConfigStore
from app.services.portal_auth_service import PortalAuthError
from app.services.portal_config_service import PortalConfigService


class FakeBishengClient:
    def __init__(self):
        self.get_calls: list[str] = []
        self.post_calls: list[tuple[str, dict | None]] = []
        self.put_calls: list[tuple[str, dict | None]] = []
        self.delete_calls: list[int] = []
        self.bindings: list[dict] = []
        self.bind_status: dict = {"status_code": 200, "data": {}}
        self.bindable_params: object = "UNSET"
        self.bindable_spaces: list[dict] = [{"id": 30, "name": "可绑定知识库示例"}]
        self.departments: list[dict] = [{"id": 3, "name": "研发部", "children": []}]

    async def get_json(self, path: str, params=None):
        self.get_calls.append(path)
        if path == "/api/v1/workstation/config":
            return {
                "data": {
                    "shougang": {
                        "file_encoding": {
                            "document_types": [
                                {"code": "RPT", "label": "报告"},
                                {"code": "STD", "label": "标准规范"},
                            ]
                        }
                    }
                }
            }
        if path == "/api/v1/llm":
            return {
                "data": [
                    {
                        "id": 8,
                        "name": "DeepSeek 服务商",
                        "models": [
                            {
                                "id": 1,
                                "name": "DeepSeek Chat",
                                "model_name": "deepseek-chat",
                                "model_type": "llm",
                                "online": True,
                                "status": 0,
                            },
                            {
                                "id": 2,
                                "name": "DeepSeek Reasoner",
                                "model_name": "deepseek-reasoner",
                                "model_type": "llm",
                                "online": True,
                                "status": 0,
                            },
                            {
                                "id": 8,
                                "name": "状态异常模型",
                                "model_name": "unhealthy-chat",
                                "model_type": "llm",
                                "online": True,
                                "status": 1,
                                "remark": "模型服务连接超时",
                            },
                            {
                                "id": 3,
                                "name": "离线模型",
                                "model_name": "offline-chat",
                                "model_type": "llm",
                                "online": False,
                                "status": 1,
                            },
                            {
                                "id": 7,
                                "name": "字符串停用模型",
                                "model_name": "string-offline-chat",
                                "model_type": "llm",
                                "online": "false",
                                "status": 1,
                            },
                            {
                                "id": 4,
                                "name": "Embedding",
                                "model_name": "embedding",
                                "model_type": "embedding",
                                "online": True,
                                "status": 0,
                            },
                            {
                                "id": 5,
                                "name": "BGE Reranker",
                                "model_name": "bge-reranker-v2",
                                "model_type": "rerank",
                                "online": True,
                                "status": 0,
                            },
                            {
                                "id": 6,
                                "name": "离线重排",
                                "model_name": "offline-reranker",
                                "model_type": "rerank",
                                "online": False,
                                "status": 1,
                            },
                        ],
                    }
                ]
            }
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
        if path == "/api/v1/knowledge/shougang-portal/spaces/domain-bindable":
            return {
                "data": {
                    "spaces": [
                        {
                            "id": 19,
                            "name": "公共知识空间",
                            "description": "测试空间",
                            "file_num": 0,
                            "space_level": "public",
                            "business_domain_codes": [],
                        },
                        {
                            "id": 20,
                            "name": "部门知识空间",
                            "description": "部门空间",
                            "file_num": 0,
                            "space_level": "department",
                            "business_domain_codes": ["QM"],
                        },
                    ]
                }
            }
        if path == "/api/v1/knowledge/space/grouped":
            return {
                "data": {
                    "personal_spaces": [
                        {
                            "id": 21,
                            "name": "个人知识空间",
                            "description": "个人空间",
                            "file_count": 3,
                            "updated_at": "2026-01-03T00:00:00",
                        }
                    ],
                    "team_spaces": [
                        {
                            "id": 22,
                            "name": "团队知识空间",
                            "description": "团队空间",
                            "file_count": 4,
                            "updated_at": "2026-01-03T00:00:00",
                        }
                    ],
                    "department_spaces": [
                        {
                            "id": 20,
                            "name": "部门知识空间",
                            "description": "部门空间",
                            "file_count": 30,
                            "updated_at": "2026-01-01T00:00:00",
                            "business_domain_codes": ["QM"],
                        }
                    ],
                    "public_spaces": [
                        {
                            "id": 19,
                            "name": "公共知识空间",
                            "description": "测试空间",
                            "file_count": 20,
                            "updated_at": "2026-01-02T00:00:00",
                            "business_domain_codes": [],
                        }
                    ],
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
        if path == "/api/v1/knowledge/space/department-binding/bindings":
            return {"status_code": 200, "data": self.bindings}
        if path == "/api/v1/knowledge/space/department-binding/bindable-spaces":
            self.bindable_params = params
            return {"status_code": 200, "data": self.bindable_spaces}
        if path == "/api/v1/knowledge/space/department-binding/departments":
            return {"status_code": 200, "data": self.departments}
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
        if path == "/api/v1/knowledge/space/department-binding":
            return self.bind_status
        raise AssertionError(f"Unexpected post path: {path}")

    async def put_json(self, path: str, json=None):
        self.put_calls.append((path, json))
        if path == "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes":
            return {"status_code": 200, "status_message": "SUCCESS", "data": {"updated": len((json or {}).get("bindings", []))}}
        raise AssertionError(f"Unexpected put path: {path}")

    async def delete_json(self, path: str, json=None):
        prefix = "/api/v1/knowledge/space/department-binding/"
        if path.startswith(prefix):
            space_id = int(path[len(prefix):])
            self.delete_calls.append(space_id)
            return {"status_code": 200, "data": {}}
        raise AssertionError(f"Unexpected delete path: {path}")

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


class FakeAdminAuthService:
    def __init__(self, role: str | None, account: str = "portal-user"):
        self.role = role
        self.account = account

    def require_session(self, _request):
        if self.role is None:
            raise PortalAuthError("请先登录", status_code=401)
        return SimpleNamespace(
            user=PortalUserView(
                account=self.account,
                name="门户用户",
                initial="门",
                role=self.role,
                external_id="00014",
                login_at=1,
            )
        )


def make_admin_session(role: str = "管理员"):
    return SimpleNamespace(
        user=PortalUserView(
            account="portal-admin",
            name="门户管理员",
            initial="门",
            role=role,
            external_id="",
            login_at=1,
        )
    )


@pytest.fixture(autouse=True)
def allow_admin_access_by_default():
    app.dependency_overrides[require_admin_session] = make_admin_session
    yield
    app.dependency_overrides.pop(require_admin_session, None)


def create_runtime_service(tmp_path: Path) -> BishengRuntimeService:
    return BishengRuntimeService(
        config_path=tmp_path / "bisheng_runtime.json",
        default_base_url="http://example.com",
        default_timeout_seconds=30.0,
        default_api_token="",
        client_factory=FakeRuntimeBishengClient,
        password_encryptor=lambda _public_key, _password: "encrypted-password",
    )


def test_admin_config_import_export_routes_are_unavailable():
    with TestClient(app) as client:
        assert client.get("/api/v1/admin/config/export").status_code == 404
        assert client.post("/api/v1/admin/config/import").status_code == 404


def test_admin_config_requires_login(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.portal_auth_service = FakeAdminAuthService(role=None)
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 401


def test_admin_config_rejects_non_admin_user(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.portal_auth_service = FakeAdminAuthService(role="设备管理部")
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 403


def test_admin_config_allows_bisheng_admin_role(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.portal_auth_service = FakeAdminAuthService(role="admin")
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 200


def test_admin_config_allows_admin_account_fallback(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.portal_auth_service = FakeAdminAuthService(
            role="内部员工",
            account="Admin",
        )
        response = client.get("/api/v1/admin/config/integrations")

    assert response.status_code == 200


def test_public_portal_config_does_not_require_admin(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    config_data = service.get_config().model_dump()
    config_data["domains"] = [
        {
            "name": "生产",
            "space_ids": [],
            "color": "#059669",
            "bg": "#d1fae5",
            "icon": "Factory",
            "background_image": "",
            "enabled": True,
            "code": "pp",
        },
        {
            "name": "未编码业务域",
            "space_ids": [],
            "color": "#2563eb",
            "bg": "#eff6ff",
            "icon": "Settings",
            "background_image": "",
            "enabled": True,
            "code": "",
        },
        {
            "name": "质量",
            "space_ids": [],
            "color": "#6366f1",
            "bg": "#ede9fe",
            "icon": "CheckCircle",
            "background_image": "",
            "enabled": True,
            "code": "QM",
        },
        {
            "name": "安全",
            "space_ids": [],
            "color": "#f97316",
            "bg": "#fff7ed",
            "icon": "Shield",
            "background_image": "",
            "enabled": False,
            "code": "SA",
        },
    ]
    service.replace_config(PortalConfig.model_validate(config_data))
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.get("/api/v1/knowledge/config")

    assert response.status_code == 200
    data = response.json()["data"]
    assert "site" in data
    assert data["document_types"] == [
        {"code": "RPT", "label": "报告", "description_examples": "", "children": [{"code": "RPT", "label": "报告", "description_examples": ""}]},
        {"code": "STD", "label": "标准规范", "description_examples": "", "children": [{"code": "STD", "label": "标准规范", "description_examples": ""}]},
    ]
    assert data["business_domain_options"] == [
        {"code": "PP", "name": "生产"},
        {"code": "QM", "name": "质量"},
    ]
    assert data["qa"]["templates"]
    assert all("prompt" not in template for template in data["qa"]["templates"])


def test_public_portal_config_refreshes_qa_model_display_names_for_non_admin_user(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    config_data = service.get_config().model_dump()
    config_data["qa"].update(
        {
            "selected_model": "1",
            "general_model": "1",
            "reasoning_model": "2",
            "general_model_display_name": "",
            "reasoning_model_display_name": "",
        }
    )
    service.replace_config(PortalConfig.model_validate(config_data))
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.get("/api/v1/knowledge/config")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["qa"]["general_model_display_name"] == "deepseek-chat"
    assert data["qa"]["reasoning_model_display_name"] == "deepseek-reasoner"
    assert service.get_config().qa.general_model_display_name == "deepseek-chat"
    assert service.get_config().qa.reasoning_model_display_name == "deepseek-reasoner"


def test_public_qa_model_options_do_not_require_admin(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    service.update_qa(
        service.get_config().qa.model_copy(
            update={
                "selected_model": "1",
                "general_model": "1",
                "reasoning_model": "2",
                "general_model_display_name": "",
                "reasoning_model_display_name": "",
            }
        )
    )
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.get("/api/v1/knowledge/qa/model-options")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["general_model_display_name"] == "deepseek-chat"
    assert data["reasoning_model_display_name"] == "deepseek-reasoner"
    assert data["models"][0]["id"] == "1"
    assert data["models"][0]["name"] == "deepseek-chat"


def test_public_portal_config_keeps_qa_model_ids_when_name_refresh_fails(tmp_path: Path):
    class FailingQaModelBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/llm":
                raise RuntimeError("model list unavailable")
            return await super().get_json(path, params=params)

    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    config_data = service.get_config().model_dump()
    config_data["qa"].update(
        {
            "selected_model": "1",
            "general_model": "1",
            "reasoning_model": "2",
            "general_model_display_name": "",
            "reasoning_model_display_name": "",
        }
    )
    service.replace_config(PortalConfig.model_validate(config_data))
    app.dependency_overrides.pop(require_admin_session, None)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FailingQaModelBishengClient()
        response = client.get("/api/v1/knowledge/config")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["qa"]["general_model"] == "1"
    assert data["qa"]["reasoning_model"] == "2"
    assert data["qa"]["general_model_display_name"] == ""
    assert data["qa"]["reasoning_model_display_name"] == ""


def test_update_document_types_strips_hidden_characters(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        response = client.post(
            "/api/v1/admin/config/document-types",
            json={
                "document_types": [
                    {"code": "cas\u200b", "label": "案例\u200b", "description_examples": "\u200b包含典型案例与事故复盘\u200b"},
                    {"code": "\ufeffSTD", "label": "\u200c标准规范"},
                ],
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["document_types"] == [
        {
            "code": "CAS",
            "label": "案例",
            "description_examples": "包含典型案例与事故复盘",
            "children": [{"code": "CAS", "label": "案例", "description_examples": ""}],
        },
        {"code": "STD", "label": "标准规范", "description_examples": "", "children": [{"code": "STD", "label": "标准规范", "description_examples": ""}]},
    ]
    assert [item.model_dump() for item in service.get_config().document_types] == [
        {
            "code": "CAS",
            "label": "案例",
            "description_examples": "包含典型案例与事故复盘",
            "children": [{"code": "CAS", "label": "案例", "description_examples": ""}],
        },
        {"code": "STD", "label": "标准规范", "description_examples": "", "children": [{"code": "STD", "label": "标准规范", "description_examples": ""}]},
    ]


def test_update_document_types_accepts_child_categories(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        response = client.post(
            "/api/v1/admin/config/document-types",
            json={
                "document_types": [
                    {
                        "code": "pol",
                        "label": "政策制度",
                        "description_examples": "例如：管理制度、通知公告",
                        "children": [
                            {"code": "POL-REG\u200b", "label": "制度文件\u200b", "description_examples": "\u200b示例：管理制度\u200b"},
                            {"code": "POL-NOTICE", "label": "通知公告"},
                        ],
                    },
                ],
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["document_types"] == [
        {
            "code": "POL",
            "label": "政策制度",
            "description_examples": "例如：管理制度、通知公告",
            "children": [
                {"code": "POL-REG", "label": "制度文件", "description_examples": "示例：管理制度"},
                {"code": "POL-NOTICE", "label": "通知公告", "description_examples": ""},
            ],
        },
    ]


def test_update_document_types_generates_missing_child_codes(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        response = client.post(
            "/api/v1/admin/config/document-types",
            json={
                "document_types": [
                    {
                        "code": "pol",
                        "label": "政策制度",
                        "children": [
                            {"label": "制度文件"},
                            {"code": "POL-OLD", "label": "历史分类"},
                        ],
                    },
                ],
            },
        )

    assert response.status_code == 200
    children = response.json()["data"]["document_types"][0]["children"]
    assert re.fullmatch(r"POL-[A-Z0-9]{4}", children[0]["code"])
    assert children[0]["label"] == "制度文件"
    assert children[0]["description_examples"] == ""
    assert children[1] == {"code": "POL-OLD", "label": "历史分类", "description_examples": ""}
    assert response.json()["data"]["document_types"][0]["description_examples"] == ""


def test_update_document_types_rejects_empty_children(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        response = client.post(
            "/api/v1/admin/config/document-types",
            json={
                "document_types": [
                    {"code": "POL", "label": "政策制度", "children": []},
                ],
            },
        )

    assert response.status_code == 422


def test_get_admin_config_uses_portal_config_service(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
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
    assert "spaces" not in body["data"]
    assert "domains" in body["data"]
    assert "welcome_message" in body["data"]["qa"]
    assert "ai_search_system_prompt" in body["data"]["qa"]
    assert "qa_system_prompt" in body["data"]["qa"]
    assert "quick_mode_system_prompt" in body["data"]["qa"]
    assert "normal_mode_system_prompt" in body["data"]["qa"]
    assert "expert_mode_system_prompt" in body["data"]["qa"]
    assert "selected_model" in body["data"]["qa"]
    assert "template_categories" in body["data"]["qa"]
    assert "templates" in body["data"]["qa"]
    assert body["data"]["search"] == {"rerank_model_id": ""}
    assert bisheng_client.post_calls == []


def test_post_admin_domains_updates_persisted_config(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "炼钢",
                        "space_ids": [19, 20],
                        "department_ids": [3, 8, 3],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                        "code": "PP",
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["domains"][0]["name"] == "炼钢"
    assert body["data"]["domains"][0]["background_image"] == "/steel.png"
    assert body["data"]["domains"][0]["space_ids"] == [19, 20]
    assert body["data"]["domains"][0]["department_ids"] == [3, 8]
    assert service.get_config().domains[0].name == "炼钢"
    assert service.get_config().domains[0].department_ids == [3, 8]
    assert bisheng_client.put_calls == [
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {
                "bindings": [
                    {"space_id": 19, "business_domain_codes": ["PP"]},
                    {"space_id": 20, "business_domain_codes": ["PP"]},
                ]
            },
        )
    ]


def test_post_admin_domains_rejects_deleting_domain_with_valid_bound_space(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "安全",
                        "space_ids": [19],
                        "color": "#f97316",
                        "bg": "#fff7ed",
                        "icon": "Shield",
                        "background_image": "",
                        "enabled": True,
                        "code": "SA",
                    }
                ]
            }
        )
    )
    before = service.get_config().domains

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post("/api/v1/admin/config/domains", json={"domains": []})

    assert response.status_code == 409
    assert response.json()["status_message"] == "业务域已绑定有效知识空间，请先解除绑定后再删除或修改名称：安全"
    assert service.get_config().domains == before
    assert bisheng_client.put_calls == []


def test_post_admin_domains_rejects_renaming_domain_with_valid_bound_space(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "安全",
                        "space_ids": [19],
                        "color": "#f97316",
                        "bg": "#fff7ed",
                        "icon": "Shield",
                        "background_image": "",
                        "enabled": True,
                        "code": "SA",
                    }
                ]
            }
        )
    )
    before = service.get_config().domains

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "安全生产",
                        "space_ids": [19],
                        "color": "#f97316",
                        "bg": "#fff7ed",
                        "icon": "Shield",
                        "background_image": "",
                        "enabled": True,
                        "code": "SA",
                    }
                ]
            },
        )

    assert response.status_code == 409
    assert response.json()["status_message"] == "业务域已绑定有效知识空间，请先解除绑定后再删除或修改名称：安全"
    assert service.get_config().domains == before
    assert bisheng_client.put_calls == []


def test_post_admin_domains_allows_deleting_domain_with_only_invalid_space_references(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [21, 22, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "",
                        "enabled": True,
                        "code": "OLD",
                    }
                ]
            }
        )
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post("/api/v1/admin/config/domains", json={"domains": []})

    assert response.status_code == 200
    assert service.get_config().domains == []
    assert bisheng_client.put_calls == []


def test_post_admin_domains_cleans_invalid_spaces_before_sync_and_persist(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "旧业务域",
                        "space_ids": [19, 21, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "",
                        "enabled": True,
                        "code": "OLD",
                    }
                ]
            }
        )
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "旧业务域",
                        "space_ids": [19, 20, 21, 22, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                        "code": "PP",
                    }
                ]
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["domains"][0]["space_ids"] == [19, 20]
    assert service.get_config().domains[0].space_ids == [19, 20]
    synced_space_ids = {
        binding["space_id"]
        for _, payload in bisheng_client.put_calls
        for binding in payload["bindings"]
    }
    assert synced_space_ids == {19, 20}


def test_post_admin_domains_invalid_history_does_not_block_valid_save(tmp_path: Path):
    class RejectInvalidSpaceSyncBishengClient(FakeBishengClient):
        async def put_json(self, path: str, json=None):
            self.put_calls.append((path, json))
            space_ids = {binding["space_id"] for binding in (json or {}).get("bindings", [])}
            if space_ids - {19, 20}:
                return {"status_code": 18026, "status_message": "invalid space", "data": {}}
            return {"status_code": 200, "status_message": "SUCCESS", "data": {}}

    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = RejectInvalidSpaceSyncBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [19, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "",
                        "enabled": True,
                        "code": "OLD",
                    }
                ]
            }
        )
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [20],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                        "code": "PP",
                    }
                ]
            },
        )

    assert response.status_code == 200
    assert service.get_config().domains[0].space_ids == [20]
    assert bisheng_client.put_calls == [
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {
                "bindings": [
                    {"space_id": 19, "business_domain_codes": []},
                    {"space_id": 20, "business_domain_codes": ["PP"]},
                ]
            },
        )
    ]


def test_post_admin_domains_sync_ignores_disabled_domain_bindings(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "安全",
                        "space_ids": [19],
                        "color": "#f97316",
                        "bg": "#fff7ed",
                        "icon": "Shield",
                        "background_image": "",
                        "enabled": False,
                        "code": "SA",
                    }
                ]
            },
        )

    assert response.status_code == 200
    assert bisheng_client.put_calls == [
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {"bindings": [{"space_id": 19, "business_domain_codes": []}]},
        )
    ]


def test_post_admin_domains_does_not_persist_when_bisheng_sync_fails(tmp_path: Path):
    class FailingSyncBishengClient(FakeBishengClient):
        async def put_json(self, path: str, json=None):
            self.put_calls.append((path, json))
            return {"status_code": 18026, "status_message": "Invalid business domain code", "data": {}}

    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FailingSyncBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [19, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "",
                        "enabled": True,
                        "code": "OLD",
                    }
                ]
            }
        )
    )
    before = service.get_config().domains

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [19, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                        "code": "PP",
                    }
                ]
            },
        )

    assert response.status_code == 502
    assert response.json()["status_message"] == "业务域编码无效，请从业务域编码候选中选择"
    assert service.get_config().domains == before
    assert bisheng_client.put_calls == [
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {"bindings": [{"space_id": 19, "business_domain_codes": ["PP"]}]},
        )
    ]


def test_post_admin_domains_restores_only_valid_bindings_when_portal_save_fails(tmp_path: Path, monkeypatch):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    bisheng_client = FakeBishengClient()
    service.update_domains(
        DomainsConfigUpdate.model_validate(
            {
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [19, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "",
                        "enabled": True,
                        "code": "OLD",
                    }
                ]
            }
        )
    )
    before = service.get_config().domains

    def fail_update_domains(_payload):
        raise RuntimeError("portal config write failed")

    monkeypatch.setattr(service, "update_domains", fail_update_domains)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = bisheng_client
        response = client.post(
            "/api/v1/admin/config/domains",
            json={
                "domains": [
                    {
                        "name": "历史业务域",
                        "space_ids": [20, 999],
                        "color": "#111111",
                        "bg": "#eeeeee",
                        "icon": "Factory",
                        "background_image": "/steel.png",
                        "enabled": True,
                        "code": "PP",
                    }
                ]
            },
        )

    assert response.status_code == 500
    assert "已尝试恢复" in response.json()["status_message"]
    assert service.get_config().domains == before
    assert bisheng_client.put_calls == [
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {
                "bindings": [
                    {"space_id": 19, "business_domain_codes": []},
                    {"space_id": 20, "business_domain_codes": ["PP"]},
                ]
            },
        ),
        (
            "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes",
            {
                "bindings": [
                    {"space_id": 19, "business_domain_codes": ["OLD"]},
                    {"space_id": 20, "business_domain_codes": []},
                ]
            },
        ),
    ]


def test_post_admin_qa_updates_prompt_fields(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.post(
            "/api/v1/admin/config/qa",
            json={
                "welcome_message": "你好，我是首钢设备诊断助手，请问有什么可以帮您？",
                "hot_questions": ["振动纹通常如何排查？"],
                "ai_search_system_prompt": "搜索提示词",
                "qa_system_prompt": "问答提示词",
                "quick_mode_system_prompt": "快速提示词",
                "normal_mode_system_prompt": "普通提示词",
                "expert_mode_system_prompt": "专家提示词",
                "selected_model": "1",
                "general_model": "1",
                "reasoning_model": "2",
                "general_model_display_name": "deepseek-chat",
                "reasoning_model_display_name": "deepseek-reasoner",
                "template_categories": [
                    {"id": "report", "name": "工作汇报", "enabled": True},
                    {"id": "plan", "name": "方案策划", "enabled": True},
                ],
                "templates": [
                    {
                        "id": "work-plan",
                        "name": "工作计划",
                        "desc": "明确目标方向",
                        "category_id": "plan",
                        "prompt": "请帮我制定一份工作计划。",
                        "icon": "BriefcaseBusiness",
                        "color": "#f97316",
                        "bg": "#fff7ed",
                        "enabled": True,
                        "show_on_home": True,
                    }
                ],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["welcome_message"] == "你好，我是首钢设备诊断助手，请问有什么可以帮您？"
    assert body["data"]["ai_search_system_prompt"] == "搜索提示词"
    assert body["data"]["qa_system_prompt"] == "问答提示词"
    assert body["data"]["quick_mode_system_prompt"] == "快速提示词"
    assert body["data"]["normal_mode_system_prompt"] == "普通提示词"
    assert body["data"]["expert_mode_system_prompt"] == "专家提示词"
    assert body["data"]["selected_model"] == "1"
    assert body["data"]["general_model"] == "1"
    assert body["data"]["reasoning_model"] == "2"
    assert body["data"]["general_model_display_name"] == "deepseek-chat"
    assert body["data"]["reasoning_model_display_name"] == "deepseek-reasoner"
    assert body["data"]["template_categories"][1]["name"] == "方案策划"
    assert body["data"]["templates"][0]["show_on_home"] is True
    assert service.get_config().qa.welcome_message == "你好，我是首钢设备诊断助手，请问有什么可以帮您？"
    assert service.get_config().qa.ai_search_system_prompt == "搜索提示词"
    assert service.get_config().qa.qa_system_prompt == "问答提示词"
    assert service.get_config().qa.quick_mode_system_prompt == "快速提示词"
    assert service.get_config().qa.normal_mode_system_prompt == "普通提示词"
    assert service.get_config().qa.expert_mode_system_prompt == "专家提示词"
    assert service.get_config().qa.selected_model == "1"
    assert service.get_config().qa.general_model == "1"
    assert service.get_config().qa.reasoning_model == "2"
    assert service.get_config().qa.general_model_display_name == "deepseek-chat"
    assert service.get_config().qa.reasoning_model_display_name == "deepseek-reasoner"
    assert service.get_config().qa.templates[0].id == "work-plan"


def test_post_admin_qa_rejects_disabled_model_without_overwriting_saved_config(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    payload = service.get_config().qa.model_dump()
    payload.update({"selected_model": "3", "general_model": "3"})

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.post("/api/v1/admin/config/qa", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == "当前问答模型已停用，请联系管理员"
    assert service.get_config().qa.general_model == ""
    assert service.get_config().qa.selected_model == ""


def test_post_admin_search_updates_rerank_model(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/search",
            json={"rerank_model_id": "5"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == {"rerank_model_id": "5"}
    assert service.get_config().search.rerank_model_id == "5"


def test_get_admin_search_rerank_model_options_filters_rerank_models(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    service.update_search(service.get_config().search.model_copy(update={"rerank_model_id": "5"}))

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/search/rerank-model-options")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["rerank_model_id"] == "5"
    assert body["models"] == [
        {
            "key": "5",
            "id": "5",
            "name": "bge-reranker-v2",
            "display_name": "BGE Reranker",
            "visual": False,
            "provider_name": "DeepSeek 服务商",
            "status": 0,
            "remark": "",
        },
    ]


def test_post_admin_qa_rejects_invalid_template_config(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)

    payload = service.get_config().qa.model_dump()
    payload["template_categories"] = [
        {"id": "report", "name": "工作汇报", "enabled": True},
    ]
    payload["templates"] = [
        {
            "id": "orphan-template",
            "name": "孤儿模板",
            "desc": "缺少有效分类",
            "category_id": "missing",
            "prompt": "请帮我生成内容。",
            "icon": "FileText",
            "color": "#2563eb",
            "bg": "#eff6ff",
            "enabled": True,
            "show_on_home": False,
        }
    ]

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        client.app.state.bisheng_client = FakeBishengClient()
        response = client.post("/api/v1/admin/config/qa", json=payload)

    assert response.status_code == 422


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
    assert body["data"]["sections"][0]["builtin_key"] == "latest_selected"
    assert body["data"]["sections"][0]["tag"] == "最新精选"
    assert body["data"]["sections"][0]["link"] == "/list?recommendation=latest_selected"
    assert body["data"]["sections"][0]["color"] == "#2563eb"
    assert body["data"]["sections"][0]["bg"] == "#eff6ff"
    assert body["data"]["sections"][1]["builtin_key"] == "typical_case"
    assert body["data"]["sections"][1]["tag"] == "行业情报"
    assert body["data"]["sections"][1]["link"] == "/list?tag=行业情报"
    assert service.get_config().sections[0].color == "#2563eb"
    assert service.get_config().sections[0].bg == "#eff6ff"


def test_post_admin_sections_keeps_builtin_sections_when_payload_deletes_them(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    current_sections = [section.model_dump() for section in service.get_config().sections]

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.post(
            "/api/v1/admin/config/sections",
            json={"sections": [current_sections[1]]},
        )

    assert response.status_code == 200
    sections = response.json()["data"]["sections"]
    assert [section["builtin_key"] for section in sections[:2]] == ["latest_selected", "typical_case"]
    assert sections[0]["title"] == "知识推荐 · 最新精选"
    assert sections[0]["tag"] == "最新精选"
    assert sections[0]["link"] == "/list?recommendation=latest_selected"
    assert sections[1]["title"] == "典型案例 · 事故分析"
    assert sections[1]["tag"] == "行业情报"
    assert sections[1]["link"] == "/list?tag=行业情报"


def test_get_admin_config_normalizes_builtin_section_tags_and_links(tmp_path: Path):
    store = InMemoryConfigStore()
    service = PortalConfigService(config_path=tmp_path / "portal_config.json", store=store)
    stored_config = service.get_config().model_dump(mode="json")
    latest_selected = next(
        section for section in stored_config["sections"] if section["builtin_key"] == "latest_selected"
    )
    typical_case = next(
        section for section in stored_config["sections"] if section["builtin_key"] == "typical_case"
    )
    latest_selected["tag"] = "行业情报"
    latest_selected["link"] = "/list?tag=行业情报"
    typical_case["tag"] = "知识推荐"
    typical_case["link"] = "/list?tag=知识推荐"
    store.upsert_document("portal_config", stored_config)

    normalized = service.get_config()
    normalized_latest_selected = next(
        section for section in normalized.sections if section.builtin_key == "latest_selected"
    )
    normalized_typical_case = next(
        section for section in normalized.sections if section.builtin_key == "typical_case"
    )

    assert normalized_latest_selected.tag == "最新精选"
    assert normalized_latest_selected.link == "/list?recommendation=latest_selected"
    assert normalized_typical_case.tag == "行业情报"
    assert normalized_typical_case.link == "/list?tag=行业情报"


def test_get_admin_qa_model_options_uses_bisheng_model_management_list(tmp_path: Path):
    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    service.update_qa(
        service.get_config().qa.model_copy(
            update={
                "selected_model": "1",
                "general_model": "1",
                "reasoning_model": "2",
            }
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
    assert body["general_model"] == "1"
    assert body["reasoning_model"] == "2"
    assert body["general_model_display_name"] == "deepseek-chat"
    assert body["reasoning_model_display_name"] == "deepseek-reasoner"
    assert service.get_config().qa.general_model_display_name == "deepseek-chat"
    assert service.get_config().qa.reasoning_model_display_name == "deepseek-reasoner"
    assert body["models"] == [
        {
            "key": "1",
            "id": "1",
            "name": "deepseek-chat",
            "display_name": "DeepSeek Chat",
            "visual": False,
            "provider_name": "DeepSeek 服务商",
            "status": 0,
            "remark": "",
        },
        {
            "key": "2",
            "id": "2",
            "name": "deepseek-reasoner",
            "display_name": "DeepSeek Reasoner",
            "visual": False,
            "provider_name": "DeepSeek 服务商",
            "status": 0,
            "remark": "",
        },
        {
            "key": "8",
            "id": "8",
            "name": "unhealthy-chat",
            "display_name": "状态异常模型",
            "visual": False,
            "provider_name": "DeepSeek 服务商",
            "status": 1,
            "remark": "模型服务连接超时",
        },
    ]


def test_get_admin_qa_model_options_keeps_saved_display_names_when_model_list_fails(tmp_path: Path):
    class FailingModelListBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/llm":
                raise RuntimeError("model list unavailable")
            return await super().get_json(path, params)

    service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    runtime_service = create_runtime_service(tmp_path)
    service.update_qa(
        service.get_config().qa.model_copy(
            update={
                "selected_model": "1",
                "general_model": "1",
                "reasoning_model": "2",
                "general_model_display_name": "deepseek-chat",
                "reasoning_model_display_name": "deepseek-reasoner",
            }
        )
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        client.app.state.bisheng_client = FailingModelListBishengClient()
        client.app.state.bisheng_runtime_service = runtime_service
        response = client.get("/api/v1/admin/config/qa/model-options")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["general_model"] == "1"
    assert body["reasoning_model"] == "2"
    assert body["general_model_display_name"] == "deepseek-chat"
    assert body["reasoning_model_display_name"] == "deepseek-reasoner"
    assert body["models"] == []


def test_get_admin_space_options_uses_domain_bindable_space_list(tmp_path: Path):
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
                "name": "公共知识空间",
                "description": "测试空间",
                "file_count": 0,
                "space_level": "public",
                "business_domain_codes": [],
            },
            {
                "id": 20,
                "name": "部门知识空间",
                "description": "部门空间",
                "file_count": 0,
                "space_level": "department",
                "business_domain_codes": ["QM"],
            }
        ]
    }
    assert bisheng_client.post_calls == []
    assert bisheng_client.get_calls == [
        "/api/v1/knowledge/shougang-portal/spaces/domain-bindable"
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
            self.get_calls.append(path)
            if path in {
                "/api/v1/knowledge/shougang-portal/spaces/domain-bindable",
                "/api/v1/knowledge/space/grouped",
                "/api/v1/knowledge",
                "/api/v1/llm",
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
    assert "/api/v1/knowledge/shougang-portal/spaces/domain-bindable" in (
        client.app.state.bisheng_client.get_calls
    )
    assert "/api/v1/knowledge/space/grouped" not in client.app.state.bisheng_client.get_calls

    assert model_options_response.status_code == 200
    model_options = model_options_response.json()["data"]
    assert model_options["models"] == []
    assert model_options["selected_model"] == service.get_config().qa.selected_model
    assert model_options["general_model"] == service.get_config().qa.general_model
    assert model_options["reasoning_model"] == service.get_config().qa.reasoning_model

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
        '{"domains": [], "sections": [], '
        '"qa": {"welcome_message": "", '
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
        '{"domains": [], "sections": [], '
        '"qa": {"welcome_message": "", '
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
        '{"domains": [], "sections": [], '
        '"qa": {"welcome_message": "", '
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
        "domain_count_cache_ttl_seconds": 43200,
        "home_cache_ttl_seconds": 1800,
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
        "domain_count_cache_ttl_seconds": 43200,
        "home_cache_ttl_seconds": 1800,
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
        '{"domains": [], "sections": [], '
        '"qa": {"welcome_message": "", '
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


def test_get_dept_bindings_proxies_bisheng():
    fake = FakeBishengClient()
    fake.bindings = [
        {
            "space_id": 10,
            "space_name": "团队库A",
            "department_id": 3,
            "department_name": "研发部",
            "created_by": 1,
            "create_time": "2026-07-06",
        }
    ]

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/bindings")

    assert response.status_code == 200
    assert response.json()["data"][0]["space_id"] == 10


def test_post_dept_binding_forwards_body():
    fake = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.post(
            "/api/v1/admin/config/dept-knowledge-binding",
            json={"space_id": 10, "department_id": 3},
        )

    assert response.status_code == 200
    assert fake.post_calls[-1][1] == {"space_id": 10, "department_id": 3}


def test_delete_dept_binding_proxies():
    fake = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.delete("/api/v1/admin/config/dept-knowledge-binding/10")

    assert response.status_code == 200
    assert 10 in fake.delete_calls


def test_post_dept_binding_maps_bisheng_error():
    fake = FakeBishengClient()
    fake.bind_status = {"status_code": 500, "status_message": "该部门已绑定科室知识库"}

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.post(
            "/api/v1/admin/config/dept-knowledge-binding",
            json={"space_id": 10, "department_id": 3},
        )

    assert response.status_code == 502
    assert "已绑定" in response.json()["status_message"]


def test_get_bindable_spaces_forwards_keyword():
    fake = FakeBishengClient()

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        keyword_response = client.get(
            "/api/v1/admin/config/dept-knowledge-binding/bindable-spaces",
            params={"keyword": "研发"},
        )
        assert keyword_response.status_code == 200
        assert fake.bindable_params == {"keyword": "研发"}

        no_keyword_response = client.get(
            "/api/v1/admin/config/dept-knowledge-binding/bindable-spaces"
        )
        assert no_keyword_response.status_code == 200
        assert fake.bindable_params is None


def test_get_bindable_spaces_proxies_bisheng():
    fake = FakeBishengClient()
    fake.bindable_spaces = [{"space_id": 11, "name": "自由库X"}]

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/bindable-spaces")

    assert response.status_code == 200
    assert response.json()["data"][0]["space_id"] == 11


def test_get_dept_departments_proxies_bisheng():
    fake = FakeBishengClient()
    fake.departments = [{
        "id": 1,
        "name": "集团",
        "children": [{"id": 3, "name": "研发部", "children": []}],
    }]

    with TestClient(app) as client:
        client.app.state.bisheng_client = fake
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/departments")

    assert response.status_code == 200
    assert response.json()["data"][0]["children"][0]["id"] == 3


def test_get_dept_bindings_returns_502_when_bisheng_transport_fails():
    class FailingBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/department-binding/bindings":
                raise RuntimeError("dept binding endpoint unreachable")
            return await super().get_json(path, params=params)

    with TestClient(app) as client:
        client.app.state.bisheng_client = FailingBishengClient()
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/bindings")

    assert response.status_code == 502
    assert response.json()["status_message"] == "服务连接异常，请稍后重试"


def test_get_bindable_spaces_returns_502_when_bisheng_transport_fails():
    class FailingBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/department-binding/bindable-spaces":
                raise RuntimeError("dept binding endpoint unreachable")
            return await super().get_json(path, params=params)

    with TestClient(app) as client:
        client.app.state.bisheng_client = FailingBishengClient()
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/bindable-spaces")

    assert response.status_code == 502
    assert response.json()["status_message"] == "服务连接异常，请稍后重试"


def test_get_dept_departments_returns_502_when_bisheng_transport_fails():
    class FailingBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/department-binding/departments":
                raise RuntimeError("dept binding endpoint unreachable")
            return await super().get_json(path, params=params)

    with TestClient(app) as client:
        client.app.state.bisheng_client = FailingBishengClient()
        response = client.get("/api/v1/admin/config/dept-knowledge-binding/departments")

    assert response.status_code == 502
    assert response.json()["status_message"] == "服务连接异常，请稍后重试"


def test_post_dept_binding_returns_502_when_bisheng_transport_fails():
    class FailingBishengClient(FakeBishengClient):
        async def post_json(self, path: str, json=None):
            if path == "/api/v1/knowledge/space/department-binding":
                raise RuntimeError("dept binding endpoint unreachable")
            return await super().post_json(path, json=json)

    with TestClient(app) as client:
        client.app.state.bisheng_client = FailingBishengClient()
        response = client.post(
            "/api/v1/admin/config/dept-knowledge-binding",
            json={"space_id": 10, "department_id": 3},
        )

    assert response.status_code == 502
    assert response.json()["status_message"] == "服务连接异常，请稍后重试"


def test_delete_dept_binding_returns_502_when_bisheng_transport_fails():
    class FailingBishengClient(FakeBishengClient):
        async def delete_json(self, path: str, json=None):
            raise RuntimeError("dept binding endpoint unreachable")

    with TestClient(app) as client:
        client.app.state.bisheng_client = FailingBishengClient()
        response = client.delete("/api/v1/admin/config/dept-knowledge-binding/10")

    assert response.status_code == 502
    assert response.json()["status_message"] == "服务连接异常，请稍后重试"
