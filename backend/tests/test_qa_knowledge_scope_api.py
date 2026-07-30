from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.portal_config_service import PortalConfigService
from test_knowledge_api import (
    FakeBishengClient,
    FakePortalAuthService,
    NoSessionPortalAuthService,
    _seed_anonymous_qa_spaces,
)


class QaScopeBishengClient(FakeBishengClient):
    def __init__(self):
        super().__init__()
        self.get_calls = []

    async def get_json(self, path: str, params=None, headers=None):
        self.get_calls.append((path, params or {}))
        if path == "/api/v1/knowledge/space/grouped":
            response = await super().get_json(path, params=params, headers=headers)
            response["data"]["department_spaces"] = []
            return response
        if path == "/api/v1/knowledge/shougang-portal/spaces":
            assert params == {"discovery_scope": "public_and_department"}
            return {
                "data": {
                    "spaces": [
                        {
                            "id": 7101,
                            "name": "公开问答库",
                            "space_level": "public",
                        },
                        {
                            "id": 7103,
                            "name": "部门问答库",
                            "space_level": "department",
                        },
                    ]
                }
            }
        if path == "/api/v1/knowledge/space/7101/children":
            assert params.get("file_status") == [2]
            assert params.get("enrich_files") is False
            assert params.get("folder_count_mode") == "shallow"
            if params.get("cursor") == "CUR7101P2":
                return {"data": {"data": [
                    {"id": 9002, "knowledge_id": 7101, "file_name": "第二页.pdf",
                     "file_type": 1, "status": 2, "file_level_path": ""},
                ], "page_size": 10, "has_more": False, "next_cursor": None}}
            if params.get("parent_id") == 3001:
                return {
                    "data": {
                        "data": [
                            {
                                "id": 91001,
                                "knowledge_id": 7101,
                                "file_name": "Git工作流.md",
                                "file_type": 1,
                                "status": 2,
                                "file_level_path": "/3001",
                                "summary": "Git 工作流",
                                "file_encoding": "DEV-GIT-001",
                                "tags": [],
                            }
                        ],
                        "page_size": 10,
                        "has_more": False,
                        "next_cursor": None,
                    }
                }
            return {"data": {"data": [
                {"id": 3001, "knowledge_id": 7101, "file_name": "团队规范", "file_type": 0,
                 "status": 2, "file_level_path": "", "visible_success_file_num": 1,
                 "has_children": True},
                {"id": 9001, "knowledge_id": 7101, "file_name": "开发流程文档.pdf",
                 "file_type": 1, "status": 2, "file_level_path": "", "file_ext": "pdf",
                 "summary": "开发流程", "file_encoding": "DEV-PROC-001", "tags": []},
            ], "page_size": 10, "has_more": True, "next_cursor": "CUR7101P2"}}
        if path == "/api/v1/knowledge/space/7103/children":
            return {"status_code": 18040, "status_message": "Permission denied"}
        if path == "/api/v1/knowledge/shougang-portal/qa/spaces/12/children":
            assert params.get("discovery_scope") == "public"
            return {
                "data": {
                    "data": [],
                    "page_size": 10,
                    "has_more": False,
                    "next_cursor": None,
                }
            }
        if path == "/api/v1/knowledge/space/7101/search":
            assert params.get("file_status") == [2]
            if params.get("parent_id") == 3001:
                return {
                    "data": {
                        "data": [
                            {
                                "id": 91001,
                                "knowledge_id": 7101,
                                "file_name": "Git工作流.md",
                                "file_type": 1,
                                "status": 2,
                                "file_level_path": "/3001",
                                "summary": "Git 工作流",
                                "file_encoding": "DEV-GIT-001",
                                "tags": [],
                            }
                        ],
                        "total": 1,
                        "page": 1,
                        "page_size": 100,
                    }
                }
            return {
                "data": {
                    "data": [
                        {
                            "id": 3001,
                            "knowledge_id": 7101,
                            "file_name": "团队规范",
                            "file_type": 0,
                            "status": 2,
                            "file_level_path": "",
                            "file_num": 2,
                            "success_file_num": 2,
                            "visible_success_file_num": 1,
                        },
                        {
                            "id": 9001,
                            "knowledge_id": 7101,
                            "file_name": "开发流程文档.pdf",
                            "file_type": 1,
                            "status": 2,
                            "file_level_path": "",
                            "summary": "开发流程",
                            "file_encoding": "DEV-PROC-001",
                            "tags": [],
                        },
                        {
                            "id": 91001,
                            "knowledge_id": 7101,
                            "file_name": "Git工作流.md",
                            "file_type": 1,
                            "status": 2,
                            "file_level_path": "/3001",
                            "summary": "Git 工作流",
                            "file_encoding": "DEV-GIT-001",
                            "tags": [],
                        },
                    ],
                    "total": 3,
                    "page": 1,
                    "page_size": 100,
                }
            }
        return await super().get_json(path, params=params, headers=headers)

    async def post_json(self, path: str, json=None, headers=None):
        if path == "/api/v1/knowledge/space/7101/folder-stats":
            assert json == {"folder_ids": [3001], "file_status": [2]}
            self.post_calls.append((path, json))
            return {
                "data": {
                    "stats": [
                        {
                            "folder_id": 3001,
                            "file_num": 12,
                            "success_file_num": 11,
                            "visible_success_file_num": 10,
                            "processing_file_num": 1,
                        }
                    ]
                }
            }
        if path == "/api/v1/knowledge/shougang-portal/qa/files/search":
            assert json["q"] == "流程"
            assert json["discovery_scope"] == "legacy"
            assert set(json["space_ids"]) == {12, 18, 25, 7101, 7102}
            assert json["page"] == 1
            assert json["page_size"] == 20
            self.post_calls.append((path, json))
            return {
                "data": {
                    "data": [
                        {
                            "id": 9001,
                            "space_id": 7101,
                            "title": "开发流程文档.pdf",
                            "summary": "开发流程",
                            "source": "冷轧设备故障复盘库",
                            "updated_at": "2026-06-17T09:00:00",
                            "tags": ["流程"],
                            "file_ext": "pdf",
                            "file_size": "1MB",
                            "file_encoding": "DEV-PROC-001",
                            "folder_path": "冷轧设备故障复盘库/团队规范",
                            "source_path": "冷轧设备故障复盘库>团队规范/开发流程文档.pdf",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "page_size": 20,
                }
            }
        return await super().post_json(path, json=json, headers=headers)


def _make_auth_client(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    user_bisheng = QaScopeBishengClient()
    data_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        previous_bisheng = getattr(client.app.state, "bisheng_client", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = data_bisheng
        client.app.state.portal_auth_service = FakePortalAuthService(user_bisheng)
        try:
            yield client, config_service, user_bisheng
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth
            if previous_bisheng is not None:
                client.app.state.bisheng_client = previous_bisheng


def test_qa_tree_spaces_and_children_use_current_user_visible_scope(tmp_path: Path):
    for client, _, fake_bisheng in _make_auth_client(tmp_path):
        spaces_response = client.get("/api/v1/knowledge/qa/tree/spaces")
        children_response = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children")
        nested_response = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children?parent_id=3001")

    assert spaces_response.status_code == 200
    spaces = spaces_response.json()["data"]["data"]
    assert {item["id"] for item in spaces} == {12, 18, 25, 7101, 7102}

    assert children_response.status_code == 200
    nodes = children_response.json()["data"]["data"]
    assert nodes[0]["type"] == "folder"
    assert nodes[0]["id"] == 3001
    assert nodes[0]["selectable"] is True
    assert nodes[0]["resolved_file_count"] == 1
    assert [node["id"] for node in nodes] == [3001, 9001]
    assert nodes[1]["type"] == "file"
    assert nodes[1]["file_ext"] == "pdf"

    assert nested_response.status_code == 200
    nested = nested_response.json()["data"]["data"]
    assert nested[0]["id"] == 91001
    assert all(
        path.endswith("/children")
        for path, _ in fake_bisheng.get_calls
        if path == "/api/v1/knowledge/space/7101/children"
    )
    assert fake_bisheng.chat_payload is None


def test_qa_file_search_uses_all_current_user_visible_spaces(tmp_path: Path):
    for client, _, fake_bisheng in _make_auth_client(tmp_path):
        response = client.get("/api/v1/knowledge/qa/files/search?q=%E6%B5%81%E7%A8%8B")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 1
    assert body["data"][0]["space_id"] == 7101
    assert body["data"][0]["folder_path"] == "冷轧设备故障复盘库/团队规范"
    assert fake_bisheng.post_calls[-1][0] == "/api/v1/knowledge/shougang-portal/qa/files/search"


def test_qa_unreadable_department_space_is_not_listed_and_cannot_be_browsed(
    tmp_path: Path,
):
    for client, _, _ in _make_auth_client(tmp_path):
        spaces_response = client.get("/api/v1/knowledge/qa/tree/spaces")
        children_response = client.get(
            "/api/v1/knowledge/qa/tree/spaces/7103/children"
        )

    assert 7103 not in {
        item["id"] for item in spaces_response.json()["data"]["data"]
    }
    assert children_response.status_code == 403
    assert children_response.json()["detail"] == "包含无权限或不存在的知识库"


def test_qa_tree_anonymous_scope_is_limited_to_public_bisheng_spaces(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_anonymous_qa_spaces(config_service)
    system_bisheng = QaScopeBishengClient()

    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        previous_bisheng = getattr(client.app.state, "bisheng_client", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = system_bisheng
        client.app.state.portal_auth_service = NoSessionPortalAuthService(FakeBishengClient())
        try:
            spaces_response = client.get("/api/v1/knowledge/qa/tree/spaces")
            public_children_response = client.get(
                "/api/v1/knowledge/qa/tree/spaces/12/children"
            )
            forbidden_response = client.get("/api/v1/knowledge/qa/tree/spaces/7103/children")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth
            if previous_bisheng is not None:
                client.app.state.bisheng_client = previous_bisheng

    assert spaces_response.status_code == 200
    assert {item["id"] for item in spaces_response.json()["data"]["data"]} == {12, 18, 25}
    assert public_children_response.status_code == 200
    assert public_children_response.json()["data"]["data"] == []
    assert forbidden_response.status_code == 403
    assert "公共" in forbidden_response.json()["detail"]


def test_chat_scope_rejects_second_whole_space_with_exact_prompt(tmp_path: Path):
    for client, config_service, _ in _make_auth_client(tmp_path):
        config_service.update_qa(config_service.get_config().qa.model_copy(update={"general_model": "10"}))
        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-06-17T10:00:00",
                "model": "",
                "scene": "qa",
                "text": "整库范围只能选一个",
                "use_knowledge_base": {
                    "knowledge_space_ids": [7101, 7102],
                    "knowledge_scope": {
                        "mode": "knowledge_space",
                        "knowledge_space_id": 7101,
                    },
                },
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "一次最多可选择1个库进行问答。"


def test_chat_scope_forwards_cross_space_file_refs(tmp_path: Path):
    for client, config_service, fake_bisheng in _make_auth_client(tmp_path):
        config_service.update_qa(config_service.get_config().qa.model_copy(update={"general_model": "10"}))
        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-06-17T10:00:00",
                "model": "",
                "scene": "qa",
                "text": "跨库文件问答",
                "use_knowledge_base": {
                    "knowledge_space_ids": [7102, 7101],
                    "knowledge_scope": {
                        "mode": "files",
                        "folder_refs": [{"knowledge_space_id": 7101, "folder_id": 3001}],
                            "file_refs": [{"knowledge_space_id": 7102, "file_id": 9201}],
                    },
                },
            },
        )

    assert response.status_code == 200
    forwarded = fake_bisheng.chat_payload["json"]["use_knowledge_base"]
    assert forwarded["knowledge_space_ids"] == [7101, 7102]
    assert forwarded["knowledge_scope"]["mode"] == "files"
    assert forwarded["knowledge_scope"]["folder_refs"] == [{"knowledge_space_id": 7101, "folder_id": 3001}]
    assert forwarded["knowledge_scope"]["file_refs"] == [
        {"knowledge_space_id": 7102, "file_id": 9201}
    ]


def test_chat_scope_rejects_unreadable_workbench_space(tmp_path: Path):
    for client, config_service, fake_bisheng in _make_auth_client(tmp_path):
        config_service.update_qa(
            config_service.get_config().qa.model_copy(update={"general_model": "10"})
        )
        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-07-30T10:00:00",
                "model": "",
                "scene": "qa",
                "text": "构造无权知识库",
                "use_knowledge_base": {
                    "knowledge_space_ids": [7103],
                    "knowledge_scope": {
                        "mode": "files",
                        "folder_refs": [],
                        "file_refs": [
                            {"knowledge_space_id": 7103, "file_id": 9301}
                        ],
                    },
                },
            },
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "包含无权限或不存在的知识库"
    assert fake_bisheng.chat_payload is None


def test_chat_scope_rejects_obvious_file_limit_overflow(tmp_path: Path):
    refs = [{"knowledge_space_id": 7101, "file_id": idx} for idx in range(1, 22)]
    for client, config_service, _ in _make_auth_client(tmp_path):
        config_service.update_qa(config_service.get_config().qa.model_copy(update={"general_model": "10"}))
        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-06-17T10:00:00",
                "model": "",
                "scene": "qa",
                "text": "文件数超限",
                "use_knowledge_base": {
                    "knowledge_space_ids": [7101],
                    "knowledge_scope": {
                        "mode": "files",
                        "folder_refs": [],
                        "file_refs": refs,
                    },
                },
            },
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "一次最多可选择20个文件进行问答。"


class QaForbiddenBishengClient(QaScopeBishengClient):
    """对 7199/children 返回上游权限拒绝码(HTTP 200 + body status_code)。"""

    async def get_json(self, path: str, params=None, headers=None):
        self.get_calls.append((path, params or {}))
        if path == "/api/v1/knowledge/space/7199/children":
            return {"status_code": 18040, "status_message": "Permission denied"}
        return await super().get_json(path, params=params, headers=headers)


def _make_forbidden_client(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    user_bisheng = QaForbiddenBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        previous_bisheng = getattr(client.app.state, "bisheng_client", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = FakeBishengClient()
        client.app.state.portal_auth_service = FakePortalAuthService(user_bisheng)
        try:
            yield client, user_bisheng
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth
            if previous_bisheng is not None:
                client.app.state.bisheng_client = previous_bisheng


def test_qa_tree_children_translates_upstream_permission_error_to_403(tmp_path: Path):
    for client, user_bisheng in _make_forbidden_client(tmp_path):
        resp = client.get("/api/v1/knowledge/qa/tree/spaces/7199/children")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "包含无权限或不存在的知识库"
    # 证明走的是"信任上游"路径:上游 /children 确实被调用(而非旧预检拦截)
    assert any(
        path
        == "/api/v1/knowledge/space/7199/children"
        for path, _ in user_bisheng.get_calls
    )


def test_qa_tree_children_passes_enrich_files_false_and_fixes_paging(tmp_path: Path):
    for client, _config_service, fake_bisheng in _make_auth_client(tmp_path):
        resp = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children")
    assert resp.status_code == 200
    body = resp.json()["data"]
    # 分页字段:游标分页,has_more/next_cursor/page_size 透传上游
    assert len(body["data"]) == 2
    assert body["has_more"] is True
    assert body["next_cursor"] == "CUR7101P2"
    assert body["page_size"] == 10
    # 向上游传了 enrich_files=False(省富化)
    children_calls = [
        p
        for p in fake_bisheng.get_calls
        if p[0]
        == "/api/v1/knowledge/space/7101/children"
    ]
    assert children_calls, "未调用上游 children"
    assert children_calls[0][1].get("file_status") == [2]
    assert children_calls[0][1].get("enrich_files") is False
    assert children_calls[0][1].get("folder_count_mode") == "shallow"


def test_qa_tree_children_uses_cursor_pagination_and_shallow_counts(tmp_path: Path):
    for client, _c, fake_bisheng in _make_auth_client(tmp_path):
        first = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children")
        second = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children?cursor=CUR7101P2")
    assert first.status_code == 200
    body = first.json()["data"]
    assert body["has_more"] is True
    assert body["next_cursor"] == "CUR7101P2"
    assert body["page_size"] == 10
    assert "total" not in body and "page" not in body
    # 上游收到 shallow 模式 + page_size
    call = next(
        p
        for p in fake_bisheng.get_calls
        if p[0]
        == "/api/v1/knowledge/space/7101/children"
    )
    assert call[1].get("page_size") == 10
    # 第二页透传 cursor
    assert second.json()["data"]["data"][0]["id"] == 9002
    assert any(p[1].get("cursor") == "CUR7101P2"
               for p in fake_bisheng.get_calls
               if p[0] == "/api/v1/knowledge/space/7101/children")


def test_qa_tree_children_has_children_decoupled_from_count(tmp_path: Path):
    for client, _c, _b in _make_auth_client(tmp_path):
        body = client.get("/api/v1/knowledge/qa/tree/spaces/7101/children").json()["data"]
    folder = next(n for n in body["data"] if n["type"] == "folder")
    # 该文件夹 visible_success_file_num=1 且显式 has_children=True → 节点可展开
    assert folder["has_children"] is True
    assert folder["resolved_file_count"] == 1


def test_qa_tree_folder_stats_returns_deep_visible_success_count(tmp_path: Path):
    for client, _c, fake_bisheng in _make_auth_client(tmp_path):
        response = client.post(
            "/api/v1/knowledge/qa/tree/spaces/7101/folder-stats",
            json={"folder_ids": [3001]},
        )

    assert response.status_code == 200
    assert response.json()["data"]["stats"] == [
        {"folder_id": 3001, "resolved_file_count": 10}
    ]
    assert fake_bisheng.post_calls[-1] == (
        (
            "/api/v1/knowledge/space/7101/folder-stats"
        ),
        {"folder_ids": [3001], "file_status": [2]},
    )
