from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.knowledge_service import KnowledgeService
from app.services.portal_auth_service import PortalAuthError
from app.services.portal_config_service import PortalConfigService


class DepartmentFileViewBishengClient:
    def __init__(self):
        self.get_calls: list[tuple[str, dict | None]] = []
        self.post_calls: list[tuple[str, dict | None]] = []

    async def get_json(self, path: str, params=None, headers=None):
        self.get_calls.append((path, params))
        if path == "/api/v1/knowledge/shougang-portal/spaces":
            spaces = [{"id": 1, "name": "公共库", "space_level": "public"}]
            if params == {"discovery_scope": "public_and_department"}:
                spaces.append(
                    {"id": 2, "name": "设备部知识库", "space_level": "department"}
                )
            return {"status_code": 200, "data": {"spaces": spaces}}
        if path == "/api/v1/knowledge/space/grouped":
            return {"status_code": 200, "data": {}}
        if path == "/api/v1/approval/department-file-view/status":
            return {
                "status_code": 200,
                "data": {
                    "space_id": params["space_id"],
                    "file_id": params["file_id"],
                    "status": "approval_required",
                    "content_access": "approval_required",
                    "access_source": None,
                    "can_download": True,
                    "instance_id": None,
                    "latest_instance_status": None,
                    "safe_metadata": {
                        "id": params["file_id"],
                        "space_id": params["space_id"],
                        "title": "设备点检标准",
                    },
                },
            }
        raise AssertionError(f"Unexpected GET path: {path}")

    async def post_json(self, path: str, json=None, headers=None):
        self.post_calls.append((path, json))
        if path == "/api/v1/knowledge/shougang-portal/files/browse":
            return {
                "status_code": 200,
                "data": {"data": [], "has_more": False, "next_cursor": None},
            }
        if path == "/api/v1/approval/department-file-view/apply":
            return {
                "status_code": 200,
                "data": {
                    "status": "pending",
                    "space_id": json["space_id"],
                    "file_id": json["file_id"],
                    "instance_id": 99,
                    "latest_instance_status": "pending",
                    "task_ids": [100],
                    "can_download": False,
                },
            }
        raise AssertionError(f"Unexpected POST path: {path}")

    async def aclose(self):
        return None


class LoggedInPortalAuthService:
    def __init__(self, client):
        self.client = client
        self.session = type("PortalSession", (), {"session_id": "session-1"})()

    def get_session(self, _request):
        return self.session

    def require_session(self, _request):
        return self.session

    def create_bisheng_client(self, _session):
        return self.client


class AnonymousPortalAuthService(LoggedInPortalAuthService):
    def get_session(self, _request):
        return None

    def require_session(self, _request):
        raise PortalAuthError("请先登录", status_code=401)


def _configure_client(
    client: TestClient,
    *,
    tmp_path: Path,
    bisheng_client: DepartmentFileViewBishengClient,
    auth_service,
) -> None:
    client.app.state.portal_config_service = PortalConfigService(
        config_path=tmp_path / "portal_config.json"
    )
    client.app.state.bisheng_client = bisheng_client
    client.app.state.portal_auth_service = auth_service


def test_portal_discovery_scope_is_explicit_for_anonymous_and_logged_in(
    tmp_path: Path,
):
    anonymous_bisheng = DepartmentFileViewBishengClient()
    with TestClient(app) as client:
        previous_auth = client.app.state.portal_auth_service
        _configure_client(
            client,
            tmp_path=tmp_path,
            bisheng_client=anonymous_bisheng,
            auth_service=AnonymousPortalAuthService(anonymous_bisheng),
        )
        try:
            anonymous_response = client.get("/api/v1/knowledge/files/browse")
        finally:
            client.app.state.portal_auth_service = previous_auth

    assert anonymous_response.status_code == 200
    _, anonymous_payload = anonymous_bisheng.post_calls[-1]
    assert anonymous_payload["discovery_scope"] == "public"
    assert anonymous_payload["space_ids"] == []

    logged_in_bisheng = DepartmentFileViewBishengClient()
    with TestClient(app) as client:
        previous_auth = client.app.state.portal_auth_service
        _configure_client(
            client,
            tmp_path=tmp_path,
            bisheng_client=logged_in_bisheng,
            auth_service=LoggedInPortalAuthService(logged_in_bisheng),
        )
        try:
            logged_in_response = client.get("/api/v1/knowledge/files/browse")
        finally:
            client.app.state.portal_auth_service = previous_auth

    assert logged_in_response.status_code == 200
    _, logged_in_payload = logged_in_bisheng.post_calls[-1]
    assert logged_in_payload["discovery_scope"] == "public_and_department"
    assert logged_in_payload["space_ids"] == [1, 2]


def test_department_file_view_status_and_apply_use_session_bound_ids(
    tmp_path: Path,
):
    bisheng = DepartmentFileViewBishengClient()
    with TestClient(app) as client:
        previous_auth = client.app.state.portal_auth_service
        _configure_client(
            client,
            tmp_path=tmp_path,
            bisheng_client=bisheng,
            auth_service=LoggedInPortalAuthService(bisheng),
        )
        try:
            status_response = client.get(
                "/api/v1/knowledge/space/2/files/21/view-access"
            )
            apply_response = client.post(
                "/api/v1/knowledge/space/2/files/21/view-requests",
                json={"reason": "  项目工作需要  ", "space_id": 999, "file_id": 999},
            )
        finally:
            client.app.state.portal_auth_service = previous_auth

    assert status_response.status_code == 200
    assert status_response.json()["data"]["status"] == "approval_required"
    assert bisheng.get_calls[-1] == (
        "/api/v1/approval/department-file-view/status",
        {"space_id": 2, "file_id": 21},
    )
    assert apply_response.status_code == 200
    assert apply_response.json()["data"]["instance_id"] == 99
    assert bisheng.post_calls[-1] == (
        "/api/v1/approval/department-file-view/apply",
        {"space_id": 2, "file_id": 21, "reason": "项目工作需要"},
    )


def test_department_file_view_status_requires_login(tmp_path: Path):
    bisheng = DepartmentFileViewBishengClient()
    with TestClient(app) as client:
        previous_auth = client.app.state.portal_auth_service
        _configure_client(
            client,
            tmp_path=tmp_path,
            bisheng_client=bisheng,
            auth_service=AnonymousPortalAuthService(bisheng),
        )
        try:
            response = client.get(
                "/api/v1/knowledge/space/2/files/21/view-access"
            )
        finally:
            client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 401
    assert bisheng.get_calls == []


def test_department_file_view_request_rejects_blank_reason_before_upstream(
    tmp_path: Path,
):
    bisheng = DepartmentFileViewBishengClient()
    with TestClient(app) as client:
        previous_auth = client.app.state.portal_auth_service
        _configure_client(
            client,
            tmp_path=tmp_path,
            bisheng_client=bisheng,
            auth_service=LoggedInPortalAuthService(bisheng),
        )
        try:
            response = client.post(
                "/api/v1/knowledge/space/2/files/21/view-requests",
                json={"reason": "   "},
            )
        finally:
            client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 422
    assert bisheng.post_calls == []


def test_bff_redacts_unauthorized_department_content_even_if_upstream_leaks():
    items = KnowledgeService._map_shougang_portal_response_items(
        [
            {
                "id": 21,
                "space_id": 2,
                "title": "设备点检标准",
                "summary": "不应进入 BFF 的摘要",
                "source": "设备部知识库",
                "file_ext": "pdf",
                "file_size": "1MB",
                "file_encoding": "SECRET-001",
                "folder_path": "制度/点检",
                "source_path": "minio/internal/secret.pdf",
                "content_access": "approval_required",
                "is_department_file": True,
                "can_download": True,
            }
        ]
    )

    assert len(items) == 1
    item = items[0]
    assert item.title == "设备点检标准"
    assert item.folder_path == "制度/点检"
    assert item.summary == ""
    assert item.file_size == ""
    assert item.file_encoding == ""
    assert item.source_path == ""
    assert item.content_access == "approval_required"
    assert item.can_download is True
