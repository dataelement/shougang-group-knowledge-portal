import asyncio
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.api.routes.knowledge import (
    _compute_shadow_home_recommendation,
    _personalized_rollout_bucket,
    _select_home_recommendation_mode,
)
from app.main import app
from app.schemas.auth import PortalUserView
from app.schemas.knowledge import (
    CursorKnowledgeFileData,
    FilePreviewManifest,
    KnowledgeFileItem,
    KnowledgeSpaceItem,
    KnowledgeSpaceListData,
)
from app.services.knowledge_service import (
    LATEST_SELECTED_RECOMMENDATION,
    PERSONALIZED_RECOMMENDATION,
    KnowledgeService,
)
from app.services.portal_auth_service import PortalAuthError
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService


def _parse_home_events(response) -> list[dict]:
    events: list[dict] = []
    for block in response.text.split("\n\n"):
        data_lines = [
            line.removeprefix("data: ")
            for line in block.splitlines()
            if line.startswith("data: ")
        ]
        if data_lines:
            events.append(json.loads("\n".join(data_lines)))
    return events


def _file(file_id: int = 1, *, title: str = "推荐文档") -> KnowledgeFileItem:
    return KnowledgeFileItem(
        id=file_id,
        space_id=12,
        title=title,
        summary="",
        source="公共知识库",
        updated_at="2026-07-15T00:00:00",
    )


def _session(*, user_id: int = 1001, tenant_id: int = 1):
    return SimpleNamespace(
        session_id="session-1",
        access_token="current-user-token",
        user=PortalUserView(
            account="portal-user",
            name="门户用户",
            initial="门",
            role="内部员工",
            external_id="EMP-1001",
            user_id=user_id,
            tenant_id=tenant_id,
            login_at=1,
        ),
    )


class TrackingBishengClient:
    def __init__(self, token: str):
        self.token = token
        self.closed = 0
        self.telemetry_events: list[dict] = []

    async def post_json(self, path: str, json=None, headers=None):
        if path == "/api/v1/knowledge/shougang-portal/telemetry/events":
            self.telemetry_events.append(json)
            return {"status_code": 200, "data": {"accepted": True}}
        raise AssertionError(f"Unexpected POST {path}")

    async def aclose(self):
        self.closed += 1


class SessionAuthService:
    def __init__(self, session=None):
        self.session = session or _session()
        self.clients: list[TrackingBishengClient] = []

    def get_session(self, _request):
        return self.session

    def require_session(self, _request):
        return self.session

    def create_bisheng_client(self, session):
        client = TrackingBishengClient(session.access_token)
        self.clients.append(client)
        return client


class NoSessionAuthService(SessionAuthService):
    def __init__(self):
        super().__init__(_session())

    def get_session(self, _request):
        return None

    def require_session(self, _request):
        raise PortalAuthError("请先登录", status_code=401)


class CacheSpy(PortalHomeCacheService):
    def __init__(self, cached=None):
        super().__init__()
        self.cached = cached
        self.get_calls: list[str] = []
        self.set_calls: list[tuple[str, dict, int]] = []

    async def get_json(self, key: str):
        self.get_calls.append(key)
        return self.cached

    async def set_json(self, key: str, value, ttl_seconds: int):
        self.set_calls.append((key, value, ttl_seconds))


async def _visible_spaces(_self):
    return KnowledgeSpaceListData(
        data=[KnowledgeSpaceItem(id=12, name="公共知识库", space_level="public")],
        total=1,
    )


def _configure_recommendation(
    service: PortalConfigService,
    *,
    rollout_percent: int,
    shadow_enabled: bool = False,
    top_n: int = 20,
) -> None:
    current = service.get_config().recommendation
    service.update_recommendation(
        current.model_copy(
            update={
                "home_total_count": top_n,
                "personalized_rollout_percent": rollout_percent,
                "personalized_shadow_enabled": shadow_enabled,
            }
        )
    )


def test_personalized_rollout_bucket_uses_stable_tenant_user_hash(tmp_path: Path):
    expected = int.from_bytes(
        hashlib.sha256(b"9:1001:personalized_v1").digest()[:8],
        "big",
        signed=False,
    ) % 100

    assert _personalized_rollout_bucket(tenant_id=9, user_id=1001) == expected
    assert _personalized_rollout_bucket(tenant_id=9, user_id=1001) == expected

    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _configure_recommendation(config_service, rollout_percent=expected)
    assert (
        _select_home_recommendation_mode(_session(user_id=1001, tenant_id=9), config_service.get_config())
        == LATEST_SELECTED_RECOMMENDATION
    )
    _configure_recommendation(config_service, rollout_percent=expected + 1)
    assert (
        _select_home_recommendation_mode(_session(user_id=1001, tenant_id=9), config_service.get_config())
        == PERSONALIZED_RECOMMENDATION
    )


def test_anonymous_home_uses_latest_selected_and_writes_public_cache(
    tmp_path: Path,
    monkeypatch,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    cache = CacheSpy()
    modes: list[str] = []

    async def iter_sections(self, **kwargs):
        modes.append(kwargs.get("latest_recommendation", LATEST_SELECTED_RECOMMENDATION))
        yield "最新精选", [_file()], LATEST_SELECTED_RECOMMENDATION

    monkeypatch.setattr(KnowledgeService, "iter_home_content_with_modes", iter_sections)
    auth = NoSessionAuthService()
    system_client = TrackingBishengClient("system-token")

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_home_cache_service = cache
        client.app.state.portal_auth_service = auth
        client.app.state.bisheng_client = system_client
        response = client.get("/api/v1/knowledge/home")

    events = _parse_home_events(response)
    section = next(event for event in events if event.get("type") == "section")
    assert response.status_code == 200
    assert modes == [LATEST_SELECTED_RECOMMENDATION]
    assert section["recommendation_mode"] == LATEST_SELECTED_RECOMMENDATION
    assert len(cache.get_calls) == 1
    assert len(cache.set_calls) == 1
    assert cache.set_calls[0][1]["sections"][0]["recommendation_mode"] == LATEST_SELECTED_RECOMMENDATION
    assert system_client.closed == 0


def test_logged_in_home_rollout_uses_personalized_sse_and_bypasses_full_home_cache(
    tmp_path: Path,
    monkeypatch,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _configure_recommendation(config_service, rollout_percent=100, top_n=17)
    cache = CacheSpy(
        cached={"sections": [{"tag": "不应读取", "items": [{"id": 999}]}]}
    )
    calls: list[dict] = []

    async def iter_sections(self, **kwargs):
        calls.append(kwargs)
        yield "最新精选", [_file()], kwargs["latest_recommendation"]

    monkeypatch.setattr(KnowledgeService, "list_visible_spaces", _visible_spaces)
    monkeypatch.setattr(KnowledgeService, "iter_home_content_with_modes", iter_sections)
    auth = SessionAuthService()

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_home_cache_service = cache
        client.app.state.portal_auth_service = auth
        response = client.get("/api/v1/knowledge/home")

    events = _parse_home_events(response)
    section = next(event for event in events if event.get("type") == "section")
    assert response.status_code == 200
    assert section["recommendation_mode"] == PERSONALIZED_RECOMMENDATION
    assert calls[0]["latest_recommendation"] == PERSONALIZED_RECOMMENDATION
    assert calls[0]["recommendation_limit"] == 17
    assert cache.get_calls == []
    assert cache.set_calls == []
    assert [client.token for client in auth.clients] == ["current-user-token"]
    assert auth.clients[0].closed == 1


def test_shadow_mode_streams_legacy_result_and_computes_personalized_in_background(
    tmp_path: Path,
    monkeypatch,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _configure_recommendation(
        config_service,
        rollout_percent=100,
        shadow_enabled=True,
        top_n=19,
    )
    streamed_modes: list[str] = []
    shadow_calls: list[dict] = []
    shadow_metrics: list[dict] = []

    async def iter_sections(self, **kwargs):
        streamed_modes.append(kwargs["latest_recommendation"])
        yield "最新精选", [_file()], kwargs["latest_recommendation"]

    async def search_files(self, **kwargs):
        shadow_calls.append({**kwargs, "token": self._bisheng.token})
        return CursorKnowledgeFileData(data=[_file(), _file(2)], has_more=False, next_cursor=None)

    def capture_shadow_metric(message, *args, **kwargs):
        if message == "portal personalized shadow metric":
            shadow_metrics.append(kwargs["extra"])

    monkeypatch.setattr(KnowledgeService, "list_visible_spaces", _visible_spaces)
    monkeypatch.setattr(KnowledgeService, "iter_home_content_with_modes", iter_sections)
    monkeypatch.setattr(KnowledgeService, "search_files", search_files)
    monkeypatch.setattr("app.api.routes.knowledge.logger.info", capture_shadow_metric)
    auth = SessionAuthService()

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_home_cache_service = CacheSpy()
        client.app.state.portal_auth_service = auth
        response = client.get("/api/v1/knowledge/home")

    section = next(
        event for event in _parse_home_events(response) if event.get("type") == "section"
    )
    assert streamed_modes == [LATEST_SELECTED_RECOMMENDATION]
    assert section["recommendation_mode"] == LATEST_SELECTED_RECOMMENDATION
    assert len(shadow_calls) == 1
    assert shadow_calls[0]["recommendation"] == PERSONALIZED_RECOMMENDATION
    assert shadow_calls[0]["limit"] == 19
    assert shadow_calls[0]["token"] == "current-user-token"
    assert len(shadow_metrics) == 1
    assert shadow_metrics[0]["portal_shadow_success"] is True
    assert shadow_metrics[0]["portal_shadow_result_count"] == 2
    assert shadow_metrics[0]["portal_shadow_baseline_count"] == 1
    assert shadow_metrics[0]["portal_shadow_overlap_count"] == 1
    assert shadow_metrics[0]["portal_shadow_overlap_rate"] == 1.0
    assert shadow_metrics[0]["portal_shadow_error_type"] == ""
    assert "file" not in " ".join(shadow_metrics[0])
    assert len(auth.clients) == 2
    assert all(client.closed == 1 for client in auth.clients)


def test_shadow_mode_emits_failure_metric_without_file_metadata(tmp_path: Path, monkeypatch):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _configure_recommendation(config_service, rollout_percent=100, shadow_enabled=True)
    shadow_metrics: list[dict] = []

    async def search_files(_self, **_kwargs):
        raise RuntimeError("upstream failed for file 123")

    def capture_shadow_metric(message, *args, **kwargs):
        if message == "portal personalized shadow metric":
            shadow_metrics.append(kwargs["extra"])

    monkeypatch.setattr(KnowledgeService, "search_files", search_files)
    monkeypatch.setattr("app.api.routes.knowledge.logger.info", capture_shadow_metric)
    auth = SessionAuthService()

    asyncio.run(
        _compute_shadow_home_recommendation(
            auth_service=auth,
            session=auth.session,
            portal_config_service=config_service,
            extra_space_ids=[12],
            baseline_file_keys=[(12, 123)],
        )
    )

    assert len(shadow_metrics) == 1
    assert shadow_metrics[0]["portal_shadow_success"] is False
    assert shadow_metrics[0]["portal_shadow_result_count"] == 0
    assert shadow_metrics[0]["portal_shadow_overlap_count"] == 0
    assert shadow_metrics[0]["portal_shadow_error_type"] == "RuntimeError"
    assert all("file" not in key for key in shadow_metrics[0])
    assert auth.clients[0].closed == 1


def test_personalized_home_failure_falls_back_to_latest_with_same_user_client(
    tmp_path: Path,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    user_client = TrackingBishengClient("current-user-token")
    service = KnowledgeService(
        bisheng_client=user_client,
        portal_config_service=config_service,
    )
    calls: list[tuple[str | None, str]] = []

    async def resolve_spaces(*args, **kwargs):
        return [12]

    async def search_files(**kwargs):
        calls.append((kwargs["recommendation"], service._bisheng.token))
        if kwargs["recommendation"] == PERSONALIZED_RECOMMENDATION:
            raise RuntimeError("personalized upstream unavailable")
        return CursorKnowledgeFileData(data=[_file(2, title="兜底文档")], has_more=False)

    service.resolve_requested_space_ids = resolve_spaces  # type: ignore[method-assign]
    service.search_files = search_files  # type: ignore[method-assign]

    async def collect():
        return [
            (tag, items, mode)
            async for tag, items, mode in service.iter_home_content_with_modes(
                extra_space_ids=[12],
                latest_recommendation=PERSONALIZED_RECOMMENDATION,
                recommendation_limit=20,
                fallback_latest_on_error=True,
            )
        ]

    sections = asyncio.run(collect())
    latest = next(section for section in sections if section[0] == "最新精选")

    assert latest[2] == LATEST_SELECTED_RECOMMENDATION
    assert latest[1][0].title == "兜底文档"
    assert (PERSONALIZED_RECOMMENDATION, "current-user-token") in calls
    assert (LATEST_SELECTED_RECOMMENDATION, "current-user-token") in calls


def test_personalized_home_successful_empty_response_does_not_fallback(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    service = KnowledgeService(
        bisheng_client=TrackingBishengClient("current-user-token"),
        portal_config_service=config_service,
    )
    recommendation_calls: list[str | None] = []

    async def resolve_spaces(*args, **kwargs):
        return [12]

    async def search_files(**kwargs):
        recommendation_calls.append(kwargs["recommendation"])
        return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)

    service.resolve_requested_space_ids = resolve_spaces  # type: ignore[method-assign]
    service.search_files = search_files  # type: ignore[method-assign]

    async def collect():
        return [
            (tag, items, mode)
            async for tag, items, mode in service.iter_home_content_with_modes(
                extra_space_ids=[12],
                latest_recommendation=PERSONALIZED_RECOMMENDATION,
                recommendation_limit=20,
                fallback_latest_on_error=True,
            )
        ]

    sections = asyncio.run(collect())
    latest = next(section for section in sections if section[0] == "最新精选")

    assert latest[1] == []
    assert latest[2] == PERSONALIZED_RECOMMENDATION
    assert recommendation_calls.count(PERSONALIZED_RECOMMENDATION) == 1
    assert LATEST_SELECTED_RECOMMENDATION not in recommendation_calls


def test_personalized_more_list_uses_configured_top_n_and_ignores_query_cursor(
    tmp_path: Path,
    monkeypatch,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    _configure_recommendation(config_service, rollout_percent=100, top_n=23)
    search_calls: list[dict] = []

    async def search_files(self, **kwargs):
        search_calls.append(kwargs)
        return CursorKnowledgeFileData(data=[_file()], has_more=False, next_cursor=None)

    monkeypatch.setattr(KnowledgeService, "list_visible_spaces", _visible_spaces)
    monkeypatch.setattr(KnowledgeService, "search_files", search_files)
    auth = SessionAuthService()

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = auth
        response = client.get(
            "/api/v1/knowledge/files",
            params={
                "recommendation": PERSONALIZED_RECOMMENDATION,
                "q": "应被忽略",
                "cursor": "should-be-ignored",
                "limit": 1,
            },
        )

    assert response.status_code == 200
    assert response.json()["data"]["has_more"] is False
    assert response.json()["data"]["next_cursor"] is None
    assert search_calls[0]["recommendation"] == PERSONALIZED_RECOMMENDATION
    assert search_calls[0]["q"] is None
    assert search_calls[0]["cursor"] is None
    assert search_calls[0]["limit"] == 23


def test_personalized_more_list_rejects_anonymous_users(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = NoSessionAuthService()
        response = client.get(
            f"/api/v1/knowledge/files?recommendation={PERSONALIZED_RECOMMENDATION}"
        )

    assert response.status_code == 401


def test_search_telemetry_requires_login_and_forwards_normalized_query(tmp_path: Path):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    auth = SessionAuthService()

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = NoSessionAuthService()
        anonymous = client.post(
            "/api/v1/knowledge/telemetry/search",
            json={"query": "轧机", "entry_point": "search_page"},
        )

        client.app.state.portal_auth_service = auth
        accepted = client.post(
            "/api/v1/knowledge/telemetry/search",
            json={"query": "  轧机   振动纹  ", "entry_point": "home_hot_keyword"},
        )

    assert anonymous.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["data"] == {"accepted": True}
    assert auth.clients[0].telemetry_events == [
        {
            "event_type": "portal_search",
            "source_app": "shougang_portal",
            "scene": "knowledge_search",
            "entry_point": "home_hot_keyword",
            "resource_type": "search_query",
            "status": "success",
            "query": "轧机 振动纹",
        }
    ]
    assert auth.clients[0].closed == 1


def test_preview_forwards_entry_point_and_recommendation_scene(
    tmp_path: Path,
    monkeypatch,
):
    config_service = PortalConfigService(config_path=tmp_path / "portal_config.json")
    auth = SessionAuthService()

    async def get_preview(self, **kwargs):
        return FilePreviewManifest(mode="pdf", source_kind="preview_url")

    monkeypatch.setattr(KnowledgeService, "list_visible_spaces", _visible_spaces)
    monkeypatch.setattr(KnowledgeService, "get_file_preview", get_preview)

    with TestClient(app) as client:
        client.app.state.portal_config_service = config_service
        client.app.state.portal_auth_service = auth
        response = client.get(
            "/api/v1/knowledge/space/12/files/1580/preview",
            params={
                "entry_point": "recommendation_list",
                "recommendation_scene": PERSONALIZED_RECOMMENDATION,
            },
        )

    assert response.status_code == 200
    assert auth.clients[0].telemetry_events == [
        {
            "event_type": "portal_document_read",
            "source_app": "shougang_portal",
            "scene": "document_preview",
            "entry_point": "recommendation_list",
            "resource_type": "document",
            "status": "success",
            "space_id": 12,
            "file_id": 1580,
            "recommendation_scene": PERSONALIZED_RECOMMENDATION,
        }
    ]
    assert auth.clients[0].closed == 1
