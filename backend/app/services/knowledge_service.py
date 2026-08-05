import asyncio
import base64
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Optional
from urllib.parse import urlparse

import httpx
from app.clients.bisheng import BishengClient
from app.schemas.knowledge import (
    FileChunkItem,
    FavoriteDocumentData,
    FavoriteDocumentRequest,
    FavoriteRemoveRequest,
    FavoriteRemoveData,
    FavoriteStatusRequest,
    FavoriteStatusData,
    FavoriteStatusResultItem,
    FavoriteFilesData,
    FavoriteFileItem,
    FilePreviewData,
    FilePreviewManifest,
    FilePreviewMode,
    FilePreviewSourceKind,
    FileTag,
    KnowledgeFileDetail,
    KnowledgeFileItem,
    KnowledgeFileSpace,
    PersonalKnowledgeSpaceItem,
    PersonalKnowledgeSpaceListData,
    QaKnowledgeFolderStatsData,
    QaKnowledgeFolderStatsItem,
    QaKnowledgeTreeNode,
    QaKnowledgeTreeNodeData,
    KnowledgeSpaceItem,
    KnowledgeSpaceListData,
    PagedKnowledgeFileData,
    CursorKnowledgeFileData,
    RelatedKnowledgeFileData,
    DocumentFileChatRequest,
    DepartmentFileViewAccessData,
    DepartmentFileViewApplyData,
    ShareDocumentAccessInternalData,
    ShareDocumentAccessRequest,
    ShareDocumentData,
    ShareDocumentMeta,
    ShareDocumentRequest,
    PortalHotSearchItem,
)
from app.schemas.portal_config import PortalConfig
from app.services.error_messages import normalize_user_facing_message
from app.services.portal_config_service import PortalConfigService
from app.services.portal_telemetry_service import PORTAL_BFF_TELEMETRY_HEADERS

logger = logging.getLogger(__name__)

SUCCESS_STATUS = 2
FILE_TYPE = 1
IMAGE_EXTENSIONS = {"bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"}
SPREADSHEET_EXTENSIONS = {"csv", "xls", "xlsx"}
MARKDOWN_EXTENSIONS = {"markdown", "md"}
HTML_EXTENSIONS = {"htm", "html"}
TEXT_EXTENSIONS = {"txt"}
LEGACY_WORD_EXTENSIONS = {"doc"}
# Presentations are converted to PDF by bisheng and served via preview_url, so they
# preview as PDFs rather than being unsupported.
PPT_EXTENSIONS = {"ppt", "pptx", "dps"}
UNSUPPORTED_PREVIEW_EXTENSIONS: set[str] = set()
PREVIEW_TASK_CACHE_TTL_SECONDS = 900.0
PREVIEW_TASK_POLL_ATTEMPTS = 6
PREVIEW_TASK_POLL_DELAY_SECONDS = 0.4
PREVIEW_TASK_FAILURE_STATUSES = {"cancelled", "canceled", "error", "failed", "failure", "timeout"}
FRONTEND_PROXY_ASSET_PATH_PREFIXES = ("/bisheng/", "/skm-bisheng/", "/workspace/bisheng/", "/workspace/skm-bisheng/", "/tmp-dir")
LATEST_SELECTED_RECOMMENDATION = "latest_selected"
PERSONALIZED_RECOMMENDATION = "personalized_v1"
TYPICAL_CASE_SECTION_KEY = "typical_case"
LOCAL_OFFSET_CURSOR_PREFIX = "offset:"
FILTERED_TAG_CURSOR_PREFIX = "tagfilter:"
SPACE_LIST_ENDPOINTS = (
    ("mine", "/api/v1/knowledge/space/mine"),
    ("joined", "/api/v1/knowledge/space/joined"),
    ("department", "/api/v1/knowledge/space/department"),
    ("managed", "/api/v1/knowledge/space/managed"),
)
GROUPED_SPACE_KEYS = (
    ("personal", "personal_spaces"),
    ("team", "team_spaces"),
    ("department", "department_spaces"),
    ("public", "public_spaces"),
)
ROLE_PRIORITY = {"creator": 3, "admin": 2, "member": 1}
FILE_SIZE_KEYS = (
    "file_size",
    "fileSize",
    "size",
    "file_bytes",
    "fileBytes",
    "bytes",
)
FILE_ENCODING_KEYS = (
    "file_encoding",
    "fileEncoding",
    "file_encode",
    "fileEncode",
    "file_code",
    "fileCode",
    "document_code",
    "documentCode",
    "doc_code",
    "docCode",
    "file_no",
    "fileNo",
)
UPDATED_AT_ASC_SORT = "updated_at_asc"
UPDATED_AT_DESC_SORTS = {"updated_at", "updated_at_desc"}
PortalDiscoveryScope = Literal["legacy", "public", "public_and_department"]


@dataclass
class SpaceSearchResult:
    items: list[dict[str, Any]]
    total: int


@dataclass
class CachedPreviewTaskResult:
    file_url: str
    expires_at: float


@dataclass
class ResolvedPreviewSource:
    source_kind: FilePreviewSourceKind
    url: str


PREVIEW_TASK_CACHE: dict[tuple[int, int], CachedPreviewTaskResult] = {}


class BishengBusinessError(Exception):
    def __init__(self, status_code: int, status_message: str):
        self.status_code = status_code
        self.status_message = status_message
        super().__init__(status_message)


class KnowledgeService:
    def __init__(
        self,
        bisheng_client: BishengClient,
        portal_config_service: PortalConfigService,
        page_size_limit: int = 100,
        default_model: str | None = None,
    ):
        self._bisheng = bisheng_client
        self._config_service = portal_config_service
        self._page_size_limit = page_size_limit
        self._default_model = default_model or ""

    @staticmethod
    def _is_public_space(space: KnowledgeSpaceItem) -> bool:
        space_level = (space.space_level or "").strip().lower()
        if space_level:
            return space_level == "public"
        return "public" in space.sources

    @staticmethod
    def _effective_upstream_space_level(
        space_level: Optional[str],
        extra_space_ids: Optional[list[int]],
    ) -> Optional[str]:
        # 匿名请求使用后台服务账号访问上游，必须重新收窄到公共层级。
        return "public" if extra_space_ids is None else space_level

    async def list_public_spaces(self) -> KnowledgeSpaceListData:
        visible_spaces = await self.list_visible_spaces()
        spaces = [space for space in visible_spaces.data if self._is_public_space(space)]
        return KnowledgeSpaceListData(data=spaces, total=len(spaces))

    async def _allowed_spaces(
        self,
        space_level: Optional[str] = None,
        extra_space_ids: Optional[list[int]] = None,
    ) -> list[KnowledgeSpaceItem]:
        visible_spaces = await self.list_visible_spaces()
        normalized_level = (space_level or "").strip().lower()
        allowed_ids = set(extra_space_ids or [])
        spaces: list[KnowledgeSpaceItem] = []
        for space in visible_spaces.data:
            if extra_space_ids is None:
                if not self._is_public_space(space):
                    continue
            elif not self._is_public_space(space) and space.id not in allowed_ids:
                continue
            if normalized_level and (space.space_level or "").strip().lower() != normalized_level:
                continue
            spaces.append(space)
        return spaces

    async def _allowed_detail_space_ids(self, extra_space_ids: Optional[list[int]] = None) -> set[int]:
        if extra_space_ids is not None:
            return {int(space_id) for space_id in extra_space_ids}
        return {
            space.id
            for space in (
                await self.list_visible_spaces(discovery_scope="public")
            ).data
        }

    async def get_space_name_map(self, extra_space_ids: Optional[list[int]] = None) -> dict[int, str]:
        return {space.id: space.name for space in await self._allowed_spaces(extra_space_ids=extra_space_ids)}

    @staticmethod
    def _is_latest_selected_section(section: Any, index: int | None = None) -> bool:
        if isinstance(section, dict):
            builtin_key = str(section.get("builtin_key") or "")
        else:
            builtin_key = str(getattr(section, "builtin_key", "") or "")
        return builtin_key == LATEST_SELECTED_RECOMMENDATION or (not builtin_key and index == 0)

    @staticmethod
    def is_latest_selected_scoped_request(recommendation: Optional[str]) -> bool:
        return (recommendation or "").strip() == LATEST_SELECTED_RECOMMENDATION

    @staticmethod
    def is_public_latest_selected_request(q: Optional[str], recommendation: Optional[str]) -> bool:
        return not (q or "").strip() and KnowledgeService.is_latest_selected_scoped_request(recommendation)

    @staticmethod
    def _is_typical_case_section(section: Any) -> bool:
        if isinstance(section, dict):
            builtin_key = str(section.get("builtin_key") or "")
        else:
            builtin_key = str(getattr(section, "builtin_key", "") or "")
        return builtin_key == TYPICAL_CASE_SECTION_KEY

    async def iter_home_content(
        self,
        extra_space_ids: Optional[list[int]] = None,
        *,
        discovery_scope: PortalDiscoveryScope = "legacy",
        include_latest: bool = True,
        include_other: bool = True,
    ) -> AsyncIterator[tuple[str, list[KnowledgeFileItem]]]:
        async for tag, items, _ in self.iter_home_content_with_modes(
            extra_space_ids=extra_space_ids,
            discovery_scope=discovery_scope,
            include_latest=include_latest,
            include_other=include_other,
        ):
            yield tag, items

    async def iter_home_content_with_modes(
        self,
        extra_space_ids: Optional[list[int]] = None,
        *,
        config: PortalConfig | None = None,
        discovery_scope: PortalDiscoveryScope = "legacy",
        resolve_user_visible_spaces: bool = False,
        latest_recommendation: str = LATEST_SELECTED_RECOMMENDATION,
        recommendation_limit: int | None = None,
        fallback_latest_on_error: bool = False,
        include_latest: bool = True,
        include_other: bool = True,
    ) -> AsyncIterator[tuple[str, list[KnowledgeFileItem], str | None]]:
        """Yield ``(tag, items)`` for each enabled home section as soon as it is ready.

        Every section is fetched through an independent ``search_files`` request that
        runs concurrently; results are emitted in completion order so the caller can
        stream each section without waiting for the slowest one. A failing section
        yields an empty list instead of aborting the whole stream. Personalized
        recommendation failures may be retried with ``latest_selected`` using the
        same scoped client; a successful empty/partial response is not retried.
        """
        config = config or self._config_service.get_config()
        indexed_sections = [
            (section, index)
            for index, section in enumerate(config.sections)
            if section.enabled and section.tag
        ]
        sections = [
            (section, index)
            for section, index in indexed_sections
            if (include_latest and self._is_latest_selected_section(section, index))
            or (include_other and not self._is_latest_selected_section(section, index))
        ]
        if not sections:
            return

        needs_scoped_spaces = any(
            (
                not self._is_latest_selected_section(section, index)
                and not self._is_typical_case_section(section)
            )
            or (
                self._is_latest_selected_section(section, index)
                and latest_recommendation != LATEST_SELECTED_RECOMMENDATION
            )
            for section, index in sections
        )

        async def resolve_home_space_ids() -> list[int]:
            if discovery_scope != "legacy":
                if resolve_user_visible_spaces and extra_space_ids is None:
                    visible_spaces = await self.list_visible_spaces(
                        discovery_scope=discovery_scope
                    )
                    return [space.id for space in visible_spaces.data]
                return list(extra_space_ids or [])
            if resolve_user_visible_spaces and extra_space_ids is None:
                visible_spaces = await self.list_visible_spaces()
                return [space.id for space in visible_spaces.data]
            return await self.resolve_requested_space_ids(extra_space_ids=extra_space_ids)

        space_ids_task = (
            asyncio.ensure_future(resolve_home_space_ids())
            if needs_scoped_spaces
            else None
        )

        async def fetch_section(
            section: Any,
            index: int,
        ) -> tuple[str, list[KnowledgeFileItem], str | None]:
            is_latest = self._is_latest_selected_section(section, index)
            is_public_tag_section = self._is_typical_case_section(section)
            mode = latest_recommendation if is_latest else None
            uses_public_latest = is_latest and mode == LATEST_SELECTED_RECOMMENDATION
            uses_public_scope = (
                is_public_tag_section
                or (
                    uses_public_latest
                    and discovery_scope != "public_and_department"
                )
            )
            section_limit = (
                recommendation_limit
                if is_latest and recommendation_limit is not None
                else config.display.home.section_page_size
            )
            try:
                if uses_public_scope:
                    space_ids = None
                elif space_ids_task is None:
                    if discovery_scope == "legacy":
                        return section.tag, [], mode
                    space_ids = None
                else:
                    space_ids = await space_ids_task
                if (
                    discovery_scope == "legacy"
                    and not uses_public_scope
                    and not space_ids
                ):
                    return section.tag, [], mode
                result = await self.search_files(
                    q=None,
                    tag=None if is_latest else section.tag,
                    base_tag=None,
                    requested_space_ids=None if uses_public_scope else space_ids,
                    space_level=None,
                    file_ext=None,
                    document_type=None,
                    business_domain_code=None,
                    recommendation=mode,
                    rerank_model_id=config.search.rerank_model_id,
                    public_only=is_public_tag_section,
                    sort=(
                        "portal_read_count_desc"
                        if mode == LATEST_SELECTED_RECOMMENDATION
                        else "updated_at_desc"
                    ),
                    cursor=None,
                    limit=section_limit,
                    extra_space_ids=None if uses_public_scope else extra_space_ids,
                    discovery_scope=(
                        "public"
                        if uses_public_scope
                        else discovery_scope
                    ),
                )
                return section.tag, result.data, mode
            except Exception:
                if (
                    is_latest
                    and mode == PERSONALIZED_RECOMMENDATION
                    and fallback_latest_on_error
                ):
                    logger.exception(
                        "personalized home recommendation failed; falling back to latest_selected"
                    )
                    try:
                        fallback = await self.search_files(
                            q=None,
                            tag=None,
                            base_tag=None,
                            requested_space_ids=None,
                            space_level=None,
                            file_ext=None,
                            document_type=None,
                            business_domain_code=None,
                            recommendation=LATEST_SELECTED_RECOMMENDATION,
                            rerank_model_id=config.search.rerank_model_id,
                            sort="portal_read_count_desc",
                            cursor=None,
                            limit=config.display.home.section_page_size,
                            extra_space_ids=None,
                            discovery_scope=discovery_scope,
                        )
                        return section.tag, fallback.data, LATEST_SELECTED_RECOMMENDATION
                    except Exception:
                        logger.exception("latest_selected home fallback failed")
                elif is_latest and mode == PERSONALIZED_RECOMMENDATION:
                    raise
                return section.tag, [], mode

        tasks = [
            asyncio.ensure_future(fetch_section(section, index))
            for section, index in sections
        ]
        try:
            for completed in asyncio.as_completed(tasks):
                tag, items, mode = await completed
                yield tag, items, mode
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if space_ids_task is not None and not space_ids_task.done():
                space_ids_task.cancel()

    def _build_home_batch_sections(self) -> list[dict[str, Any]]:
        config = self._config_service.get_config()
        sections: list[dict[str, Any]] = []
        for index, section in enumerate(config.sections):
            if not section.enabled or not section.tag:
                continue
            payload: dict[str, Any] = {
                "tag": section.tag,
                "page_size": config.display.home.section_page_size,
            }
            if self._is_latest_selected_section(section, index):
                payload["recommendation"] = LATEST_SELECTED_RECOMMENDATION
            sections.append(payload)
        return sections

    async def fetch_hot_searches(self) -> list[PortalHotSearchItem]:
        config = self._config_service.get_config()
        try:
            response = await self._bisheng.post_json(
                "/api/v1/knowledge/shougang-portal/home",
                json={
                    "space_ids": [],
                    "space_level": None,
                    "sections": self._build_home_batch_sections(),
                    "hot_tags_limit": config.display.home.hot_tags_count,
                },
            )
            if isinstance(response, dict) and response.get("detail") and not response.get("data"):
                logger.warning(
                    "BiSheng home batch returned error payload for hot searches: %s",
                    response.get("detail"),
                )
                return []
            data = self._extract_success_data(response)
        except Exception:
            logger.exception("failed to fetch portal hot searches from BiSheng home batch endpoint")
            return []

        raw_items = data.get("hot_searches") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            return []

        items: list[PortalHotSearchItem] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            query = str(raw.get("query") or "").strip()
            if not query:
                continue
            try:
                rank = int(raw.get("rank") or 0)
            except (TypeError, ValueError):
                continue
            if rank < 1:
                continue
            items.append(PortalHotSearchItem(rank=rank, query=query))

        items.sort(key=lambda item: item.rank)
        return items[:5]

    async def list_visible_spaces(
        self,
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> KnowledgeSpaceListData:
        if discovery_scope != "legacy":
            response = await self._bisheng.get_json(
                "/api/v1/knowledge/shougang-portal/spaces",
                params={"discovery_scope": discovery_scope},
            )
            data = self._extract_success_data(response)
            raw_spaces = data.get("spaces") if isinstance(data, dict) else []
            if not isinstance(raw_spaces, list):
                raw_spaces = []
            spaces = [
                KnowledgeSpaceItem(
                    id=int(item.get("id") or 0),
                    name=str(item.get("name") or ""),
                    space_level=str(item.get("space_level") or ""),
                    auth_type=(
                        "public"
                        if str(item.get("space_level") or "").lower() == "public"
                        else ""
                    ),
                    sources=[str(item.get("space_level") or "")],
                )
                for item in raw_spaces
                if isinstance(item, dict) and int(item.get("id") or 0) > 0
            ]
            if discovery_scope == "public_and_department":
                # 公共库和有效部门库由门户专用接口权威派生；个人库、团队库继续
                # 使用当前用户原有可见范围，避免新增部门发现能力时收窄旧权限。
                grouped_spaces = await self._fetch_grouped_spaces()
                existing_ids = {space.id for space in spaces}
                spaces.extend(
                    space
                    for space in grouped_spaces or []
                    if space.id not in existing_ids
                    and (space.space_level or "").strip().lower()
                    not in {"public", "department"}
                )
            return KnowledgeSpaceListData(
                data=self._sort_spaces(spaces),
                total=len(spaces),
            )

        grouped_spaces = await self._fetch_grouped_spaces()
        if grouped_spaces is not None:
            data = self._sort_spaces(grouped_spaces)
            return KnowledgeSpaceListData(data=data, total=len(data))

        results = await asyncio.gather(
            *[self._fetch_space_endpoint(source, path) for source, path in SPACE_LIST_ENDPOINTS],
            return_exceptions=True,
        )
        merged: dict[int, KnowledgeSpaceItem] = {}
        for result in results:
            if isinstance(result, Exception):
                continue
            source, rows = result
            for row in rows:
                item = self._map_space(row, source)
                if item is None:
                    continue
                current = merged.get(item.id)
                if current is None:
                    merged[item.id] = item
                else:
                    self._merge_space(current, item)

        data = self._sort_spaces(list(merged.values()))
        return KnowledgeSpaceListData(data=data, total=len(data))

    async def list_personal_spaces(self) -> PersonalKnowledgeSpaceListData:
        response = await self._bisheng.get_json("/api/v1/knowledge/shougang-portal/personal-spaces")
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        items = [
            PersonalKnowledgeSpaceItem(
                id=int(item.get("id") or 0),
                name=str(item.get("name") or ""),
                description=str(item.get("description") or ""),
                file_count=int(item.get("file_count") or item.get("file_num") or 0),
                updated_at=str(item.get("updated_at") or item.get("update_time") or ""),
                is_favorite=bool(item.get("is_favorite")),
            )
            for item in raw_items
            if isinstance(item, dict)
        ]
        return PersonalKnowledgeSpaceListData(data=items, total=int(data.get("total") or len(items)))

    async def create_favorite(self, req: FavoriteDocumentRequest) -> FavoriteDocumentData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites", json=req.model_dump())
        data = self._extract_success_data(response)
        return FavoriteDocumentData(
            favorite_file_id=int(data.get("favorite_file_id") or 0),
            space_id=int(data.get("space_id") or 0),
            source_space_id=int(data.get("source_space_id") or req.source_space_id),
            source_file_id=int(data.get("source_file_id") or req.source_file_id),
            title=str(data.get("title") or ""))

    async def get_department_file_view_access(
        self,
        *,
        space_id: int,
        file_id: int,
    ) -> DepartmentFileViewAccessData:
        response = await self._bisheng.get_json(
            "/api/v1/approval/department-file-view/status",
            params={"space_id": space_id, "file_id": file_id},
        )
        data = self._extract_success_data(response)
        return DepartmentFileViewAccessData.model_validate(data)

    async def apply_department_file_view(
        self,
        *,
        space_id: int,
        file_id: int,
        reason: str,
    ) -> DepartmentFileViewApplyData:
        response = await self._bisheng.post_json(
            "/api/v1/approval/department-file-view/apply",
            json={
                "space_id": space_id,
                "file_id": file_id,
                "reason": reason,
            },
        )
        data = self._extract_success_data(response)
        return DepartmentFileViewApplyData.model_validate(data)

    async def remove_favorite(self, req: FavoriteRemoveRequest) -> FavoriteRemoveData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites/remove", json=req.model_dump())
        data = self._extract_success_data(response)
        return FavoriteRemoveData(removed=bool(data.get("removed")))

    async def favorite_status(self, req: FavoriteStatusRequest) -> FavoriteStatusData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites/status", json=req.model_dump())
        data = self._extract_success_data(response)
        raw = data.get("data") if isinstance(data, dict) else []
        items = [FavoriteStatusResultItem(
            space_id=int(it.get("space_id") or 0), file_id=int(it.get("file_id") or 0),
            favorited=bool(it.get("favorited"))) for it in (raw or []) if isinstance(it, dict)]
        return FavoriteStatusData(data=items)

    async def list_favorites(self, page: int = 1, page_size: int = 20) -> FavoriteFilesData:
        response = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/favorites/files?page={page}&page_size={page_size}")
        data = self._extract_success_data(response)
        raw = data.get("data") if isinstance(data, dict) else []
        items = [FavoriteFileItem(
            favorite_file_id=int(it.get("favorite_file_id") or 0),
            source_space_id=int(it.get("source_space_id") or 0),
            source_file_id=int(it.get("source_file_id") or 0),
            title=str(it.get("title") or ""), file_name=str(it.get("file_name") or ""),
            status=str(it.get("status") or "valid"),
            updated_at=str(it.get("updated_at") or "")) for it in (raw or []) if isinstance(it, dict)]
        return FavoriteFilesData(data=items, total=int(data.get("total") or len(items)),
                                 page=int(data.get("page") or page), page_size=int(data.get("page_size") or page_size))

    async def create_share_link(self, req: ShareDocumentRequest) -> ShareDocumentData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/share-links",
            json=req.model_dump(),
        )
        data = self._extract_success_data(response)
        return ShareDocumentData(
            share_token=str(data.get("share_token") or ""),
            link=str(data.get("link") or ""),
            invite_code=str(data.get("invite_code") or ""),
            expire_seconds=int(data.get("expire_seconds") or 0),
        )

    async def get_share_link_meta(
        self,
        share_token: str,
        *,
        anonymous_portal: bool = False,
    ) -> ShareDocumentMeta:
        response = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/share-links/{share_token}",
            headers=(
                {"X-Portal-Anonymous": "true"}
                if anonymous_portal
                else None
            ),
        )
        data = self._extract_success_data(response)
        return ShareDocumentMeta.model_validate(data)

    async def verify_share_link_access(
        self,
        share_token: str,
        req: ShareDocumentAccessRequest,
        *,
        issue_download_grant: bool = False,
    ) -> ShareDocumentAccessInternalData:
        payload = req.model_dump()
        payload["issue_download_grant"] = issue_download_grant
        response = await self._bisheng.post_json(
            f"/api/v1/knowledge/shougang-portal/share-links/{share_token}/verify",
            json=payload,
        )
        data = self._extract_success_data(response)
        return ShareDocumentAccessInternalData.model_validate(data)

    async def prepare_document_file_chat(
        self,
        space_id: int,
        file_id: int,
        req: DocumentFileChatRequest,
    ) -> AsyncIterator[bytes]:
        model_id = self._resolve_document_chat_model_id(req.model)
        await self._ensure_document_chat_model_enabled(str(model_id))
        return self._bisheng.stream_post(
            f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}/chat",
            json={
                "query": req.query,
                "modelId": model_id,
            },
            headers=PORTAL_BFF_TELEMETRY_HEADERS,
        )

    async def _ensure_document_chat_model_enabled(self, model_id: str) -> None:
        try:
            response = await self._bisheng.get_json("/api/v1/llm")
        except Exception as err:
            logger.exception("failed to fetch qa model status before document qa request")
            raise ValueError("问答模型状态暂不可确认，请稍后重试") from err
        raw_models = response.get("data") if isinstance(response, dict) else []
        if not isinstance(raw_models, list):
            raw_models = []
        self._config_service.ensure_qa_model_enabled(model_id, raw_models)

    async def get_space_tags(
        self,
        space_id: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> list[str]:
        if space_id not in await self._allowed_detail_space_ids(extra_space_ids):
            return []
        tag_lookup = await self._get_space_tag_lookup(space_id)
        return sorted(tag_lookup.keys())

    async def get_aggregated_tags(
        self,
        requested_space_ids: Optional[list[int]] = None,
        space_level: Optional[str] = None,
        business_domain_code: Optional[str] = None,
        extra_space_ids: Optional[list[int]] = None,
        fallback_to_public_spaces: bool = False,
    ) -> list[str]:
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        space_ids = await self.resolve_requested_space_ids(
            requested_space_ids,
            space_level,
            extra_space_ids,
            fallback_to_public_spaces=fallback_to_public_spaces,
        )
        if not space_ids:
            return []
        if len(space_ids) > 1 or space_level or normalized_business_domain_code:
            try:
                return await self._fetch_shougang_portal_tags(
                    space_ids=space_ids,
                    space_level=space_level,
                    business_domain_code=normalized_business_domain_code,
                )
            except Exception:
                if normalized_business_domain_code:
                    return []
        lookups = await asyncio.gather(*[self._get_space_tag_lookup(space_id) for space_id in space_ids])
        tags = {tag_name for lookup in lookups for tag_name in lookup.keys()}
        return sorted(tags)

    async def resolve_requested_space_ids(
        self,
        requested_space_ids: Optional[list[int]] = None,
        space_level: Optional[str] = None,
        extra_space_ids: Optional[list[int]] = None,
        fallback_to_public_spaces: bool = False,
    ) -> list[int]:
        base_space_ids = {
            space.id
            for space in await self._allowed_spaces(space_level=space_level, extra_space_ids=extra_space_ids)
        }
        if requested_space_ids:
            scoped_space_ids = base_space_ids.intersection(requested_space_ids)
            if scoped_space_ids or not fallback_to_public_spaces:
                return sorted(scoped_space_ids)
            return sorted(base_space_ids)
        return sorted(base_space_ids)

    async def _resolve_discovery_scope_space_ids(
        self,
        *,
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        extra_space_ids: Optional[list[int]],
        recommendation: Optional[str] = None,
    ) -> list[int]:
        if self.is_latest_selected_scoped_request(recommendation):
            return []
        allowed_space_ids = {
            space.id
            for space in await self._allowed_spaces(
                space_level=space_level,
                extra_space_ids=extra_space_ids,
            )
        }
        if requested_space_ids:
            return sorted(allowed_space_ids.intersection(requested_space_ids))
        return sorted(allowed_space_ids)

    async def resolve_domain_count_scopes(
        self,
        domains: list[dict[str, Any]],
        extra_space_ids: Optional[list[int]] = None,
    ) -> list[dict[str, Any]]:
        allowed_space_ids = {
            space.id for space in await self._allowed_spaces(extra_space_ids=extra_space_ids)
        }
        scopes: list[dict[str, Any]] = []
        seen_codes: set[str] = set()
        for domain in domains:
            code = self._normalize_business_domain_code(domain.get("code"))
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            requested_space_ids = {
                int(space_id)
                for space_id in (domain.get("space_ids") or [])
                if isinstance(space_id, int) or (isinstance(space_id, str) and space_id.isdigit())
            }
            scopes.append({"code": code, "space_ids": sorted(allowed_space_ids.intersection(requested_space_ids))})
        return scopes

    async def count_visible_domain_files(self, domains: list[dict[str, Any]]) -> dict[str, int]:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/domain-file-counts",
            json={"domains": domains},
        )
        data = self._extract_success_data(response)
        raw_counts = data.get("counts") if isinstance(data, dict) else {}
        if not isinstance(raw_counts, dict):
            return {}
        return {
            self._normalize_business_domain_code(code): int(count or 0)
            for code, count in raw_counts.items()
            if self._normalize_business_domain_code(code)
        }

    async def resolve_category_count_scopes(
        self,
        categories: list[dict[str, Any]],
        extra_space_ids: Optional[list[int]] = None,
    ) -> list[dict[str, Any]]:
        allowed_space_ids = {
            space.id for space in await self._allowed_spaces(extra_space_ids=extra_space_ids)
        }
        scopes: list[dict[str, Any]] = []
        seen_codes: set[str] = set()
        for category in categories:
            code = self._normalize_document_type_code(category.get("code"))
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            requested_space_ids = {
                int(space_id)
                for space_id in (category.get("space_ids") or [])
                if isinstance(space_id, int) or (isinstance(space_id, str) and space_id.isdigit())
            }
            scopes.append({"code": code, "space_ids": sorted(allowed_space_ids.intersection(requested_space_ids))})
        return scopes

    async def count_visible_category_files(self, categories: list[dict[str, Any]]) -> dict[str, int]:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/category-file-counts",
            json={"categories": categories},
        )
        data = self._extract_success_data(response)
        raw_counts = data.get("counts") if isinstance(data, dict) else {}
        if not isinstance(raw_counts, dict):
            return {}
        return {
            self._normalize_document_type_code(code): int(count or 0)
            for code, count in raw_counts.items()
            if self._normalize_document_type_code(code)
        }

    def _resolve_document_chat_model_id(self, requested_model: str = "") -> int:
        config = self._config_service.get_config()
        raw_model = (requested_model or config.qa.selected_model or self._default_model).strip()
        try:
            model_id = int(raw_model)
        except (TypeError, ValueError) as err:
            raise ValueError("文档问答模型未配置或不是有效模型 ID") from err
        if model_id <= 0:
            raise ValueError("文档问答模型未配置或不是有效模型 ID")
        return model_id

    async def list_space_files(
        self,
        space_id: int,
        file_ext: Optional[str],
        document_type: Optional[str],
        tag: Optional[str],
        page: int,
        page_size: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> PagedKnowledgeFileData:
        if space_id not in await self._allowed_detail_space_ids(extra_space_ids):
            return PagedKnowledgeFileData(data=[], total=0, page=page, page_size=page_size)

        search_result = await self._fetch_space_files(space_id=space_id, keyword=None, tag_name=tag)
        filtered = self._filter_items(
            items=search_result.items,
            allowed_space_ids={space_id},
            file_ext=file_ext,
            document_type=document_type,
        )
        sorted_items = self._sort_items(filtered, sort="updated_at", keyword=None)
        space_name_map = await self.get_space_name_map(extra_space_ids)
        mapped = self._map_items(sorted_items, space_name_map)
        return self._paginate(mapped, page=page, page_size=page_size)

    async def search_files(
        self,
        q: Optional[str],
        tag: Optional[str],
        base_tag: Optional[str],
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        file_ext: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        extra_space_ids: Optional[list[int]] = None,
        document_type: Optional[str] = None,
        file_subcategory_code: Optional[str] = None,
        business_domain_code: Optional[str] = None,
        recommendation: Optional[str] = None,
        rerank_model_id: str | None = None,
        public_only: bool = False,
        fallback_to_public_spaces: bool = False,
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        normalized_tag = (tag or "").strip()
        normalized_base_tag = (base_tag or "").strip()
        effective_tag = normalized_base_tag or normalized_tag or None
        has_filter = bool(
            normalized_tag
            or normalized_base_tag
            or requested_space_ids
            or space_level
            or file_ext
            or document_type
            or file_subcategory_code
            or normalized_business_domain_code
            or recommendation
            or public_only
        )
        keyword = (q or "").strip()
        if not keyword and not has_filter:
            return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)

        if (
            self.is_public_latest_selected_request(keyword, recommendation)
            and discovery_scope != "public_and_department"
        ):
            return await self._search_shougang_portal_files(
                q=None,
                tag=effective_tag,
                space_ids=[],
                space_level="public",
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                recommendation=recommendation,
                rerank_model_id=rerank_model_id,
                sort=sort,
                cursor=cursor,
                limit=limit,
                public_only=True,
                discovery_scope="public",
            )

        if (
            keyword
            and self.is_latest_selected_scoped_request(recommendation)
            and discovery_scope != "public_and_department"
        ):
            return await self._search_shougang_portal_files(
                q=keyword,
                tag=effective_tag,
                space_ids=[],
                space_level="public",
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                recommendation=recommendation,
                rerank_model_id=rerank_model_id,
                sort=sort or "relevance",
                cursor=cursor,
                limit=limit,
                public_only=True,
                discovery_scope="public",
            )

        if public_only and not keyword:
            space_ids = await self._resolve_discovery_scope_space_ids(
                requested_space_ids=requested_space_ids,
                space_level="public",
                extra_space_ids=extra_space_ids,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            return await self._browse_shougang_portal_files(
                tag=effective_tag,
                space_ids=space_ids,
                space_level="public",
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                recommendation=recommendation,
                sort=sort,
                cursor=cursor,
                limit=limit,
                public_only=True,
                discovery_scope="public",
            )

        if discovery_scope == "legacy":
            space_ids = await self.resolve_requested_space_ids(
                requested_space_ids,
                space_level,
                extra_space_ids,
                fallback_to_public_spaces=fallback_to_public_spaces,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = self._effective_upstream_space_level(
                space_level,
                extra_space_ids,
            )
        else:
            if self.is_latest_selected_scoped_request(recommendation):
                # 最新精选由 BiSheng 权威派生公共库 + 有效部门库，不混入
                # 原有个人库/团队库。
                space_ids = []
            else:
                space_ids = await self._resolve_discovery_scope_space_ids(
                    requested_space_ids=requested_space_ids,
                    space_level=space_level,
                    extra_space_ids=extra_space_ids,
                    recommendation=recommendation,
                )
                if not space_ids:
                    return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = (
                "public" if discovery_scope == "public" else space_level
            )

        if (
            normalized_base_tag
            and normalized_tag
            and normalized_base_tag != normalized_tag
            and not keyword
            and not recommendation
        ):
            return await self._search_shougang_portal_files_with_filter_tag(
                tag=normalized_base_tag,
                space_ids=space_ids,
                space_level=upstream_space_level,
                sort=sort,
                cursor=cursor,
                limit=limit,
                filter_tag=normalized_tag,
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                discovery_scope=discovery_scope,
            )

        if keyword:
            return await self._search_shougang_portal_files(
                q=keyword,
                tag=effective_tag,
                space_ids=space_ids,
                space_level=upstream_space_level,
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                recommendation=recommendation,
                rerank_model_id=rerank_model_id,
                sort=sort or "relevance",
                cursor=cursor,
                limit=limit,
                public_only=public_only,
                discovery_scope=discovery_scope,
            )

        return await self._browse_shougang_portal_files(
            tag=effective_tag,
            space_ids=space_ids,
            space_level=upstream_space_level,
            file_ext=file_ext,
            document_type=document_type,
            file_subcategory_code=file_subcategory_code,
            business_domain_code=normalized_business_domain_code,
            recommendation=recommendation,
            sort=sort,
            cursor=cursor,
            limit=limit,
            discovery_scope=discovery_scope,
        )

    async def search_keyword_files(
        self,
        *,
        q: str,
        tag: Optional[str],
        base_tag: Optional[str],
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        extra_space_ids: Optional[list[int]],
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        keyword = q.strip()
        if not keyword:
            return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
        if discovery_scope == "legacy":
            space_ids = await self.resolve_requested_space_ids(
                requested_space_ids,
                space_level,
                extra_space_ids,
                fallback_to_public_spaces=False,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = self._effective_upstream_space_level(
                space_level,
                extra_space_ids,
            )
        else:
            space_ids = await self._resolve_discovery_scope_space_ids(
                requested_space_ids=requested_space_ids,
                space_level=space_level,
                extra_space_ids=extra_space_ids,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = (
                "public" if discovery_scope == "public" else space_level
            )
        return await self._search_shougang_portal_files(
            q=keyword,
            tag=(base_tag or tag or "").strip() or None,
            space_ids=space_ids,
            space_level=upstream_space_level,
            file_ext=file_ext,
            document_type=document_type,
            file_subcategory_code=file_subcategory_code,
            business_domain_code=self._normalize_business_domain_code(business_domain_code),
            recommendation=None,
            sort=sort,
            cursor=cursor,
            limit=limit,
            discovery_scope=discovery_scope,
        )

    async def advanced_search_files(
        self,
        *,
        tag: Optional[str],
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        all_keywords: Optional[str],
        exact_phrase: Optional[str],
        any_keywords: Optional[str],
        exclude_keywords: Optional[str],
        search_field: Literal["file_name", "summary", "tags"],
        updated_from: Optional[str],
        updated_to: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        extra_space_ids: Optional[list[int]],
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        if discovery_scope == "legacy":
            space_ids = await self.resolve_requested_space_ids(
                requested_space_ids,
                space_level,
                extra_space_ids,
                fallback_to_public_spaces=False,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = self._effective_upstream_space_level(
                space_level,
                extra_space_ids,
            )
        else:
            space_ids = await self._resolve_discovery_scope_space_ids(
                requested_space_ids=requested_space_ids,
                space_level=space_level,
                extra_space_ids=extra_space_ids,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = (
                "public" if discovery_scope == "public" else space_level
            )
        return await self._advanced_search_shougang_portal_files(
            tag=(tag or "").strip() or None,
            space_ids=space_ids,
            space_level=upstream_space_level,
            file_ext=file_ext,
            document_type=document_type,
            file_subcategory_code=file_subcategory_code,
            business_domain_code=self._normalize_business_domain_code(business_domain_code),
            all_keywords=all_keywords,
            exact_phrase=exact_phrase,
            any_keywords=any_keywords,
            exclude_keywords=exclude_keywords,
            search_field=search_field,
            updated_from=updated_from,
            updated_to=updated_to,
            sort=sort,
            cursor=cursor,
            limit=limit,
            discovery_scope=discovery_scope,
        )

    async def browse_files(
        self,
        *,
        tag: Optional[str],
        base_tag: Optional[str],
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        recommendation: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        extra_space_ids: Optional[list[int]],
        public_only: bool = False,
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        normalized_tag = (tag or "").strip()
        normalized_base_tag = (base_tag or "").strip()
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        if public_only:
            space_ids = await self._resolve_discovery_scope_space_ids(
                requested_space_ids=requested_space_ids,
                space_level="public",
                extra_space_ids=extra_space_ids,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            return await self._browse_shougang_portal_files(
                tag=normalized_base_tag or normalized_tag or None,
                space_ids=space_ids,
                space_level="public",
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                recommendation=recommendation,
                sort=sort,
                cursor=cursor,
                limit=limit,
                public_only=True,
                discovery_scope="public",
            )
        if discovery_scope == "legacy":
            space_ids = await self.resolve_requested_space_ids(
                requested_space_ids,
                space_level,
                extra_space_ids,
                fallback_to_public_spaces=False,
            )
            if not space_ids:
                return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = self._effective_upstream_space_level(
                space_level,
                extra_space_ids,
            )
        else:
            if self.is_latest_selected_scoped_request(recommendation):
                space_ids = []
            else:
                space_ids = await self._resolve_discovery_scope_space_ids(
                    requested_space_ids=requested_space_ids,
                    space_level=space_level,
                    extra_space_ids=extra_space_ids,
                    recommendation=recommendation,
                )
                if not space_ids:
                    return CursorKnowledgeFileData(data=[], has_more=False, next_cursor=None)
            upstream_space_level = (
                "public" if discovery_scope == "public" else space_level
            )
        if (
            normalized_base_tag
            and normalized_tag
            and normalized_base_tag != normalized_tag
            and not recommendation
        ):
            return await self._search_shougang_portal_files_with_filter_tag(
                tag=normalized_base_tag,
                space_ids=space_ids,
                space_level=upstream_space_level,
                sort=sort,
                cursor=cursor,
                limit=limit,
                filter_tag=normalized_tag,
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=normalized_business_domain_code,
                discovery_scope=discovery_scope,
            )
        return await self._browse_shougang_portal_files(
            tag=normalized_base_tag or normalized_tag or None,
            space_ids=space_ids,
            space_level=upstream_space_level,
            file_ext=file_ext,
            document_type=document_type,
            file_subcategory_code=file_subcategory_code,
            business_domain_code=normalized_business_domain_code,
            recommendation=recommendation,
            sort=sort,
            cursor=cursor,
            limit=limit,
            discovery_scope=discovery_scope,
        )

    async def _search_shougang_portal_files_with_filter_tag(
        self,
        *,
        tag: str,
        space_ids: list[int],
        space_level: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        filter_tag: str,
        file_ext: Optional[str] = None,
        document_type: Optional[str] = None,
        file_subcategory_code: Optional[str] = None,
        business_domain_code: Optional[str] = None,
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        page_limit = min(max(int(limit or 20), 1), self._page_size_limit)
        upstream_cursor, filtered_offset = self._parse_filtered_tag_cursor(cursor)
        collected: list[KnowledgeFileItem] = []
        fetch_limit = self._page_size_limit

        while True:
            result = await self._browse_shougang_portal_files(
                tag=tag,
                space_ids=space_ids,
                space_level=space_level,
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=business_domain_code,
                recommendation=None,
                sort=sort,
                cursor=upstream_cursor,
                limit=fetch_limit,
                discovery_scope=discovery_scope,
            )
            filtered_items = [
                item for item in result.data
                if self._matches_file_item_tag_name(item, filter_tag)
            ]
            if filtered_offset:
                filtered_items = filtered_items[filtered_offset:]

            remaining = page_limit - len(collected)
            if len(filtered_items) > remaining:
                collected.extend(filtered_items[:remaining])
                next_cursor = self._encode_filtered_tag_cursor(
                    upstream_cursor=upstream_cursor,
                    filtered_offset=filtered_offset + remaining,
                )
                return CursorKnowledgeFileData(data=collected, has_more=True, next_cursor=next_cursor)

            collected.extend(filtered_items)
            if len(collected) >= page_limit:
                next_cursor = (
                    self._encode_filtered_tag_cursor(upstream_cursor=result.next_cursor, filtered_offset=0)
                    if result.has_more and result.next_cursor
                    else None
                )
                return CursorKnowledgeFileData(
                    data=collected[:page_limit],
                    has_more=next_cursor is not None,
                    next_cursor=next_cursor,
                )

            if not result.has_more or not result.next_cursor:
                return CursorKnowledgeFileData(data=collected, has_more=False, next_cursor=None)

            upstream_cursor = result.next_cursor
            filtered_offset = 0

    @staticmethod
    def _parse_filtered_tag_cursor(cursor: Optional[str]) -> tuple[Optional[str], int]:
        if not cursor or not cursor.startswith(FILTERED_TAG_CURSOR_PREFIX):
            return cursor, 0
        payload = cursor[len(FILTERED_TAG_CURSOR_PREFIX):]
        try:
            padding = "=" * (-len(payload) % 4)
            decoded = base64.urlsafe_b64decode(f"{payload}{padding}".encode("ascii"))
            data = json.loads(decoded.decode("utf-8"))
        except (ValueError, TypeError, json.JSONDecodeError):
            return None, 0
        upstream_cursor = data.get("cursor") if isinstance(data, dict) else None
        filtered_offset = data.get("offset") if isinstance(data, dict) else 0
        try:
            parsed_offset = max(int(filtered_offset or 0), 0)
        except (TypeError, ValueError):
            parsed_offset = 0
        return (
            str(upstream_cursor) if upstream_cursor else None,
            parsed_offset,
        )

    @staticmethod
    def _encode_filtered_tag_cursor(*, upstream_cursor: Optional[str], filtered_offset: int) -> str:
        payload = json.dumps(
            {"cursor": upstream_cursor, "offset": max(int(filtered_offset or 0), 0)},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
        return f"{FILTERED_TAG_CURSOR_PREFIX}{encoded}"

    async def _search_tag_files_across_spaces(
        self,
        *,
        tag: str,
        space_ids: list[int],
        sort: str,
        cursor: Optional[str],
        limit: int,
        extra_space_ids: Optional[list[int]] = None,
        filter_tag: Optional[str] = None,
        file_ext: Optional[str] = None,
        document_type: Optional[str] = None,
        file_subcategory_code: Optional[str] = None,
        business_domain_code: Optional[str] = None,
    ) -> CursorKnowledgeFileData:
        search_results = await asyncio.gather(
            *[
                self._fetch_space_files(space_id=space_id, keyword=None, tag_name=tag)
                for space_id in space_ids
            ],
            return_exceptions=True,
        )
        raw_items: list[dict[str, Any]] = []
        seen: set[tuple[int, int]] = set()
        for result in search_results:
            if isinstance(result, Exception):
                continue
            for item in result.items:
                key = (int(item.get("knowledge_id", 0)), int(item.get("id", 0)))
                if key in seen:
                    continue
                seen.add(key)
                raw_items.append(item)

        filtered_items = self._filter_items(
            items=raw_items,
            allowed_space_ids=set(space_ids),
            file_ext=file_ext,
            document_type=document_type,
            file_subcategory_code=file_subcategory_code,
            business_domain_code=business_domain_code,
        )
        if filter_tag:
            filtered_items = [item for item in filtered_items if self._matches_tag_name(item, filter_tag)]
        sorted_items = self._sort_items(filtered_items, sort=sort, keyword=None)
        page_limit = min(max(int(limit or 20), 1), self._page_size_limit)
        start = self._parse_local_offset_cursor(cursor)
        end = start + page_limit
        space_name_map = await self.get_space_name_map(extra_space_ids)
        data = self._map_items(sorted_items[start:end], space_name_map)
        next_cursor = f"{LOCAL_OFFSET_CURSOR_PREFIX}{end}" if end < len(sorted_items) else None
        return CursorKnowledgeFileData(
            data=data,
            has_more=next_cursor is not None,
            next_cursor=next_cursor,
        )

    @staticmethod
    def _parse_local_offset_cursor(cursor: Optional[str]) -> int:
        if not cursor:
            return 0
        if not cursor.startswith(LOCAL_OFFSET_CURSOR_PREFIX):
            return 0
        try:
            return max(int(cursor[len(LOCAL_OFFSET_CURSOR_PREFIX):]), 0)
        except ValueError:
            return 0

    async def get_qa_tree_children(
        self,
        space_id: int,
        parent_id: int | None,
        cursor: str | None = None,
        page_size: int = 10,
        discovery_scope: PortalDiscoveryScope = "public_and_department",
    ) -> QaKnowledgeTreeNodeData:
        resolved_page_size = min(max(page_size, 1), self._page_size_limit)
        params: dict[str, Any] = {"page_size": resolved_page_size}
        if parent_id is not None:
            params["parent_id"] = parent_id
        if cursor:
            params["cursor"] = cursor
        if discovery_scope == "legacy":
            params.update(
                {
                    "file_status": [SUCCESS_STATUS],
                    "enrich_files": False,
                    "folder_count_mode": "shallow",
                }
            )
            path = f"/api/v1/knowledge/space/{space_id}/children"
        else:
            params["discovery_scope"] = discovery_scope
            path = f"/api/v1/knowledge/shougang-portal/qa/spaces/{space_id}/children"
        response = await self._bisheng.get_json(path, params=params)
        # 上游权限/不存在等业务错误经 HTTP 200 + body status_code 返回;
        # 显式检测并抛 BishengBusinessError,交由路由层翻译为 403。
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        nodes = [
            self._map_qa_tree_node(item, fallback_space_id=space_id, fallback_parent_id=parent_id)
            for item in raw_items
            if isinstance(item, dict)
        ]
        next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
        return QaKnowledgeTreeNodeData(
            data=nodes,
            page_size=int(data.get("page_size") or resolved_page_size) if isinstance(data, dict) else resolved_page_size,
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=next_cursor if isinstance(next_cursor, str) else None,
        )

    async def get_qa_tree_folder_stats(
        self,
        space_id: int,
        folder_ids: list[int],
        discovery_scope: PortalDiscoveryScope = "public_and_department",
    ) -> QaKnowledgeFolderStatsData:
        unique_folder_ids = list(dict.fromkeys(folder_ids))
        if discovery_scope == "legacy":
            path = f"/api/v1/knowledge/space/{space_id}/folder-stats"
            body = {
                "folder_ids": unique_folder_ids,
                "file_status": [SUCCESS_STATUS],
            }
        else:
            path = (
                f"/api/v1/knowledge/shougang-portal/qa/spaces/{space_id}"
                f"/folder-stats?discovery_scope={discovery_scope}"
            )
            body = {"folder_ids": unique_folder_ids}
        response = await self._bisheng.post_json(path, json=body)
        data = self._extract_success_data(response)
        raw_stats = data.get("stats") if isinstance(data, dict) else []
        if not isinstance(raw_stats, list):
            raw_stats = []
        return QaKnowledgeFolderStatsData(
            stats=[
                QaKnowledgeFolderStatsItem(
                    folder_id=self._int_value(item, "folder_id", "folderId"),
                    resolved_file_count=self._int_value(
                        item,
                        "resolved_file_count",
                        "visible_success_file_num",
                        "visibleSuccessFileNum",
                        "success_file_num",
                        "successFileNum",
                    ),
                )
                for item in raw_stats
                if isinstance(item, dict)
            ]
        )

    async def search_qa_files_by_name(
        self,
        q: str,
        space_ids: list[int],
        page: int = 1,
        page_size: int = 20,
        discovery_scope: PortalDiscoveryScope = "public_and_department",
    ) -> PagedKnowledgeFileData:
        normalized_q = q.strip()
        if not normalized_q or not space_ids:
            return PagedKnowledgeFileData(data=[], total=0, page=page, page_size=page_size)
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/qa/files/search",
            json={
                "q": normalized_q,
                "discovery_scope": discovery_scope,
                "space_ids": space_ids,
                "page": page,
                "page_size": min(max(page_size, 1), 100),
            },
        )
        data = response.get("data") or {}
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        return PagedKnowledgeFileData(
            data=self._map_shougang_portal_response_items(raw_items),
            total=int(data.get("total") or 0),
            page=int(data.get("page") or page),
            page_size=int(data.get("page_size") or page_size),
        )

    async def _fetch_shougang_portal_tags(
        self,
        space_ids: list[int],
        space_level: Optional[str],
        business_domain_code: Optional[str],
    ) -> list[str]:
        request_body = {
            "space_ids": space_ids,
            "space_level": space_level,
        }
        if business_domain_code:
            request_body["business_domain_code"] = business_domain_code
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/tags/search",
            json=request_body,
        )
        data = response.get("data") or {}
        tags = data.get("tags") if isinstance(data, dict) else []
        if not isinstance(tags, list):
            return []
        return sorted({str(tag) for tag in tags if str(tag)})

    async def _search_shougang_portal_files(
        self,
        q: Optional[str],
        tag: Optional[str],
        space_ids: list[int],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        recommendation: Optional[str],
        sort: str,
        cursor: Optional[str] = None,
        limit: int | None = None,
        public_only: bool = False,
        discovery_scope: PortalDiscoveryScope = "legacy",
        rerank_model_id: str | None = None,
    ) -> CursorKnowledgeFileData:
        request_body = {
            "discovery_scope": discovery_scope,
            "q": q,
            "tag": tag,
            "space_ids": space_ids,
            "space_level": space_level,
            "file_ext": file_ext,
            "sort": sort,
        }
        if limit is not None:
            request_body["cursor"] = cursor
            request_body["limit"] = min(max(int(limit or 20), 1), 100)
        if recommendation:
            request_body["recommendation"] = recommendation
        if public_only:
            request_body["public_only"] = True
        normalized_document_type = self._normalize_document_type_code(document_type)
        if normalized_document_type:
            request_body["document_type"] = normalized_document_type
        normalized_file_subcategory_code = self._normalize_document_type_code(file_subcategory_code)
        if normalized_file_subcategory_code:
            request_body["file_subcategory_code"] = normalized_file_subcategory_code
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        if normalized_business_domain_code:
            request_body["business_domain_code"] = normalized_business_domain_code
        if rerank_model_id is None:
            try:
                rerank_model_id = str(
                    self._config_service.get_config().search.rerank_model_id or ""
                ).strip()
            except Exception:
                logger.exception(
                    "读取门户搜索重排模型配置失败，使用空配置继续查询"
                )
                rerank_model_id = ""
        request_body["rerank_model_id"] = str(rerank_model_id or "").strip()
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/files/search",
            json=request_body,
        )
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
        return CursorKnowledgeFileData(
            data=self._map_shougang_portal_response_items(raw_items),
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=str(next_cursor) if next_cursor else None,
        )

    async def _advanced_search_shougang_portal_files(
        self,
        *,
        tag: Optional[str],
        space_ids: list[int],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        all_keywords: Optional[str],
        exact_phrase: Optional[str],
        any_keywords: Optional[str],
        exclude_keywords: Optional[str],
        search_field: Literal["file_name", "summary", "tags"],
        updated_from: Optional[str],
        updated_to: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        discovery_scope: PortalDiscoveryScope,
    ) -> CursorKnowledgeFileData:
        request_body = {
            "discovery_scope": discovery_scope,
            "tag": tag,
            "space_ids": space_ids,
            "space_level": space_level,
            "file_ext": file_ext,
            "all_keywords": all_keywords,
            "exact_phrase": exact_phrase,
            "any_keywords": any_keywords,
            "exclude_keywords": exclude_keywords,
            "search_field": search_field,
            "updated_from": updated_from,
            "updated_to": updated_to,
            "sort": sort,
            "cursor": cursor,
            "limit": min(max(int(limit or 20), 1), 100),
        }
        normalized_document_type = self._normalize_document_type_code(document_type)
        if normalized_document_type:
            request_body["document_type"] = normalized_document_type
        normalized_file_subcategory_code = self._normalize_document_type_code(file_subcategory_code)
        if normalized_file_subcategory_code:
            request_body["file_subcategory_code"] = normalized_file_subcategory_code
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        if normalized_business_domain_code:
            request_body["business_domain_code"] = normalized_business_domain_code
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/files/advanced-search",
            json=request_body,
        )
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
        return CursorKnowledgeFileData(
            data=self._map_shougang_portal_response_items(raw_items),
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=str(next_cursor) if next_cursor else None,
        )

    async def _browse_shougang_portal_files(
        self,
        tag: Optional[str],
        space_ids: list[int],
        space_level: Optional[str],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str],
        business_domain_code: Optional[str],
        recommendation: Optional[str],
        sort: str,
        cursor: Optional[str],
        limit: int,
        public_only: bool = False,
        discovery_scope: PortalDiscoveryScope = "legacy",
    ) -> CursorKnowledgeFileData:
        request_body = {
            "discovery_scope": discovery_scope,
            "tag": tag,
            "space_ids": space_ids,
            "space_level": space_level,
            "file_ext": file_ext,
            "sort": sort,
            "cursor": cursor,
            "limit": min(max(int(limit or 20), 1), 100),
        }
        if recommendation:
            request_body["recommendation"] = recommendation
        if public_only:
            request_body["public_only"] = True
        normalized_document_type = self._normalize_document_type_code(document_type)
        if normalized_document_type:
            request_body["document_type"] = normalized_document_type
        normalized_file_subcategory_code = self._normalize_document_type_code(file_subcategory_code)
        if normalized_file_subcategory_code:
            request_body["file_subcategory_code"] = normalized_file_subcategory_code
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        if normalized_business_domain_code:
            request_body["business_domain_code"] = normalized_business_domain_code
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/files/browse",
            json=request_body,
        )
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        next_cursor = data.get("next_cursor") if isinstance(data, dict) else None
        return CursorKnowledgeFileData(
            data=self._map_shougang_portal_response_items(raw_items),
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=str(next_cursor) if next_cursor else None,
        )

    @staticmethod
    def _map_shougang_portal_response_items(raw_items: list) -> list[KnowledgeFileItem]:
        items: list[KnowledgeFileItem] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            content_access = str(item.get("content_access") or "allowed")
            is_department_file = bool(item.get("is_department_file", False))
            content_allowed = (
                content_access in {"allowed", "check_required"}
                or not is_department_file
            )
            capabilities = (
                {
                    str(key): bool(value)
                    for key, value in item["capabilities"].items()
                }
                if isinstance(item.get("capabilities"), dict)
                else {}
            )
            items.append(
                KnowledgeFileItem(
                id=int(item.get("id") or 0),
                space_id=int(item.get("space_id") or item.get("knowledge_id") or 0),
                space_level=str(item.get("space_level") or item.get("spaceLevel") or ""),
                title=str(item.get("title") or item.get("file_name") or ""),
                summary=(
                    str(item.get("summary") or item.get("abstract") or "")
                    if content_allowed
                    else ""
                ),
                source=str(item.get("source") or ""),
                updated_at=str(item.get("updated_at") or item.get("update_time") or ""),
                tag_infos=KnowledgeService._extract_file_tag_infos(item),
                file_ext=str(item.get("file_ext") or ""),
                file_size=str(item.get("file_size") or "") if content_allowed else "",
                file_encoding=(
                    str(item.get("file_encoding") or "")
                    if content_allowed
                    else ""
                ),
                file_subcategory_code=KnowledgeService._extract_file_subcategory_code(item),
                folder_path=str(item.get("folder_path") or ""),
                source_path=(
                    str(item.get("source_path") or "")
                    if content_allowed
                    else ""
                ),
                can_download=bool(item.get("can_download", False)),
                content_access=content_access,
                access_source=(
                    str(item.get("access_source"))
                    if item.get("access_source") is not None
                    else None
                ),
                is_department_file=is_department_file,
                entry_type=str(item.get("entry_type") or "normal"),
                entry_status=str(item.get("entry_status") or "active"),
                canonical_document_id=(
                    int(item["canonical_document_id"])
                    if item.get("canonical_document_id") is not None
                    else None
                ),
                canonical_version_id=(
                    int(item["canonical_version_id"])
                    if item.get("canonical_version_id") is not None
                    else None
                ),
                manager_file_id=(
                    int(item["manager_file_id"])
                    if item.get("manager_file_id") is not None
                    and capabilities.get("can_edit_content", False)
                    else None
                ),
                manager_space_id=(
                    int(item["manager_space_id"])
                    if item.get("manager_space_id") is not None
                    else None
                ),
                desired_content_generation=int(
                    item.get("desired_content_generation") or 0
                ),
                applied_content_generation=int(
                    item.get("applied_content_generation") or 0
                ),
                desired_entry_generation=int(
                    item.get("desired_entry_generation") or 0
                ),
                applied_entry_generation=int(
                    item.get("applied_entry_generation") or 0
                ),
                projection_status=str(
                    item.get("projection_status") or "ready"
                ),
                projection_ready=bool(item.get("projection_ready", True)),
                capabilities=capabilities,
            )
            )
        return items

    async def get_file_detail(
        self,
        space_id: int,
        file_id: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> Optional[KnowledgeFileDetail]:
        if space_id not in await self._allowed_detail_space_ids(extra_space_ids):
            return None

        response = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}"
        )
        data = self._extract_success_data(response)
        raw_item = data.get("data") if isinstance(data, dict) else None
        if not isinstance(raw_item, dict):
            return None

        mapped_items = self._map_shougang_portal_response_items([raw_item])
        if not mapped_items:
            return None
        item = mapped_items[0]
        if item.space_id != space_id:
            return None

        source = item.source or (await self.get_space_name_map(extra_space_ids)).get(space_id, str(space_id))
        return KnowledgeFileDetail(
            id=item.id,
            space_id=space_id,
            title=item.title,
            summary=item.summary,
            source=source,
            updated_at=item.updated_at,
            tag_infos=item.tag_infos,
            file_ext=item.file_ext,
            file_size=item.file_size,
            file_encoding=item.file_encoding,
            file_subcategory_code=item.file_subcategory_code,
            folder_path=item.folder_path,
            source_path=item.source_path,
            can_download=item.can_download,
            content_access=item.content_access,
            access_source=item.access_source,
            is_department_file=item.is_department_file,
            entry_type=item.entry_type,
            entry_status=item.entry_status,
            canonical_document_id=item.canonical_document_id,
            canonical_version_id=item.canonical_version_id,
            manager_file_id=item.manager_file_id,
            manager_space_id=item.manager_space_id,
            desired_content_generation=item.desired_content_generation,
            applied_content_generation=item.applied_content_generation,
            desired_entry_generation=item.desired_entry_generation,
            applied_entry_generation=item.applied_entry_generation,
            projection_status=item.projection_status,
            projection_ready=item.projection_ready,
            capabilities=item.capabilities,
            space=KnowledgeFileSpace(id=space_id, name=source),
        )

    async def refresh_cached_home_sections(
        self,
        sections: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """重新解析缓存中的持久文件引用，避免旧入口或旧代际直接放行。"""

        semaphore = asyncio.Semaphore(8)
        try:
            allowed_space_ids = await self._allowed_detail_space_ids()
        except Exception:
            logger.exception("刷新门户首页缓存的可见知识库范围失败")
            allowed_space_ids = set()
        allowed_space_id_list = sorted(allowed_space_ids)

        async def refresh_item(
            cached_item: Any,
        ) -> dict[str, Any] | None:
            if not isinstance(cached_item, dict):
                return None
            try:
                space_id = int(cached_item.get("space_id") or 0)
                file_id = int(cached_item.get("id") or 0)
            except (TypeError, ValueError):
                return None
            if space_id <= 0 or file_id <= 0:
                return None
            if space_id not in allowed_space_ids:
                return None

            try:
                async with semaphore:
                    detail = await self.get_file_detail(
                        space_id=space_id,
                        file_id=file_id,
                        extra_space_ids=allowed_space_id_list,
                    )
            except Exception:
                logger.exception(
                    "刷新门户首页缓存文件引用失败",
                    extra={
                        "portal_space_id": space_id,
                        "portal_file_id": file_id,
                    },
                )
                return None
            if detail is None:
                return None

            cached_document_id = cached_item.get(
                "canonical_document_id"
            )
            if cached_document_id is not None:
                try:
                    cached_document_id = int(cached_document_id)
                except (TypeError, ValueError):
                    return None
                if (
                    detail.canonical_document_id is None
                    or detail.canonical_document_id
                    != cached_document_id
                ):
                    return None
            return detail.model_dump(mode="json")

        refreshed_sections: list[dict[str, Any]] = []
        for section in sections:
            if not isinstance(section, dict):
                continue
            raw_items = section.get("items")
            if not isinstance(raw_items, list):
                continue
            refreshed_items = await asyncio.gather(
                *(refresh_item(item) for item in raw_items)
            )
            refreshed_section: dict[str, Any] = {
                "tag": str(section.get("tag") or ""),
                "items": [
                    item for item in refreshed_items if item is not None
                ],
            }
            recommendation_mode = section.get("recommendation_mode")
            if recommendation_mode:
                refreshed_section["recommendation_mode"] = (
                    recommendation_mode
                )
            refreshed_sections.append(refreshed_section)
        return refreshed_sections

    async def open_portal_pdf_download_stream(
        self,
        *,
        space_id: int,
        file_id: int,
        entry_point: str,
        share_access_grant: str = "",
        timeout_seconds: float,
    ) -> httpx.Response:
        headers = (
            {"X-Portal-Share-Access-Grant": share_access_grant}
            if share_access_grant
            else None
        )
        return await self._bisheng.open_authenticated_download_stream(
            f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}/download",
            params={"entry_point": entry_point or "other"},
            headers=headers,
            timeout_seconds=timeout_seconds,
        )

    async def get_file_preview(
        self,
        space_id: int,
        file_id: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> Optional[FilePreviewManifest]:
        detail = await self.get_file_detail(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        if detail is None:
            return None

        normalized_ext = self._normalize_ext(detail.file_ext)
        raw_preview = await self._get_raw_file_preview(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        download_url = raw_preview.original_url if raw_preview else ""

        if normalized_ext in UNSUPPORTED_PREVIEW_EXTENSIONS:
            return FilePreviewManifest(
                mode="unsupported",
                download_url=download_url,
                reason="当前文件类型暂不支持在线预览，请下载原文件查看。",
                supports_chunks_fallback=False,
            )

        source = await self.resolve_preview_content_source(
            space_id=space_id,
            file_id=file_id,
            raw_preview=raw_preview,
            file_ext=normalized_ext,
            extra_space_ids=extra_space_ids,
        )
        if source is None:
            if normalized_ext in LEGACY_WORD_EXTENSIONS:
                return FilePreviewManifest(
                    mode="unsupported",
                    download_url=download_url,
                    reason="当前文件类型暂不支持在线预览，请下载原文件查看。",
                    supports_chunks_fallback=False,
                )
            return FilePreviewManifest(
                mode="chunks",
                download_url=download_url,
                reason="当前文件暂未生成可直接预览的资源，已回退到正文分段内容。",
                supports_chunks_fallback=True,
            )

        mode = self._infer_preview_mode(source.url, normalized_ext)
        if mode in {"unsupported", "chunks"}:
            if normalized_ext in LEGACY_WORD_EXTENSIONS:
                return FilePreviewManifest(
                    mode="unsupported",
                    download_url=download_url or source.url,
                    reason="当前文件类型暂不支持在线预览，请下载原文件查看。",
                    supports_chunks_fallback=False,
                )
            return FilePreviewManifest(
                mode="chunks",
                download_url=download_url or source.url,
                reason="当前文件缺少可直接解析的预览资源，已回退到正文分段内容。",
                supports_chunks_fallback=True,
            )

        return FilePreviewManifest(
            mode=mode,
            download_url=download_url or source.url,
            viewer_url=source.url if self._is_frontend_proxy_asset_url(source.url) else "",
            source_kind=source.source_kind,
            supports_chunks_fallback=normalized_ext not in LEGACY_WORD_EXTENSIONS,
        )

    async def resolve_preview_content_source(
        self,
        space_id: int,
        file_id: int,
        requested_source_kind: Optional[FilePreviewSourceKind] = None,
        raw_preview: Optional[FilePreviewData] = None,
        file_ext: Optional[str] = None,
        extra_space_ids: Optional[list[int]] = None,
    ) -> Optional[ResolvedPreviewSource]:
        normalized_ext = self._normalize_ext(file_ext or "")
        if normalized_ext in UNSUPPORTED_PREVIEW_EXTENSIONS:
            return None

        preview_data = raw_preview or await self._get_raw_file_preview(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        if requested_source_kind:
            url = await self._get_preview_source_url(
                source_kind=requested_source_kind,
                raw_preview=preview_data,
                space_id=space_id,
                file_id=file_id,
            )
            if url:
                return ResolvedPreviewSource(source_kind=requested_source_kind, url=url)
            return None

        for source_kind in self._get_preview_source_priority(normalized_ext):
            url = await self._get_preview_source_url(
                source_kind=source_kind,
                raw_preview=preview_data,
                space_id=space_id,
                file_id=file_id,
            )
            if url:
                return ResolvedPreviewSource(source_kind=source_kind, url=url)
        return None

    async def _get_raw_file_preview(
        self,
        space_id: int,
        file_id: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> Optional[FilePreviewData]:
        detail = await self.get_file_detail(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        if detail is None:
            return None
        preview_resp = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}/preview",
            headers=PORTAL_BFF_TELEMETRY_HEADERS,
        )
        data = preview_resp.get("data") or {}
        if not data:
            return None
        normalized = {
            **data,
            "original_url": str(data.get("original_url") or "").strip(),
            "preview_url": str(data.get("preview_url") or "").strip(),
            "pdf_preview_url": str(data.get("pdf_preview_url") or "").strip(),
        }
        return FilePreviewData.model_validate(normalized)

    async def _get_preview_source_url(
        self,
        source_kind: FilePreviewSourceKind,
        raw_preview: Optional[FilePreviewData],
        space_id: int,
        file_id: int,
    ) -> str:
        if source_kind == "pdf_preview_url":
            return raw_preview.pdf_preview_url if raw_preview else ""
        if source_kind == "preview_url":
            return raw_preview.preview_url if raw_preview else ""
        if source_kind == "original_url":
            return raw_preview.original_url if raw_preview else ""
        if source_kind == "preview_task":
            return await self._resolve_preview_task_url(space_id=space_id, file_id=file_id)
        return ""

    def _get_preview_source_priority(self, file_ext: str) -> tuple[FilePreviewSourceKind, ...]:
        if file_ext == "pdf" or file_ext in IMAGE_EXTENSIONS:
            return ("preview_url", "original_url", "preview_task")
        # Word files: prefer bisheng's LibreOffice-rendered PDF — it lays the page out
        # like Word does, unlike rendering the docx in the browser (which drops e-seals
        # and shape positioning). Empty pdf_preview_url falls straight through to the
        # previous behaviour, so files without a PDF are unaffected.
        if file_ext in LEGACY_WORD_EXTENSIONS:
            return ("pdf_preview_url", "preview_url", "original_url", "preview_task")
        if file_ext == "docx":
            return ("pdf_preview_url", "original_url", "preview_url", "preview_task")
        # Presentations: bisheng converts them to PDF and serves it via preview_url
        # (pdf_preview_url is currently produced only for Word, kept first for
        # forward-compatibility). The original .ppt/.pptx is not browser-previewable,
        # so it is not in the priority list.
        if file_ext in PPT_EXTENSIONS:
            return ("pdf_preview_url", "preview_url", "preview_task")
        if (
            file_ext in SPREADSHEET_EXTENSIONS
            or file_ext in MARKDOWN_EXTENSIONS
            or file_ext in HTML_EXTENSIONS
            or file_ext in TEXT_EXTENSIONS
        ):
            return ("original_url", "preview_url", "preview_task")
        return ("preview_url", "original_url", "preview_task")

    async def _resolve_preview_task_url(self, space_id: int, file_id: int) -> str:
        cache_key = (space_id, file_id)
        cached = PREVIEW_TASK_CACHE.get(cache_key)
        if cached and cached.expires_at > time.monotonic():
            return cached.file_url

        trigger_response = await self._trigger_preview_task(space_id=space_id, file_id=file_id)
        if not trigger_response:
            return ""

        direct_file_url = self._extract_preview_task_file_url(trigger_response)
        if direct_file_url:
            PREVIEW_TASK_CACHE[cache_key] = CachedPreviewTaskResult(
                file_url=direct_file_url,
                expires_at=time.monotonic() + PREVIEW_TASK_CACHE_TTL_SECONDS,
            )
            return direct_file_url

        task_id = self._extract_preview_task_id(trigger_response)
        if not task_id:
            return ""

        for _ in range(PREVIEW_TASK_POLL_ATTEMPTS):
            status_response = await self._poll_preview_task(task_id)
            if not status_response:
                return ""
            file_url = self._extract_preview_task_file_url(status_response)
            if file_url:
                PREVIEW_TASK_CACHE[cache_key] = CachedPreviewTaskResult(
                    file_url=file_url,
                    expires_at=time.monotonic() + PREVIEW_TASK_CACHE_TTL_SECONDS,
                )
                return file_url
            if self._is_preview_task_failed(status_response):
                return ""
            await asyncio.sleep(PREVIEW_TASK_POLL_DELAY_SECONDS)

        return ""

    async def _trigger_preview_task(self, space_id: int, file_id: int) -> Optional[dict[str, Any]]:
        payload_candidates = (
            {"knowledge_id": space_id, "file_id": file_id},
            {"space_id": space_id, "file_id": file_id},
            {"knowledge_id": space_id, "file_ids": [file_id]},
        )
        for payload in payload_candidates:
            try:
                return await self._bisheng.post_json("/api/v1/knowledge/preview", json=payload)
            except Exception:
                continue
        return None

    async def _poll_preview_task(self, task_id: str) -> Optional[dict[str, Any]]:
        params_candidates = ({"task_id": task_id}, {"id": task_id})
        for params in params_candidates:
            try:
                return await self._bisheng.get_json("/api/v1/knowledge/preview/status", params=params)
            except Exception:
                continue
        return None

    def _extract_preview_task_id(self, payload: dict[str, Any]) -> str:
        data = payload.get("data") or {}
        for key in ("task_id", "preview_task_id"):
            value = data.get(key)
            if value not in (None, ""):
                return str(value)

        for container_key in ("task", "preview_task", "result"):
            container = data.get(container_key)
            if isinstance(container, dict):
                for key in ("task_id", "preview_task_id", "id"):
                    value = container.get(key)
                    if value not in (None, ""):
                        return str(value)
        return ""

    def _extract_preview_task_file_url(self, payload: dict[str, Any]) -> str:
        values = self._collect_nested_values(payload.get("data") or {}, {"file_url", "preview_url", "url"})
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    @staticmethod
    def _is_frontend_proxy_asset_url(url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme or parsed.netloc:
            return False
        return parsed.path.startswith(FRONTEND_PROXY_ASSET_PATH_PREFIXES)

    def _is_preview_task_failed(self, payload: dict[str, Any]) -> bool:
        statuses = self._collect_nested_values(payload.get("data") or {}, {"status", "state", "task_status"})
        for status in statuses:
            normalized_status = self._normalize_ext(str(status))
            if normalized_status in PREVIEW_TASK_FAILURE_STATUSES:
                return True
        return False

    def _infer_preview_mode(self, source_url: str, fallback_ext: str) -> FilePreviewMode:
        parsed_path = urlparse(source_url).path
        source_ext = self._get_file_ext(parsed_path)
        normalized_ext = self._normalize_ext(source_ext or fallback_ext)
        if normalized_ext == "pdf":
            return "pdf"
        if normalized_ext == "docx" or normalized_ext in LEGACY_WORD_EXTENSIONS:
            return "docx"
        if normalized_ext in SPREADSHEET_EXTENSIONS:
            return "spreadsheet"
        if normalized_ext in MARKDOWN_EXTENSIONS:
            return "markdown"
        if normalized_ext in HTML_EXTENSIONS:
            return "html"
        if normalized_ext in TEXT_EXTENSIONS:
            return "text"
        if normalized_ext in IMAGE_EXTENSIONS:
            return "image"
        if normalized_ext in UNSUPPORTED_PREVIEW_EXTENSIONS:
            return "unsupported"
        return "chunks"

    def _collect_nested_values(self, node: Any, keys: set[str]) -> list[Any]:
        values: list[Any] = []

        def walk(current: Any):
            if isinstance(current, dict):
                for key, value in current.items():
                    if key in keys and value not in (None, "", [], {}):
                        values.append(value)
                    if isinstance(value, (dict, list)):
                        walk(value)
            elif isinstance(current, list):
                for item in current:
                    walk(item)

        walk(node)
        return values

    def _normalize_ext(self, ext: str) -> str:
        return ext.strip().lower()

    async def get_file_chunks(
        self,
        space_id: int,
        file_id: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> list[FileChunkItem]:
        detail = await self.get_file_detail(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        if detail is None:
            return []

        page = 1
        chunks: list[FileChunkItem] = []
        total = 0
        while True:
            response = await self._bisheng.get_json(
                f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}/chunks",
                params={
                    "page": page,
                    "limit": self._page_size_limit,
                },
            )
            data = response.get("data") or {}
            raw_items = data.get("data") or []
            total = int(data.get("total") or 0)
            if not raw_items:
                break
            for index, item in enumerate(raw_items):
                metadata = item.get("metadata") or {}
                chunks.append(
                    FileChunkItem(
                        chunk_index=int(metadata.get("chunk_index") or index),
                        text=str(item.get("text") or ""),
                    )
                )
            if len(chunks) >= total:
                break
            page += 1

        chunks.sort(key=lambda item: item.chunk_index)
        return chunks

    async def get_related_files(
        self,
        space_id: int,
        file_id: int,
        limit: int,
        extra_space_ids: Optional[list[int]] = None,
    ) -> RelatedKnowledgeFileData:
        if space_id not in await self._allowed_detail_space_ids(extra_space_ids):
            return RelatedKnowledgeFileData(data=[], total=0)

        response = await self._bisheng.get_json(
            f"/api/v1/knowledge/shougang-portal/files/{space_id}/{file_id}/related",
            params={"limit": limit},
        )
        data = self._extract_success_data(response)
        raw_items = data.get("data") if isinstance(data, dict) else []
        if not isinstance(raw_items, list):
            raw_items = []
        items = [
            item
            for item in self._map_shougang_portal_response_items(raw_items)
            if item.space_id == space_id and item.id != file_id
        ]
        safe_limit = max(int(limit or 3), 0)
        items = items[:safe_limit]
        total = int(data.get("total") or len(items)) if isinstance(data, dict) else len(items)
        return RelatedKnowledgeFileData(data=items, total=min(total, len(items)))

    async def _fetch_space_files(
        self,
        space_id: int,
        keyword: Optional[str],
        tag_name: Optional[str],
    ) -> SpaceSearchResult:
        tag_ids = None
        if tag_name:
            tag_lookup = await self._get_space_tag_lookup(space_id)
            tag_id = tag_lookup.get(tag_name)
            if tag_id is None:
                return SpaceSearchResult(items=[], total=0)
            tag_ids = [tag_id]

        page = 1
        page_size = self._page_size_limit
        all_items: list[dict[str, Any]] = []
        total = 0
        while True:
            params: dict[str, Any] = {
                "page": page,
                "page_size": page_size,
                "file_status": SUCCESS_STATUS,
            }
            if keyword:
                params["keyword"] = keyword
            if tag_ids:
                params["tag_ids"] = tag_ids
            try:
                response = await self._bisheng.get_json(f"/api/v1/knowledge/space/{space_id}/search", params=params)
            except httpx.HTTPError:
                return SpaceSearchResult(items=[], total=0)
            data = response.get("data") or {}
            batch = data.get("data") or []
            total = int(data.get("total") or 0)
            all_items.extend(batch)
            if len(all_items) >= total or not batch:
                break
            page += 1
        return SpaceSearchResult(items=all_items, total=total)

    async def _get_space_tag_lookup(self, space_id: int) -> dict[str, int]:
        try:
            response = await self._bisheng.get_json(f"/api/v1/knowledge/space/{space_id}/tag")
        except httpx.HTTPError:
            return {}
        tags = response.get("data") or []
        return {tag["name"]: int(tag["id"]) for tag in tags if "name" in tag and "id" in tag}

    async def _get_file_search_item(self, space_id: int, file_id: int, file_name: str) -> dict[str, Any] | None:
        search_result = await self._fetch_space_files(space_id=space_id, keyword=file_name or None, tag_name=None)
        for item in search_result.items:
            if int(item.get("id", 0)) == file_id:
                return item
        return None

    def _filter_items(
        self,
        items: list[dict[str, Any]],
        allowed_space_ids: set[int],
        file_ext: Optional[str],
        document_type: Optional[str],
        file_subcategory_code: Optional[str] = None,
        business_domain_code: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        normalized_document_type = self._normalize_document_type_code(document_type)
        normalized_file_subcategory_code = self._normalize_document_type_code(file_subcategory_code)
        normalized_business_domain_code = self._normalize_business_domain_code(business_domain_code)
        filtered: list[dict[str, Any]] = []
        for item in items:
            if int(item.get("knowledge_id", 0)) not in allowed_space_ids:
                continue
            if int(item.get("file_type", -1)) != FILE_TYPE:
                continue
            if int(item.get("status", -1)) != SUCCESS_STATUS:
                continue
            file_name = item.get("file_name") or ""
            if file_ext and self._get_file_ext(file_name) != file_ext:
                continue
            if normalized_file_subcategory_code and self._extract_file_subcategory_code(item) != normalized_file_subcategory_code:
                continue
            if normalized_document_type and not self._matches_document_type(item, normalized_document_type):
                continue
            if normalized_business_domain_code and not self._matches_business_domain_code(
                item,
                normalized_business_domain_code,
            ):
                continue
            filtered.append(item)
        return filtered

    def _sort_items(self, items: list[dict[str, Any]], sort: str, keyword: Optional[str]) -> list[dict[str, Any]]:
        if sort == UPDATED_AT_ASC_SORT:
            return sorted(items, key=lambda item: self._serialize_datetime(item.get("update_time")))
        if sort in UPDATED_AT_DESC_SORTS or not keyword:
            return sorted(items, key=lambda item: self._serialize_datetime(item.get("update_time")), reverse=True)

        keyword_lower = keyword.lower()

        def score(item: dict[str, Any]) -> tuple[int, str]:
            title = (item.get("file_name") or "").lower()
            summary = (item.get("abstract") or "").lower()
            tags = [tag.lower() for tag in self._extract_tag_names(item)]
            hit_score = 0
            if title == keyword_lower:
                hit_score += 4
            if keyword_lower in title:
                hit_score += 3
            if keyword_lower in summary:
                hit_score += 2
            if any(keyword_lower in tag for tag in tags):
                hit_score += 1
            return hit_score, self._serialize_datetime(item.get("update_time"))

        return sorted(items, key=score, reverse=True)

    @classmethod
    def _matches_document_type(cls, item: dict[str, Any], document_type: str) -> bool:
        return (
            cls._extract_document_type_code(item) == document_type
            or cls._extract_file_subcategory_code(item) == document_type
        )

    @classmethod
    def _matches_tag_name(cls, item: dict[str, Any], tag_name: str) -> bool:
        normalized = tag_name.strip()
        if not normalized:
            return True
        return normalized in cls._extract_tag_names(item)

    @staticmethod
    def _matches_file_item_tag_name(item: KnowledgeFileItem, tag_name: str) -> bool:
        normalized = tag_name.strip()
        if not normalized:
            return True
        names: list[str] = []
        for tag in item.tag_infos or []:
            if isinstance(tag, FileTag):
                names.append(tag.tag_name)
            elif isinstance(tag, dict):
                name = tag.get("tag_name") or tag.get("name")
                if name:
                    names.append(str(name))
            elif tag not in (None, ""):
                names.append(str(tag))
        return normalized in names

    @classmethod
    def _matches_business_domain_code(cls, item: dict[str, Any], business_domain_code: str) -> bool:
        return cls._extract_business_domain_code(item) == business_domain_code

    def _map_items(
        self,
        items: list[dict[str, Any]],
        space_name_map: Optional[dict[int, str]] = None,
    ) -> list[KnowledgeFileItem]:
        space_name_map = space_name_map or {}
        mapped: list[KnowledgeFileItem] = []
        for item in items:
            space_id = int(item.get("knowledge_id", 0))
            file_name = item.get("file_name") or ""
            mapped.append(
                KnowledgeFileItem(
                    id=int(item.get("id", 0)),
                    space_id=space_id,
                    space_level=str(item.get("space_level") or item.get("spaceLevel") or ""),
                    title=self._clean_title(file_name),
                    summary=item.get("abstract") or "",
                    source=space_name_map.get(space_id, str(space_id)),
                    updated_at=self._serialize_datetime(item.get("update_time")),
                    tag_infos=self._extract_file_tag_infos(item),
                    file_ext=self._get_file_ext(file_name),
                    file_size=self._extract_file_size_label(item),
                    file_encoding=self._extract_file_encoding(item),
                    file_subcategory_code=self._extract_file_subcategory_code(item),
                    source_path=str(item.get("source_path") or ""),
                )
            )
        return mapped

    def _map_qa_tree_node(
        self,
        item: dict[str, Any],
        fallback_space_id: int,
        fallback_parent_id: int | None,
    ) -> QaKnowledgeTreeNode:
        file_type = self._int_value(item, "file_type", "type")
        is_file = file_type == FILE_TYPE
        file_name = self._str_value(item, "file_name", "name", "title")
        node_id = self._int_value(item, "id", "file_id")
        space_id = self._int_value(item, "knowledge_id", "space_id", "knowledgeId", "spaceId") or fallback_space_id
        parent_id = self._int_value(item, "parent_id", "parentId")
        resolved_file_count = self._int_value(
            item,
            "visible_success_file_num",
            "success_file_num",
            "resolved_file_count",
            "file_num",
            "file_count",
            "children_count",
        )
        raw_has_children = item.get("has_children")
        if raw_has_children is not None and not is_file:
            has_children = bool(raw_has_children)
        else:
            has_children = (not is_file) and resolved_file_count > 0
        return QaKnowledgeTreeNode(
            id=node_id,
            space_id=space_id,
            parent_id=parent_id or fallback_parent_id,
            type="file" if is_file else "folder",
            name=file_name or str(node_id),
            path=self._str_value(item, "source_path", "folder_path", "file_level_path", "path"),
            file_ext=self._get_file_ext(file_name) if is_file else "",
            selectable=bool(item.get("selectable", True)),
            disabled_reason=str(item.get("disabled_reason") or ""),
            has_children=has_children,
            resolved_file_count=1 if is_file else resolved_file_count,
        )

    def _paginate(
        self,
        items: list[KnowledgeFileItem],
        page: int,
        page_size: int,
    ) -> PagedKnowledgeFileData:
        start = max(page - 1, 0) * page_size
        end = start + page_size
        return PagedKnowledgeFileData(
            data=items[start:end],
            total=len(items),
            page=page,
            page_size=page_size,
        )

    @staticmethod
    def _extract_tag_names(item: dict[str, Any]) -> list[str]:
        tags = item.get("tags") or []
        names: list[str] = []
        for tag in tags:
            if isinstance(tag, dict):
                name = tag.get("tag_name") or tag.get("name")
                if name:
                    names.append(str(name))
                continue
            if tag not in (None, ""):
                names.append(str(tag))
        return names

    @staticmethod
    def _extract_file_tag_infos(item: dict[str, Any]) -> list[FileTag]:
        result: list[FileTag] = []
        indexes_by_name: dict[str, int] = {}

        def append_tag(name: Any, resource_type: Any = "") -> None:
            tag_name = str(name or "").strip()
            if not tag_name:
                return
            tag_resource_type = str(resource_type or "")
            existing_index = indexes_by_name.get(tag_name)
            if existing_index is None:
                indexes_by_name[tag_name] = len(result)
                result.append(FileTag(tag_name=tag_name, resource_type=tag_resource_type))
                return
            if not result[existing_index].resource_type and tag_resource_type:
                result[existing_index] = FileTag(tag_name=tag_name, resource_type=tag_resource_type)

        for tag in item.get("tag_infos") or []:
            if isinstance(tag, dict):
                append_tag(tag.get("tag_name") or tag.get("name"), tag.get("resource_type"))
            elif isinstance(tag, FileTag):
                append_tag(tag.tag_name, tag.resource_type)

        for tag in item.get("tags") or []:
            if not isinstance(tag, dict):
                append_tag(tag)
                continue
            name = tag.get("tag_name") or tag.get("name")
            append_tag(name, tag.get("resource_type"))
        return result

    @staticmethod
    def _extract_file_size_label(*items: dict[str, Any] | None) -> str:
        value = KnowledgeService._first_value_from_items(items, FILE_SIZE_KEYS)
        if value is None:
            return ""
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
        try:
            size = float(value)
        except (TypeError, ValueError):
            return str(value).strip()
        if size < 0:
            return ""
        units = ("B", "KB", "MB", "GB", "TB")
        unit_index = 0
        while size >= 1024 and unit_index < len(units) - 1:
            size /= 1024
            unit_index += 1
        if unit_index == 0:
            return f"{int(size)}{units[unit_index]}"
        return f"{size:.2f}".rstrip("0").rstrip(".") + units[unit_index]

    @staticmethod
    def _extract_file_encoding(*items: dict[str, Any] | None) -> str:
        value = KnowledgeService._first_value_from_items(items, FILE_ENCODING_KEYS)
        return str(value).strip() if value not in (None, "") else ""

    @classmethod
    def _extract_document_type_code(cls, *items: dict[str, Any] | None) -> str:
        file_encoding = cls._extract_file_encoding(*items)
        parts = [part.strip() for part in file_encoding.split("-")]
        if len(parts) < 2:
            return ""
        return cls._normalize_document_type_code(parts[1])

    @classmethod
    def _extract_file_subcategory_code(cls, *items: dict[str, Any] | None) -> str:
        value = cls._first_value_from_items(
            items,
            ("file_subcategory_code", "fileSubcategoryCode", "document_subtype", "documentSubtype"),
        )
        return cls._normalize_document_type_code(value)

    @classmethod
    def _extract_business_domain_code(cls, *items: dict[str, Any] | None) -> str:
        file_encoding = cls._extract_file_encoding(*items)
        parts = [part.strip() for part in file_encoding.split("-")]
        if len(parts) < 4 or not parts[2]:
            return ""
        return cls._normalize_business_domain_code(parts[2])

    @staticmethod
    def _normalize_document_type_code(value: Any) -> str:
        return str(value or "").strip().upper()

    @staticmethod
    def _normalize_business_domain_code(value: Any) -> str:
        return str(value or "").strip().upper()

    @staticmethod
    def _first_value_from_items(items: tuple[dict[str, Any] | None, ...], keys: tuple[str, ...]) -> Any:
        for item in items:
            if not item:
                continue
            value = KnowledgeService._first_value(item, *keys)
            if value not in (None, ""):
                return value
        return None

    @staticmethod
    def _clean_title(file_name: str) -> str:
        path = Path(file_name)
        return path.stem or file_name

    @staticmethod
    def _get_file_ext(file_name: str) -> str:
        suffix = Path(file_name).suffix.lower()
        return suffix[1:] if suffix.startswith(".") else suffix

    @staticmethod
    def _serialize_datetime(value: Any) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, str):
            return value
        return ""

    @staticmethod
    def _extract_success_data(response: dict[str, Any]) -> Any:
        status_code = response.get("status_code")
        normalized_status_code: int | None
        if status_code is None:
            normalized_status_code = None
        else:
            try:
                normalized_status_code = int(status_code)
            except (TypeError, ValueError):
                normalized_status_code = None
        if normalized_status_code is not None and normalized_status_code != 200:
            raise BishengBusinessError(
                normalized_status_code or 502,
                normalize_user_facing_message(
                    response.get("status_message"),
                    fallback="BiSheng 请求失败",
                    status_code=normalized_status_code,
                ),
            )
        return response.get("data") or {}

    async def _fetch_space_endpoint(self, source: str, path: str) -> tuple[str, list[dict[str, Any]]]:
        try:
            response = await self._bisheng.get_json(path)
        except (httpx.HTTPError, ValueError):
            return source, []
        if response.get("status_code") not in (None, 200):
            return source, []
        return source, self._extract_space_rows(response.get("data", response))

    async def _fetch_grouped_spaces(self) -> list[KnowledgeSpaceItem] | None:
        try:
            response = await self._bisheng.get_json("/api/v1/knowledge/space/grouped")
        except (httpx.HTTPError, ValueError):
            return None
        if response.get("status_code") not in (None, 200):
            return None
        payload = response.get("data", response)
        if not isinstance(payload, dict):
            return None
        mapped: list[KnowledgeSpaceItem] = []
        for source, key in GROUPED_SPACE_KEYS:
            rows = payload.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if not isinstance(row, dict):
                    continue
                normalized_row = dict(row)
                normalized_row.setdefault("space_level", source)
                item = self._map_space(normalized_row, source)
                if item is not None:
                    mapped.append(item)
        return mapped

    def _extract_space_rows(self, payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        for key in ("data", "list", "records", "items", "results", "knowledge_list", "spaces"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = self._extract_space_rows(value)
                if nested:
                    return nested
        return []

    def _map_space(self, row: dict[str, Any], source: str) -> KnowledgeSpaceItem | None:
        space_id = self._int_value(row, "id", "knowledge_id", "knowledgeId", "space_id", "spaceId")
        if space_id <= 0:
            return None
        name = self._str_value(row, "name", "space_name", "knowledge_name", "title")
        if not name:
            name = str(space_id)
        role = self._normalize_role(self._str_value(row, "user_role", "role", "permission", "operate_role"), source)
        auth_type = self._resolve_auth_type(row)
        space_level = self._resolve_space_level(row, source)
        space_kind = self._str_value(row, "space_kind", "kind", "space_type") or "normal"
        if space_level == "department" or source == "department":
            space_kind = "department"
        return KnowledgeSpaceItem(
            id=space_id,
            name=name,
            description=self._str_value(row, "description", "desc", "remark", "summary"),
            auth_type=auth_type,
            user_role=role,
            space_kind=space_kind,
            space_level=space_level,
            department_name=self._str_value(row, "department_name", "department", "dept_name", "deptName"),
            file_count=self._int_value(
                row,
                "file_count",
                "file_num",
                "fileNum",
                "document_count",
                "doc_count",
                "doc_num",
            ),
            member_count=self._int_value(row, "member_count", "member_num", "user_count", "user_num", "follower_num"),
            is_pinned=self._bool_value(row, "is_pinned", "pinned", "is_top", "isTop"),
            updated_at=self._serialize_datetime(
                self._first_value(row, "updated_at", "update_time", "updateTime", "gmt_modified", "modify_time")
            ),
            sources=[source],
            business_domain_codes=self._str_list_value(row, "business_domain_codes", "businessDomainCodes"),
        )

    def _merge_space(self, current: KnowledgeSpaceItem, incoming: KnowledgeSpaceItem) -> None:
        for source in incoming.sources:
            if source not in current.sources:
                current.sources.append(source)
        if ROLE_PRIORITY.get(incoming.user_role, 0) > ROLE_PRIORITY.get(current.user_role, 0):
            current.user_role = incoming.user_role
        current.file_count = max(current.file_count, incoming.file_count)
        current.member_count = max(current.member_count, incoming.member_count)
        current.is_pinned = current.is_pinned or incoming.is_pinned
        if not current.description and incoming.description:
            current.description = incoming.description
        if not current.department_name and incoming.department_name:
            current.department_name = incoming.department_name
        if incoming.updated_at > current.updated_at:
            current.updated_at = incoming.updated_at
        if current.space_kind == "normal" and incoming.space_kind != "normal":
            current.space_kind = incoming.space_kind
        if not current.space_level and incoming.space_level:
            current.space_level = incoming.space_level
        for code in incoming.business_domain_codes:
            if code not in current.business_domain_codes:
                current.business_domain_codes.append(code)

    @staticmethod
    def _sort_spaces(spaces: list[KnowledgeSpaceItem]) -> list[KnowledgeSpaceItem]:
        data = sorted(spaces, key=lambda item: item.name)
        data = sorted(data, key=lambda item: item.updated_at, reverse=True)
        return sorted(data, key=lambda item: item.is_pinned, reverse=True)

    @staticmethod
    def _resolve_auth_type(row: dict[str, Any]) -> str:
        is_public = row.get("is_public")
        if isinstance(is_public, bool) and is_public:
            return "public"
        if isinstance(row.get("is_private"), bool) and row["is_private"]:
            return "private"
        return KnowledgeService._str_value(row, "auth_type", "authType", "authority", "visibility", "access_type")

    @staticmethod
    def _resolve_space_level(row: dict[str, Any], source: str) -> str:
        raw_level = KnowledgeService._str_value(row, "space_level", "spaceLevel", "level")
        level = raw_level.strip().lower()
        if level in {"personal", "department", "team", "public"}:
            return level
        if source in {"personal", "department", "team", "public"}:
            return source
        if source == "mine":
            return "personal"
        if source in {"joined", "managed"}:
            return "team"
        return ""

    @staticmethod
    def _normalize_role(raw_role: str, source: str) -> str:
        normalized = raw_role.strip().lower()
        if normalized in {"creator", "owner", "create", "created", "mine", "拥有者", "创建者"}:
            return "creator"
        if normalized in {"admin", "manager", "managed", "manage", "管理员", "可管理"}:
            return "admin"
        if normalized in {"member", "joined", "viewer", "read", "成员", "已加入"}:
            return "member"
        if source == "mine":
            return "creator"
        if source == "managed":
            return "admin"
        return "member"

    @staticmethod
    def _first_value(row: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in row and row[key] not in (None, ""):
                return row[key]
        return None

    @staticmethod
    def _str_value(row: dict[str, Any], *keys: str) -> str:
        value = KnowledgeService._first_value(row, *keys)
        return str(value).strip() if value not in (None, "") else ""

    @staticmethod
    def _str_list_value(row: dict[str, Any], *keys: str) -> list[str]:
        value = KnowledgeService._first_value(row, *keys)
        if isinstance(value, list):
            return [str(item).strip().upper() for item in value if str(item).strip()]
        return []

    @staticmethod
    def _int_value(row: dict[str, Any], *keys: str) -> int:
        value = KnowledgeService._first_value(row, *keys)
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _bool_value(row: dict[str, Any], *keys: str) -> bool:
        value = KnowledgeService._first_value(row, *keys)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y", "置顶"}
        return False
