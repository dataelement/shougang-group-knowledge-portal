from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.portal_config import SpacesConfigUpdate
from app.services.portal_config_service import PortalConfigService


def _seed_test_spaces(service: PortalConfigService) -> None:
    """Inject the space ids most knowledge-route tests rely on (12 / 18 / 25)."""
    service.update_spaces(
        SpacesConfigUpdate(
            spaces=[
                {
                    "id": 12,
                    "name": "轧线技术案例库",
                    "file_count": 0,
                    "tag_count": 0,
                    "space_level": "department",
                    "enabled": True,
                },
                {
                    "id": 18,
                    "name": "冷轧技术手册",
                    "file_count": 0,
                    "tag_count": 0,
                    "space_level": "department",
                    "enabled": True,
                },
                {
                    "id": 25,
                    "name": "设备维修规范",
                    "file_count": 0,
                    "tag_count": 0,
                    "space_level": "department",
                    "enabled": True,
                },
            ]
        )
    )


class FakeBishengClient:
    def __init__(self):
        self.chat_payload = None
        self.preview_asset_requests = []
        self.post_calls = []

    def resolve_url(self, path_or_url: str) -> str:
        return path_or_url

    def resolve_asset_url(self, path_or_url: str) -> str:
        return path_or_url

    async def get(self, path: str, params=None):
        if path == "https://example.com/preview/1580.pdf":
            return httpx.Response(
                200,
                headers={"content-type": "application/pdf"},
                content=b"%PDF-preview-1580",
            )
        if path == "https://example.com/original/1580.pdf":
            return httpx.Response(
                200,
                headers={"content-type": "application/pdf"},
                content=b"%PDF-original-1580",
            )
        raise AssertionError(f"Unexpected download path: {path}")

    async def get_preview_asset(self, path: str, params=None):
        self.preview_asset_requests.append({"path": path, "params": params})
        return await self.get(path, params=params)

    async def get_json(self, path: str, params=None):
        params = params or {}
        if path == "/api/v1/knowledge/space/12/search":
            keyword = params.get("keyword")
            if keyword == "振动纹":
                return {
                    "data": {
                        "data": [
                            {
                                "id": 1580,
                                "knowledge_id": 12,
                                "file_name": "热轧1580产线精轧机振动纹治理实践.pdf",
                                "abstract": "振动纹治理实践摘要",
                                "file_type": 1,
                                "status": 2,
                                "file_size": "949.33KB",
                                "file_encoding": "GF-ZD-SC-202604-01201",
                                "update_time": "2026-04-13T10:30:00",
                                "tags": [{"id": 101, "name": "热轧"}, {"id": 103, "name": "振动纹"}],
                            }
                        ],
                        "total": 1,
                    }
                }
            return {
                "data": {
                    "data": [
                        {
                            "id": 1580,
                            "knowledge_id": 12,
                            "file_name": "热轧1580产线精轧机振动纹治理实践.pdf",
                            "abstract": "振动纹治理实践摘要",
                            "file_type": 1,
                            "status": 2,
                            "file_size": "949.33KB",
                            "file_encoding": "GF-ZD-SC-202604-01201",
                            "update_time": "2026-04-13T10:30:00",
                            "tags": [{"id": 101, "name": "热轧"}, {"id": 103, "name": "振动纹"}],
                        },
                        {
                            "id": 1590,
                            "knowledge_id": 12,
                            "file_name": "热轧加热炉温度控制.docx",
                            "abstract": "温度控制摘要",
                            "file_type": 1,
                            "status": 2,
                            "file_size": 2432696,
                            "file_encoding": "GF-ZD-SC-202604-01193",
                            "update_time": "2026-04-10T08:00:00",
                            "tags": [{"id": 101, "name": "热轧"}],
                        },
                    ],
                    "total": 2,
                }
            }
        if path == "/api/v1/knowledge/space/18/search":
            return {
                "data": {
                    "data": [
                        {
                            "id": 1801,
                            "knowledge_id": 18,
                            "file_name": "冷轧板面缺陷处理.pdf",
                            "abstract": "板面缺陷摘要",
                            "file_type": 1,
                            "status": 2,
                            "file_size": "1.17MB",
                            "file_encoding": "GF-ZD-LZ-202604-01185",
                            "update_time": "2026-04-11T09:00:00",
                            "tags": [{"id": 205, "name": "板面缺陷"}],
                        }
                    ],
                    "total": 1,
                }
            }
        if path == "/api/v1/knowledge/space/12/tag":
            return {"data": [{"id": 101, "name": "热轧"}, {"id": 103, "name": "振动纹"}]}
        if path == "/api/v1/knowledge/space/18/tag":
            return {"data": [{"id": 205, "name": "板面缺陷"}]}
        if path == "/api/v1/knowledge/file/info/1580":
            return {
                "data": {
                    "id": 1580,
                    "knowledge_id": 12,
                    "file_name": "热轧1580产线精轧机振动纹治理实践.pdf",
                    "abstract": "振动纹治理实践摘要",
                    "update_time": "2026-04-13T10:30:00",
                }
            }
        if path == "/api/v1/knowledge/space/12/files/1580/preview":
            return {
                "data": {
                    "original_url": "https://example.com/original/1580.pdf",
                    "preview_url": "https://example.com/preview/1580.pdf",
                }
            }
        if path == "/api/v1/knowledge/chunk":
            assert params == {"knowledge_id": 12, "file_ids": [1580], "page": 1, "limit": 100}
            return {
                "data": {
                    "data": [
                        {
                            "text": "第一段内容",
                            "metadata": {"chunk_index": 1},
                        },
                        {
                            "text": "第二段内容",
                            "metadata": {"chunk_index": 2},
                        },
                    ],
                    "total": 2,
                }
            }
        if path == "/api/v1/knowledge/space/mine":
            return {
                "status_code": 200,
                "data": [
                    {
                        "id": 7101,
                        "name": "冷轧设备故障复盘库",
                        "description": "沉淀冷轧产线设备异常。",
                        "auth_type": "private",
                        "file_count": 38,
                        "member_count": 6,
                        "is_pinned": True,
                        "update_time": "2026-04-26T09:20:00",
                    },
                    {
                        "id": 7105,
                        "name": "公开制度库",
                        "auth_type": "public",
                        "file_count": 12,
                        "update_time": "2026-04-20T09:20:00",
                    },
                ],
            }
        if path == "/api/v1/knowledge/space/joined":
            return {
                "status_code": 200,
                "data": {
                    "data": [
                        {
                            "knowledge_id": 7102,
                            "knowledge_name": "质量异议处置工作组",
                            "role": "admin",
                            "file_num": 24,
                            "update_time": "2026-04-24T16:45:00",
                        }
                    ],
                    "total": 1,
                },
            }
        if path == "/api/v1/knowledge/space/department":
            return {
                "status_code": 200,
                "data": [
                    {
                        "id": 7103,
                        "name": "设备管理部内部知识空间",
                        "department_name": "设备管理部",
                        "file_count": 57,
                        "update_time": "2026-04-22T11:10:00",
                    }
                ],
            }
        if path == "/api/v1/knowledge/space/managed":
            return {
                "status_code": 200,
                "data": [
                    {
                        "id": 7102,
                        "name": "质量异议处置工作组",
                        "role": "admin",
                        "file_count": 25,
                        "update_time": "2026-04-24T17:00:00",
                    }
                ],
            }
        if path == "/api/v1/knowledge/shougang-portal/personal-spaces":
            return {
                "status_code": 200,
                "data": {
                    "data": [
                        {
                            "id": 7201,
                            "name": "个人沉淀库",
                            "description": "个人知识空间",
                            "file_count": 3,
                            "updated_at": "2026-05-15T09:30:00",
                        }
                    ],
                    "total": 1,
                },
            }
        if path == "/api/v1/knowledge/shougang-portal/share-links/share-token-1580":
            return {
                "status_code": 200,
                "data": {
                    "share_token": "share-token-1580",
                    "file_name": "热轧1580产线精轧机振动纹治理实践",
                    "share_type": "invite_code",
                    "visibility": "public",
                    "permissions": {"view": True, "download": False, "upload": False},
                    "requires_password": True,
                    "requires_invite_code": True,
                    "expired": False,
                },
            }
        raise AssertionError(f"Unexpected path: {path}")

    async def post_json(self, path: str, json=None):
        self.post_calls.append((path, json))
        if path == "/api/v1/knowledge/shougang-portal/files/search":
            assert json == {
                "q": "振动纹",
                "tag": None,
                "space_ids": [12, 18, 25],
                "space_level": "department",
                "file_ext": "pdf",
                "sort": "updated_at",
                "page": 1,
                "page_size": 20,
            }
            return {
                "data": {
                    "data": [
                        {
                            "id": 1580,
                            "space_id": 12,
                            "title": "热轧1580产线精轧机振动纹治理实践",
                            "summary": "振动纹治理实践摘要",
                            "source": "轧线技术案例库",
                            "updated_at": "2026-04-13T10:30:00",
                            "tags": ["热轧", "振动纹"],
                            "file_ext": "pdf",
                            "file_size": "949.33KB",
                            "file_encoding": "GF-ZD-SC-202604-01201",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "page_size": 20,
                }
            }
        if path == "/api/v1/knowledge/shougang-portal/favorites":
            assert json == {
                "source_space_id": 12,
                "source_file_id": 1580,
                "target_space_id": 7201,
            }
            return {
                "status_code": 200,
                "data": {
                    "file_id": 9301,
                    "space_id": 7201,
                    "title": "热轧1580产线精轧机振动纹治理实践",
                },
            }
        if path == "/api/v1/knowledge/shougang-portal/share-links":
            assert json == {
                "space_id": 12,
                "file_id": 1580,
                "share_type": "invite_code",
                "visibility": "public",
                "allow_download": False,
                "password": "secret",
                "expire_seconds": 3600,
            }
            return {
                "status_code": 200,
                "data": {
                    "share_token": "share-token-1580",
                    "link": "/share/document/share-token-1580",
                    "invite_code": "ABC123",
                    "expire_seconds": 3600,
                },
            }
        if path == "/api/v1/knowledge/shougang-portal/share-links/share-token-1580/verify":
            assert json == {"password": "secret", "invite_code": "ABC123"}
            return {
                "status_code": 200,
                "data": {
                    "share_token": "share-token-1580",
                    "space_id": 12,
                    "file_id": 1580,
                    "allow_download": False,
                },
            }
        raise AssertionError(f"Unexpected post path: {path}")

    async def stream_post(self, path: str, json=None):
        self.chat_payload = {"path": path, "json": json}
        yield b"event: message\n"
        yield b"data: {\"ok\":true}\n\n"

    async def aclose(self):
        return None


def make_client(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        yield client, config_service, fake_bisheng


class FakePortalAuthService:
    def __init__(self, client):
        self._client = client

    def get_session(self, _request):
        return object()

    def require_session(self, _request):
        return object()

    def create_bisheng_client(self, _session):
        return self._client


class NoSessionPortalAuthService(FakePortalAuthService):
    def get_session(self, _request):
        return None


def test_list_visible_spaces_aggregates_user_scoped_bisheng_lists(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            response = client.get("/api/v1/knowledge/spaces")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 4
    assert body["data"][0]["id"] == 7101
    joined = next(item for item in body["data"] if item["id"] == 7102)
    assert joined["file_count"] == 25
    assert joined["sources"] == ["joined", "managed"]
    public_space = next(item for item in body["data"] if item["id"] == 7105)
    assert public_space["auth_type"] == "public"


def test_list_personal_spaces_uses_current_user_bisheng_session(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            response = client.get("/api/v1/knowledge/personal-spaces")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 1
    assert body["data"][0]["id"] == 7201


def test_create_favorite_uses_current_user_bisheng_session(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            response = client.post(
                "/api/v1/knowledge/favorites",
                json={
                    "source_space_id": 12,
                    "source_file_id": 1580,
                    "target_space_id": 7201,
                },
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 200
    assert response.json()["data"]["file_id"] == 9301
    assert fake_bisheng.post_calls[-1] == (
        "/api/v1/knowledge/shougang-portal/favorites",
        {
            "source_space_id": 12,
            "source_file_id": 1580,
            "target_space_id": 7201,
        },
    )


def test_create_favorite_maps_duplicate_to_conflict(tmp_path: Path):
    class DuplicateFavoriteBishengClient(FakeBishengClient):
        async def post_json(self, path: str, json=None):
            if path == "/api/v1/knowledge/shougang-portal/favorites":
                return {
                    "status_code": 18021,
                    "status_message": "A file with the same name or content already exists in this space",
                    "data": {},
                }
            return await super().post_json(path, json=json)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = DuplicateFavoriteBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            response = client.post(
                "/api/v1/knowledge/favorites",
                json={
                    "source_space_id": 12,
                    "source_file_id": 1580,
                    "target_space_id": 7201,
                },
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 409
    assert response.json()["detail"] == "该文档已收藏到所选个人知识库"


def test_create_share_link_uses_current_user_bisheng_session(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            response = client.post(
                "/api/v1/knowledge/share-links",
                json={
                    "space_id": 12,
                    "file_id": 1580,
                    "share_type": "invite_code",
                    "visibility": "public",
                    "allow_download": False,
                    "password": "secret",
                    "expire_seconds": 3600,
                },
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 200
    assert response.json()["data"]["share_token"] == "share-token-1580"
    assert response.json()["data"]["invite_code"] == "ABC123"
    assert fake_bisheng.post_calls[-1] == (
        "/api/v1/knowledge/shougang-portal/share-links",
        {
            "space_id": 12,
            "file_id": 1580,
            "share_type": "invite_code",
            "visibility": "public",
            "allow_download": False,
            "password": "secret",
            "expire_seconds": 3600,
        },
    )


def test_share_access_session_controls_detail_and_preview_download(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = FakeBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        client.app.state.portal_auth_service = FakePortalAuthService(fake_bisheng)
        try:
            meta_response = client.get("/api/v1/knowledge/share-links/share-token-1580")
            access_response = client.post(
                "/api/v1/knowledge/share-links/share-token-1580/access",
                json={"password": "secret", "invite_code": "ABC123"},
            )
            detail_response = client.get("/api/v1/knowledge/space/12/files/1580?share_token=share-token-1580")
            preview_response = client.get("/api/v1/knowledge/space/12/files/1580/preview?share_token=share-token-1580")
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert meta_response.status_code == 200
    assert meta_response.json()["data"]["requires_invite_code"] is True
    assert access_response.status_code == 200
    assert access_response.json()["data"]["space_id"] == 12
    assert detail_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview_response.status_code == 200
    assert preview["download_url"] == ""
    assert "share_token=share-token-1580" in preview["viewer_url"]


def test_department_share_access_requires_portal_login_session(tmp_path: Path):
    class DepartmentShareBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/shougang-portal/share-links/share-token-1580":
                return {
                    "status_code": 200,
                    "data": {
                        "share_token": "share-token-1580",
                        "file_name": "热轧1580产线精轧机振动纹治理实践",
                        "share_type": "link",
                        "visibility": "department",
                        "permissions": {"view": True, "download": False, "upload": False},
                        "requires_password": False,
                        "requires_invite_code": False,
                        "expired": False,
                    },
                }
            return await super().get_json(path, params=params)

        async def post_json(self, path: str, json=None):
            if path == "/api/v1/knowledge/shougang-portal/share-links/share-token-1580/verify":
                raise AssertionError("department share must not be verified with the portal backend token")
            return await super().post_json(path, json=json)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    fake_bisheng = DepartmentShareBishengClient()
    with TestClient(app) as client:
        previous_auth = getattr(client.app.state, "portal_auth_service", None)
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        client.app.state.portal_auth_service = NoSessionPortalAuthService(fake_bisheng)
        try:
            response = client.post(
                "/api/v1/knowledge/share-links/share-token-1580/access",
                json={"password": "", "invite_code": ""},
            )
        finally:
            if previous_auth is not None:
                client.app.state.portal_auth_service = previous_auth

    assert response.status_code == 401
    assert response.json()["detail"] == "仅本部门分享需要登录后访问"


def test_list_space_files_maps_bisheng_results(tmp_path: Path):
    for client, _, _ in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/space/12/files?page=1&page_size=10")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 2
    assert body["data"][0]["space_id"] == 12
    assert body["data"][0]["title"] == "热轧1580产线精轧机振动纹治理实践"
    assert body["data"][0]["file_ext"] == "pdf"
    assert body["data"][0]["file_size"] == "949.33KB"
    assert body["data"][0]["file_encoding"] == "GF-ZD-SC-202604-01201"
    assert body["data"][1]["file_size"] == "2.32MB"


def test_get_file_detail_and_preview(tmp_path: Path):
    for client, _, _ in make_client(tmp_path):
        detail_response = client.get("/api/v1/knowledge/space/12/files/1580")
        preview_response = client.get("/api/v1/knowledge/space/12/files/1580/preview")

    assert detail_response.status_code == 200
    detail = detail_response.json()["data"]
    assert detail["space"]["id"] == 12
    assert detail["tags"] == ["热轧", "振动纹"]
    assert detail["file_size"] == "949.33KB"
    assert detail["file_encoding"] == "GF-ZD-SC-202604-01201"

    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["mode"] == "pdf"
    assert preview["source_kind"] == "preview_url"
    assert preview["download_url"] == "https://example.com/original/1580.pdf"
    assert preview["viewer_url"].endswith("source_kind=preview_url")


def test_get_file_preview_normalizes_relative_urls(tmp_path: Path):
    class RelativePreviewBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/12/files/1580/preview":
                return {
                    "data": {
                        "original_url": "/bisheng/original/1580.pdf?signature=demo",
                        "preview_url": "",
                    }
                }
            return await super().get_json(path, params=params)

        def resolve_asset_url(self, path_or_url: str) -> str:
            return f"https://bisheng.example.com{path_or_url}" if path_or_url.startswith("/") else path_or_url

        async def get(self, path: str, params=None):
            if path == "https://bisheng.example.com/bisheng/original/1580.pdf?signature=demo":
                return httpx.Response(
                    200,
                    headers={"content-type": "application/pdf"},
                    content=b"%PDF-relative-1580",
                )
            return await super().get(path, params=params)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = RelativePreviewBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        preview_response = client.get("/api/v1/knowledge/space/12/files/1580/preview")

    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["mode"] == "pdf"
    assert preview["download_url"] == "https://bisheng.example.com/bisheng/original/1580.pdf?signature=demo"
    assert preview["source_kind"] == "original_url"
    assert preview["viewer_url"].endswith("source_kind=original_url")


def test_get_file_preview_uses_preview_task_when_direct_urls_missing(tmp_path: Path):
    class PreviewTaskBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/12/files/1580/preview":
                return {"data": {"original_url": "", "preview_url": ""}}
            if path == "/api/v1/knowledge/preview/status":
                assert params == {"task_id": "task-1580"}
                return {
                    "data": {
                        "status": "success",
                        "file_url": "https://example.com/task/1580.pdf",
                    }
                }
            return await super().get_json(path, params=params)

        async def post_json(self, path: str, json=None):
            assert path == "/api/v1/knowledge/preview"
            assert json == {"knowledge_id": 12, "file_id": 1580}
            return {"data": {"task_id": "task-1580"}}

        async def get(self, path: str, params=None):
            if path == "https://example.com/task/1580.pdf":
                return httpx.Response(
                    200,
                    headers={"content-type": "application/pdf"},
                    content=b"%PDF-task-1580",
                )
            return await super().get(path, params=params)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = PreviewTaskBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        preview_response = client.get("/api/v1/knowledge/space/12/files/1580/preview")
        content_response = client.get(
            "/api/v1/knowledge/space/12/files/1580/preview/content?source_kind=preview_task"
        )

    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["mode"] == "pdf"
    assert preview["source_kind"] == "preview_task"
    assert preview["viewer_url"].endswith("source_kind=preview_task")

    assert content_response.status_code == 200
    assert content_response.headers["content-type"] == "application/pdf"
    assert content_response.content == b"%PDF-task-1580"


def test_get_file_preview_content_proxies_selected_source(tmp_path: Path):
    for client, _, fake_bisheng in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/space/12/files/1580/preview/content?source_kind=preview_url")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == b"%PDF-preview-1580"
    assert fake_bisheng.preview_asset_requests == [
        {"path": "https://example.com/preview/1580.pdf", "params": None}
    ]


def test_get_file_preview_content_uses_preview_asset_fetcher_for_original_urls(tmp_path: Path):
    class PreviewAssetOnlyBishengClient(FakeBishengClient):
        async def get(self, path: str, params=None):
            raise AssertionError("preview content should not use authenticated get() for preview assets")

        async def get_preview_asset(self, path: str, params=None):
            self.preview_asset_requests.append({"path": path, "params": params})
            return httpx.Response(
                200,
                request=httpx.Request("GET", path),
                headers={"content-type": "application/octet-stream"},
                content=b"markdown body",
            )

        async def get_json(self, path: str, params=None):
            if path == "/api/v1/knowledge/space/12/files/1580/preview":
                return {
                    "data": {
                        "original_url": "https://example.com/original/1580.md?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=demo",
                        "preview_url": "",
                    }
                }
            if path == "/api/v1/knowledge/file/info/1580":
                return {
                    "data": {
                        "id": 1580,
                        "knowledge_id": 12,
                        "file_name": "热轧1580产线精轧机振动纹治理实践.md",
                        "abstract": "振动纹治理实践摘要",
                        "update_time": "2026-04-13T10:30:00",
                    }
                }
            return await super().get_json(path, params=params)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = PreviewAssetOnlyBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        response = client.get("/api/v1/knowledge/space/12/files/1580/preview/content?source_kind=original_url")

    assert response.status_code == 200
    assert response.content == b"markdown body"
    assert fake_bisheng.preview_asset_requests == [
        {
            "path": "https://example.com/original/1580.md?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=demo",
            "params": None,
        }
    ]


def test_get_file_chunks_returns_sorted_chunk_text(tmp_path: Path):
    for client, _, _ in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/space/12/files/1580/chunks")

    assert response.status_code == 200
    chunks = response.json()["data"]
    assert chunks == [
        {"chunk_index": 1, "text": "第一段内容"},
        {"chunk_index": 2, "text": "第二段内容"},
    ]


def test_chat_proxy_uses_portal_prompt_and_whitelisted_spaces(tmp_path: Path):
    for client, config_service, fake_bisheng in make_client(tmp_path):
        qa_config = config_service.get_config().qa.model_copy(
            update={
                "knowledge_space_ids": [12, 18, 999],
                "ai_search_system_prompt": "搜索提示词",
                "qa_system_prompt": "问答提示词",
            }
        )
        config_service.update_qa(qa_config)

        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-04-15T10:00:00",
                "model": "demo-model",
                "scene": "search",
                "text": "振动纹如何排查？",
                "search_enabled": False,
            },
        )

    assert response.status_code == 200
    assert fake_bisheng.chat_payload is not None
    assert fake_bisheng.chat_payload["path"] == "/api/v1/workstation/chat/completions"
    assert "搜索提示词" in fake_bisheng.chat_payload["json"]["text"]
    assert fake_bisheng.chat_payload["json"]["use_knowledge_base"]["knowledge_space_ids"] == [12, 18]


def test_chat_proxy_falls_back_to_selected_qa_model(tmp_path: Path):
    for client, config_service, fake_bisheng in make_client(tmp_path):
        qa_config = config_service.get_config().qa.model_copy(
            update={"selected_model": "1"}
        )
        config_service.update_qa(qa_config)

        response = client.post(
            "/api/v1/workstation/chat/completions",
            json={
                "clientTimestamp": "2026-04-15T10:00:00",
                "model": "",
                "scene": "qa",
                "text": "振动纹如何排查？",
            },
        )

    assert response.status_code == 200
    assert fake_bisheng.chat_payload is not None
    assert fake_bisheng.chat_payload["json"]["model"] == "1"


def test_document_file_chat_forwards_to_bisheng_single_file_chat(tmp_path: Path):
    for client, config_service, fake_bisheng in make_client(tmp_path):
        qa_config = config_service.get_config().qa.model_copy(update={"selected_model": "1"})
        config_service.update_qa(qa_config)

        response = client.post(
            "/api/v1/knowledge/space/12/files/1580/chat",
            json={"query": "这个文档的核心内容是什么？"},
        )

    assert response.status_code == 200
    assert b'"ok":true' in response.content
    assert fake_bisheng.chat_payload == {
        "path": "/api/v1/knowledge/space/12/chat/file/1580",
        "json": {
            "query": "这个文档的核心内容是什么？",
            "modelId": 1,
        },
    }


def test_get_tags_aggregates_enabled_spaces(tmp_path: Path):
    for client, _, _ in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/tags?space_ids=12&space_ids=18&space_ids=999")

    assert response.status_code == 200
    assert response.json()["data"] == ["振动纹", "板面缺陷", "热轧"]


def test_get_tags_uses_shougang_portal_batch_endpoint(tmp_path: Path):
    class BatchOnlyBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path.endswith("/tag"):
                raise AssertionError("tags should use shougang portal batch endpoint")
            return await super().get_json(path, params=params)

        async def post_json(self, path: str, json=None):
            self.post_calls.append((path, json))
            if path == "/api/v1/knowledge/shougang-portal/tags/search":
                assert json == {"space_ids": [12, 18], "space_level": None}
                return {"data": {"tags": ["振动纹", "板面缺陷", "热轧"]}}
            return await super().post_json(path, json=json)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = BatchOnlyBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        response = client.get("/api/v1/knowledge/tags?space_ids=12&space_ids=18")

    assert response.status_code == 200
    assert response.json()["data"] == ["振动纹", "板面缺陷", "热轧"]
    assert fake_bisheng.post_calls == [
        ("/api/v1/knowledge/shougang-portal/tags/search", {"space_ids": [12, 18], "space_level": None})
    ]


def test_search_files_uses_shougang_portal_batch_endpoint_without_space_level(tmp_path: Path):
    class BatchOnlyBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path.endswith("/search"):
                raise AssertionError("multi-space file search should use shougang portal batch endpoint")
            return await super().get_json(path, params=params)

        async def post_json(self, path: str, json=None):
            self.post_calls.append((path, json))
            if path == "/api/v1/knowledge/shougang-portal/files/search":
                assert json == {
                    "q": None,
                    "tag": "热轧",
                    "space_ids": [12, 18],
                    "space_level": None,
                    "file_ext": None,
                    "sort": "updated_at",
                    "page": 1,
                    "page_size": 10,
                }
                return {
                    "data": {
                        "data": [
                            {
                                "id": 1580,
                                "space_id": 12,
                                "title": "热轧1580产线精轧机振动纹治理实践",
                                "summary": "振动纹治理实践摘要",
                                "source": "轧线技术案例库",
                                "updated_at": "2026-04-13T10:30:00",
                                "tags": ["热轧"],
                                "file_ext": "pdf",
                                "file_size": "949.33KB",
                                "file_encoding": "GF-ZD-SC-202604-01201",
                            }
                        ],
                        "total": 1,
                        "page": 1,
                        "page_size": 10,
                    }
                }
            return await super().post_json(path, json=json)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = BatchOnlyBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        response = client.get("/api/v1/knowledge/files?tag=%E7%83%AD%E8%BD%A7&space_ids=12&space_ids=18&page=1&page_size=10")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 1
    assert body["data"][0]["space_id"] == 12
    assert fake_bisheng.post_calls == [
        (
            "/api/v1/knowledge/shougang-portal/files/search",
            {
                "q": None,
                "tag": "热轧",
                "space_ids": [12, 18],
                "space_level": None,
                "file_ext": None,
                "sort": "updated_at",
                "page": 1,
                "page_size": 10,
            },
        )
    ]


def test_get_home_content_uses_shougang_portal_home_batch_endpoint(tmp_path: Path):
    class HomeBatchBishengClient(FakeBishengClient):
        async def post_json(self, path: str, json=None):
            self.post_calls.append((path, json))
            if path == "/api/v1/knowledge/shougang-portal/home":
                assert json == {
                    "space_ids": [12, 18, 25],
                    "space_level": None,
                    "sections": [
                        {"tag": "最新精选", "page_size": 6},
                        {"tag": "典型案例", "page_size": 6},
                    ],
                    "hot_tags_limit": 8,
                }
                return {
                    "data": {
                        "sections": {
                            "最新精选": [
                                {
                                    "id": 1580,
                                    "space_id": 12,
                                    "title": "热轧1580产线精轧机振动纹治理实践",
                                    "summary": "振动纹治理实践摘要",
                                    "source": "轧线技术案例库",
                                    "updated_at": "2026-04-13T10:30:00",
                                    "tags": ["最新精选", "热轧"],
                                    "file_ext": "pdf",
                                    "file_size": "949.33KB",
                                    "file_encoding": "GF-ZD-SC-202604-01201",
                                }
                            ],
                            "典型案例": [],
                        },
                        "tags": ["最新精选", "典型案例", "热轧"],
                    }
                }
            return await super().post_json(path, json=json)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = HomeBatchBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        response = client.get("/api/v1/knowledge/home")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["sections"]["最新精选"][0]["space_id"] == 12
    assert body["sections"]["典型案例"] == []
    assert body["tags"] == ["最新精选", "典型案例", "热轧"]
    assert fake_bisheng.post_calls == [
        (
            "/api/v1/knowledge/shougang-portal/home",
            {
                "space_ids": [12, 18, 25],
                "space_level": None,
                "sections": [
                    {"tag": "最新精选", "page_size": 6},
                    {"tag": "典型案例", "page_size": 6},
                ],
                "hot_tags_limit": 8,
            },
        )
    ]


def test_search_files_lists_space_filtered_files_without_keyword(tmp_path: Path):
    for client, _, _ in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/files?space_ids=12&page=1&page_size=10")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 2
    assert [item["space_id"] for item in body["data"]] == [12, 12]
    assert [item["title"] for item in body["data"]] == [
        "热轧1580产线精轧机振动纹治理实践",
        "热轧加热炉温度控制",
    ]


def test_search_files_passes_space_level_to_shougang_portal_search(tmp_path: Path):
    for client, _, fake_bisheng in make_client(tmp_path):
        response = client.get("/api/v1/knowledge/files?q=%E6%8C%AF%E5%8A%A8%E7%BA%B9&space_level=department&file_ext=pdf")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total"] == 1
    assert body["data"][0]["space_id"] == 12
    assert fake_bisheng.post_calls == [
        (
            "/api/v1/knowledge/shougang-portal/files/search",
            {
                "q": "振动纹",
                "tag": None,
                "space_ids": [12, 18, 25],
                "space_level": "department",
                "file_ext": "pdf",
                "sort": "updated_at",
                "page": 1,
                "page_size": 20,
            },
        )
    ]


def test_search_and_tags_skip_unauthorized_spaces_instead_of_500(tmp_path: Path):
    class PartialUnauthorizedBishengClient(FakeBishengClient):
        async def get_json(self, path: str, params=None):
            if path in {"/api/v1/knowledge/space/18/tag", "/api/v1/knowledge/space/18/search"}:
                request = httpx.Request("GET", f"https://example.com{path}")
                response = httpx.Response(401, request=request)
                raise httpx.HTTPStatusError("unauthorized", request=request, response=response)
            return await super().get_json(path, params=params)

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _seed_test_spaces(config_service)
    fake_bisheng = PartialUnauthorizedBishengClient()
    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.bisheng_client = fake_bisheng
        tags_response = client.get("/api/v1/knowledge/tags?space_ids=12&space_ids=18")
        search_response = client.get("/api/v1/knowledge/files?tag=%E7%83%AD%E8%BD%A7&space_ids=12&space_ids=18")

    assert tags_response.status_code == 200
    assert tags_response.json()["data"] == ["振动纹", "热轧"]

    assert search_response.status_code == 200
    search_data = search_response.json()["data"]
    assert search_data["total"] == 2
    assert all(item["space_id"] == 12 for item in search_data["data"])
