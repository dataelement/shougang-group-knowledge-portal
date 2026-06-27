from pathlib import Path

from fastapi.testclient import TestClient

import pytest
from app.api.dependencies import require_admin_session
from app.main import app
from app.services.portal_config_service import PortalConfigService
from tests.test_admin_config_api import create_runtime_service, make_admin_session


class WorkflowBishengClient:
    def __init__(self):
        self.calls: list[tuple[str, dict | None]] = []

    async def get_json(self, path: str, params=None):
        self.calls.append((path, params))
        if path == "/api/v1/workflow/list":
            return {
                "data": {
                    "data": [
                        {
                            "id": "wf-1",
                            "name": "制度专家",
                            "description": "制度问答 workflow",
                            "flow_type": 10,
                            "status": 2,
                        }
                    ],
                    "has_more": False,
                    "next_cursor": "",
                }
            }
        raise AssertionError(f"Unexpected path: {path}")

    async def aclose(self):
        return None


class FailingWorkflowBishengClient:
    async def get_json(self, path: str, params=None):
        raise RuntimeError("upstream secret stack")

    async def aclose(self):
        return None


@pytest.fixture(autouse=True)
def allow_admin_access_by_default():
    app.dependency_overrides[require_admin_session] = make_admin_session
    yield
    app.dependency_overrides.pop(require_admin_session, None)


def setup_client(tmp_path: Path, bisheng_client=None):
    app.state.portal_config_service = PortalConfigService(
        tmp_path / "portal_config.json",
        database_path=tmp_path / "portal.sqlite3",
    )
    app.state.bisheng_runtime_service = create_runtime_service(tmp_path)
    app.state.bisheng_client = bisheng_client or WorkflowBishengClient()
    return TestClient(app), app.state.bisheng_client


def test_agent_config_defaults_are_returned_for_old_configs(tmp_path):
    client, _ = setup_client(tmp_path)

    response = client.get("/api/v1/admin/config")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["agent_config"] == {"categories": [], "agents": []}


def test_agent_config_can_be_saved_and_reloaded(tmp_path):
    client, _ = setup_client(tmp_path)
    payload = {
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

    post_response = client.post("/api/v1/admin/config/agent-config", json=payload)
    get_response = client.get("/api/v1/admin/config/agent-config")

    assert post_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["data"]["agents"][0]["workflow_id"] == "wf-1"


def test_agent_config_rejects_duplicate_workflows_and_invalid_categories(tmp_path):
    client, _ = setup_client(tmp_path)
    payload = {
        "categories": [{"id": "qa", "name": "AI问答", "enabled": True}],
        "agents": [
            {
                "id": "policy",
                "workflow_id": "wf-1",
                "name": "制度专家",
                "desc": "",
                "category_id": "qa",
                "tags": [],
                "icon": "BookOpen",
                "color": "#0f766e",
                "bg": "#ccfbf1",
                "enabled": True,
            },
            {
                "id": "policy-copy",
                "workflow_id": "wf-1",
                "name": "制度专家副本",
                "desc": "",
                "category_id": "missing",
                "tags": [],
                "icon": "BookOpen",
                "color": "#0f766e",
                "bg": "#ccfbf1",
                "enabled": True,
            },
        ],
    }

    response = client.post("/api/v1/admin/config/agent-config", json=payload)

    assert response.status_code == 422


def test_workflow_options_use_published_workflow_filters(tmp_path):
    workflow_client = WorkflowBishengClient()
    client, _ = setup_client(tmp_path, workflow_client)

    response = client.get("/api/v1/admin/config/agent-config/workflow-options?keyword=制度&page_size=20&cursor=abc")

    assert response.status_code == 200
    assert workflow_client.calls == [
        (
            "/api/v1/workflow/list",
            {
                "page_size": 20,
                "flow_type": 10,
                "status": 2,
                "permission_id": "use_app",
                "name": "制度",
                "cursor": "abc",
            },
        )
    ]
    data = response.json()["data"]
    assert data["workflows"][0]["workflow_id"] == "wf-1"
    assert data["workflows"][0]["name"] == "制度专家"


def test_workflow_options_surface_upstream_failure_without_internal_detail(tmp_path):
    client, _ = setup_client(tmp_path, FailingWorkflowBishengClient())

    response = client.get("/api/v1/admin/config/agent-config/workflow-options")

    assert response.status_code == 502
    body = response.json()
    assert body["status_code"] == 502
    assert "workflow 候选项加载失败" in body["status_message"]
    assert "upstream secret stack" not in body["status_message"]
