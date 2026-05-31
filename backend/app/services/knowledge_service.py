import asyncio
import secrets
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from app.clients.bisheng import BishengClient
from app.schemas.knowledge import (
    FileChunkItem,
    FavoriteDocumentData,
    FavoriteDocumentRequest,
    FilePreviewData,
    FilePreviewManifest,
    FilePreviewMode,
    FilePreviewSourceKind,
    HomeKnowledgeData,
    KnowledgeFileDetail,
    KnowledgeFileItem,
    KnowledgeFileSpace,
    PersonalKnowledgeSpaceItem,
    PersonalKnowledgeSpaceListData,
    KnowledgeSpaceItem,
    KnowledgeSpaceListData,
    PagedKnowledgeFileData,
    RelatedKnowledgeFileData,
    DocumentFileChatRequest,
    ShareDocumentAccessData,
    ShareDocumentAccessRequest,
    ShareDocumentData,
    ShareDocumentMeta,
    ShareDocumentRequest,
)
from app.services.portal_config_service import PortalConfigService

SUCCESS_STATUS = 2
FILE_TYPE = 1
IMAGE_EXTENSIONS = {"bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"}
SPREADSHEET_EXTENSIONS = {"csv", "xls", "xlsx"}
MARKDOWN_EXTENSIONS = {"markdown", "md"}
HTML_EXTENSIONS = {"htm", "html"}
TEXT_EXTENSIONS = {"txt"}
UNSUPPORTED_PREVIEW_EXTENSIONS = {"doc", "ppt", "pptx"}
PREVIEW_TASK_CACHE_TTL_SECONDS = 900.0
PREVIEW_TASK_POLL_ATTEMPTS = 6
PREVIEW_TASK_POLL_DELAY_SECONDS = 0.4
PREVIEW_TASK_FAILURE_STATUSES = {"cancelled", "canceled", "error", "failed", "failure", "timeout"}
FRONTEND_PROXY_ASSET_PATH_PREFIXES = ("/bisheng/", "/workspace/bisheng/", "/tmp-dir")
SHARE_ACCESS_COOKIE_NAME = "portal_share_access"
SHARE_ACCESS_TTL_SECONDS = 3600
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


@dataclass
class ShareAccessSession:
    session_id: str
    share_token: str
    space_id: int
    file_id: int
    allow_download: bool
    expires_at: float


PREVIEW_TASK_CACHE: dict[tuple[int, int], CachedPreviewTaskResult] = {}
SHARE_ACCESS_SESSIONS: dict[str, ShareAccessSession] = {}


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

    def get_enabled_space_ids(self) -> list[int]:
        config = self._config_service.get_config()
        return [space.id for space in config.spaces if space.enabled]

    def get_enabled_space_ids_by_level(self, space_level: Optional[str]) -> list[int]:
        config = self._config_service.get_config()
        normalized_level = (space_level or "").strip()
        return [
            space.id
            for space in config.spaces
            if space.enabled and (not normalized_level or space.space_level == normalized_level)
        ]

    def get_space_name_map(self) -> dict[int, str]:
        config = self._config_service.get_config()
        return {space.id: space.name for space in config.spaces}

    async def get_home_content(self) -> HomeKnowledgeData:
        config = self._config_service.get_config()
        space_ids = self.resolve_requested_space_ids()
        sections = [section for section in config.sections if section.enabled and section.tag]
        if not space_ids or not sections:
            return HomeKnowledgeData(
                sections={section.tag: [] for section in sections},
                tags=[],
            )
        try:
            response = await self._bisheng.post_json(
                "/api/v1/knowledge/shougang-portal/home",
                json={
                    "space_ids": space_ids,
                    "space_level": None,
                    "sections": [
                        {
                            "tag": section.tag,
                            "page_size": config.display.home.section_page_size,
                        }
                        for section in sections
                    ],
                    "hot_tags_limit": config.display.home.hot_tags_count,
                },
            )
            data = response.get("data") or {}
            raw_sections = data.get("sections") if isinstance(data, dict) else {}
            raw_tags = data.get("tags") if isinstance(data, dict) else []
            mapped_sections: dict[str, list[KnowledgeFileItem]] = {}
            for section in sections:
                raw_items = raw_sections.get(section.tag, []) if isinstance(raw_sections, dict) else []
                mapped_sections[section.tag] = self._map_shougang_portal_response_items(raw_items)
            tags = list(dict.fromkeys(str(tag) for tag in raw_tags if str(tag))) if isinstance(raw_tags, list) else []
            return HomeKnowledgeData(sections=mapped_sections, tags=tags)
        except Exception:
            section_results = await asyncio.gather(
                *[
                    self.search_files(
                        q=None,
                        tag=section.tag,
                        requested_space_ids=space_ids,
                        space_level=None,
                        file_ext=None,
                        sort="updated_at",
                        page=1,
                        page_size=config.display.home.section_page_size,
                    )
                    for section in sections
                ],
                return_exceptions=True,
            )
            tags = await self.get_aggregated_tags(space_ids)
            return HomeKnowledgeData(
                sections={
                    section.tag: (
                        [] if isinstance(result, Exception) else result.data
                    )
                    for section, result in zip(sections, section_results)
                },
                tags=tags[:config.display.home.hot_tags_count],
            )

    async def list_visible_spaces(self) -> KnowledgeSpaceListData:
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
            )
            for item in raw_items
            if isinstance(item, dict)
        ]
        return PersonalKnowledgeSpaceListData(data=items, total=int(data.get("total") or len(items)))

    async def create_favorite(self, req: FavoriteDocumentRequest) -> FavoriteDocumentData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/favorites",
            json=req.model_dump(),
        )
        data = self._extract_success_data(response)
        return FavoriteDocumentData(
            file_id=int(data.get("file_id") or 0),
            space_id=int(data.get("space_id") or req.target_space_id),
            title=str(data.get("title") or ""),
        )

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

    async def get_share_link_meta(self, share_token: str) -> ShareDocumentMeta:
        response = await self._bisheng.get_json(f"/api/v1/knowledge/shougang-portal/share-links/{share_token}")
        data = self._extract_success_data(response)
        return ShareDocumentMeta.model_validate(data)

    async def verify_share_link_access(
        self,
        share_token: str,
        req: ShareDocumentAccessRequest,
    ) -> ShareDocumentAccessData:
        response = await self._bisheng.post_json(
            f"/api/v1/knowledge/shougang-portal/share-links/{share_token}/verify",
            json=req.model_dump(),
        )
        data = self._extract_success_data(response)
        return ShareDocumentAccessData.model_validate(data)

    def stream_document_file_chat(
        self,
        space_id: int,
        file_id: int,
        req: DocumentFileChatRequest,
    ) -> AsyncIterator[bytes]:
        model_id = self._resolve_document_chat_model_id(req.model)
        return self._bisheng.stream_post(
            f"/api/v1/knowledge/space/{space_id}/chat/file/{file_id}",
            json={
                "query": req.query,
                "modelId": model_id,
            },
        )

    @staticmethod
    def create_share_access_session(access: ShareDocumentAccessData) -> ShareAccessSession:
        KnowledgeService.cleanup_expired_share_access_sessions()
        session = ShareAccessSession(
            session_id=secrets.token_urlsafe(32),
            share_token=access.share_token,
            space_id=access.space_id,
            file_id=access.file_id,
            allow_download=access.allow_download,
            expires_at=time.time() + SHARE_ACCESS_TTL_SECONDS,
        )
        SHARE_ACCESS_SESSIONS[session.session_id] = session
        return session

    @staticmethod
    def cleanup_expired_share_access_sessions() -> None:
        now = time.time()
        expired = [
            session_id
            for session_id, session in SHARE_ACCESS_SESSIONS.items()
            if session.expires_at <= now
        ]
        for session_id in expired:
            SHARE_ACCESS_SESSIONS.pop(session_id, None)

    @staticmethod
    def get_share_access_session(
        session_id: str,
        share_token: str,
        space_id: int,
        file_id: int,
    ) -> ShareAccessSession | None:
        KnowledgeService.cleanup_expired_share_access_sessions()
        session = SHARE_ACCESS_SESSIONS.get(session_id)
        if session is None:
            return None
        if (
            session.share_token != share_token
            or session.space_id != space_id
            or session.file_id != file_id
        ):
            return None
        return session

    async def get_space_tags(self, space_id: int) -> list[str]:
        if space_id not in self.get_enabled_space_ids():
            return []
        tag_lookup = await self._get_space_tag_lookup(space_id)
        return sorted(tag_lookup.keys())

    async def get_aggregated_tags(
        self,
        requested_space_ids: Optional[list[int]] = None,
        space_level: Optional[str] = None,
    ) -> list[str]:
        space_ids = self.resolve_requested_space_ids(
            requested_space_ids,
            space_level,
        )
        if not space_ids:
            return []
        if len(space_ids) > 1 or space_level:
            try:
                return await self._fetch_shougang_portal_tags(space_ids=space_ids, space_level=space_level)
            except Exception:
                pass
        lookups = await asyncio.gather(*[self._get_space_tag_lookup(space_id) for space_id in space_ids])
        tags = {tag_name for lookup in lookups for tag_name in lookup.keys()}
        return sorted(tags)

    def resolve_requested_space_ids(
        self,
        requested_space_ids: Optional[list[int]] = None,
        space_level: Optional[str] = None,
    ) -> list[int]:
        enabled_space_ids = set(self.get_enabled_space_ids_by_level(space_level))
        if requested_space_ids:
            return sorted(enabled_space_ids.intersection(requested_space_ids))
        return sorted(enabled_space_ids)

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
        tag: Optional[str],
        page: int,
        page_size: int,
    ) -> PagedKnowledgeFileData:
        if space_id not in self.get_enabled_space_ids():
            return PagedKnowledgeFileData(data=[], total=0, page=page, page_size=page_size)

        search_result = await self._fetch_space_files(space_id=space_id, keyword=None, tag_name=tag)
        filtered = self._filter_items(
            items=search_result.items,
            allowed_space_ids={space_id},
            file_ext=file_ext,
        )
        sorted_items = self._sort_items(filtered, sort="updated_at", keyword=None)
        mapped = self._map_items(sorted_items)
        return self._paginate(mapped, page=page, page_size=page_size)

    async def search_files(
        self,
        q: Optional[str],
        tag: Optional[str],
        requested_space_ids: Optional[list[int]],
        space_level: Optional[str],
        file_ext: Optional[str],
        sort: str,
        page: int,
        page_size: int,
    ) -> PagedKnowledgeFileData:
        has_filter = bool(tag or requested_space_ids or space_level or file_ext)
        if not q and not has_filter:
            return PagedKnowledgeFileData(data=[], total=0, page=page, page_size=page_size)

        space_ids = self.resolve_requested_space_ids(requested_space_ids, space_level)
        if not space_ids:
            return PagedKnowledgeFileData(data=[], total=0, page=page, page_size=page_size)

        if len(space_ids) > 1 or space_level:
            try:
                return await self._search_shougang_portal_files(
                    q=q,
                    tag=tag,
                    space_ids=space_ids,
                    space_level=space_level,
                    file_ext=file_ext,
                    sort=sort,
                    page=page,
                    page_size=page_size,
                )
            except Exception:
                pass

        results = await asyncio.gather(
            *[
                self._fetch_space_files(space_id=space_id, keyword=q, tag_name=tag)
                for space_id in space_ids
            ]
        )
        merged_items = [item for result in results for item in result.items]
        filtered = self._filter_items(
            items=merged_items,
            allowed_space_ids=set(space_ids),
            file_ext=file_ext,
        )
        sorted_items = self._sort_items(filtered, sort=sort, keyword=q)
        mapped = self._map_items(sorted_items)
        return self._paginate(mapped, page=page, page_size=page_size)

    async def _fetch_shougang_portal_tags(
        self,
        space_ids: list[int],
        space_level: Optional[str],
    ) -> list[str]:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/tags/search",
            json={
                "space_ids": space_ids,
                "space_level": space_level,
            },
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
        sort: str,
        page: int,
        page_size: int,
    ) -> PagedKnowledgeFileData:
        response = await self._bisheng.post_json(
            "/api/v1/knowledge/shougang-portal/files/search",
            json={
                "q": q,
                "tag": tag,
                "space_ids": space_ids,
                "space_level": space_level,
                "file_ext": file_ext,
                "sort": sort,
                "page": page,
                "page_size": page_size,
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

    @staticmethod
    def _map_shougang_portal_response_items(raw_items: list) -> list[KnowledgeFileItem]:
        return [
            KnowledgeFileItem(
                id=int(item.get("id") or 0),
                space_id=int(item.get("space_id") or item.get("knowledge_id") or 0),
                title=str(item.get("title") or item.get("file_name") or ""),
                summary=str(item.get("summary") or item.get("abstract") or ""),
                source=str(item.get("source") or ""),
                updated_at=str(item.get("updated_at") or item.get("update_time") or ""),
                tags=[str(tag) for tag in (item.get("tags") or [])],
                file_ext=str(item.get("file_ext") or ""),
                file_size=str(item.get("file_size") or ""),
                file_encoding=str(item.get("file_encoding") or ""),
                folder_path=str(item.get("folder_path") or ""),
            )
            for item in raw_items
            if isinstance(item, dict)
        ]

    async def get_file_detail(self, space_id: int, file_id: int) -> Optional[KnowledgeFileDetail]:
        if space_id not in self.get_enabled_space_ids():
            return None

        file_info_resp = await self._bisheng.get_json(f"/api/v1/knowledge/file/info/{file_id}")
        file_info = file_info_resp.get("data") or {}
        if not file_info or int(file_info.get("knowledge_id", 0)) != space_id:
            return None

        search_item = await self._get_file_search_item(
            space_id=space_id,
            file_id=file_id,
            file_name=file_info.get("file_name", ""),
        )
        tags = self._extract_tag_names(search_item or {})
        source = self.get_space_name_map().get(space_id, str(space_id))
        return KnowledgeFileDetail(
            id=file_id,
            space_id=space_id,
            title=self._clean_title(file_info.get("file_name", "")),
            summary=file_info.get("abstract") or "",
            source=source,
            updated_at=self._serialize_datetime(file_info.get("update_time")),
            tags=tags,
            file_ext=self._get_file_ext(file_info.get("file_name", "")),
            file_size=self._extract_file_size_label(file_info, search_item),
            file_encoding=self._extract_file_encoding(file_info, search_item),
            space=KnowledgeFileSpace(id=space_id, name=source),
        )

    async def get_file_preview(self, space_id: int, file_id: int) -> Optional[FilePreviewManifest]:
        detail = await self.get_file_detail(space_id=space_id, file_id=file_id)
        if detail is None:
            return None

        normalized_ext = self._normalize_ext(detail.file_ext)
        raw_preview = await self._get_raw_file_preview(space_id=space_id, file_id=file_id)
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
        )
        if source is None:
            return FilePreviewManifest(
                mode="chunks",
                download_url=download_url,
                reason="当前文件暂未生成可直接预览的资源，已回退到正文分段内容。",
                supports_chunks_fallback=True,
            )

        mode = self._infer_preview_mode(source.url, normalized_ext)
        if mode in {"unsupported", "chunks"}:
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
            supports_chunks_fallback=True,
        )

    async def resolve_preview_content_source(
        self,
        space_id: int,
        file_id: int,
        requested_source_kind: Optional[FilePreviewSourceKind] = None,
        raw_preview: Optional[FilePreviewData] = None,
        file_ext: Optional[str] = None,
    ) -> Optional[ResolvedPreviewSource]:
        normalized_ext = self._normalize_ext(file_ext or "")
        if normalized_ext in UNSUPPORTED_PREVIEW_EXTENSIONS:
            return None

        preview_data = raw_preview or await self._get_raw_file_preview(space_id=space_id, file_id=file_id)
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

    async def _get_raw_file_preview(self, space_id: int, file_id: int) -> Optional[FilePreviewData]:
        detail = await self.get_file_detail(space_id=space_id, file_id=file_id)
        if detail is None:
            return None
        preview_resp = await self._bisheng.get_json(f"/api/v1/knowledge/space/{space_id}/files/{file_id}/preview")
        data = preview_resp.get("data") or {}
        if not data:
            return None
        normalized = {
            **data,
            "original_url": str(data.get("original_url") or "").strip(),
            "preview_url": str(data.get("preview_url") or "").strip(),
        }
        return FilePreviewData.model_validate(normalized)

    async def _get_preview_source_url(
        self,
        source_kind: FilePreviewSourceKind,
        raw_preview: Optional[FilePreviewData],
        space_id: int,
        file_id: int,
    ) -> str:
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
        if (
            file_ext == "docx"
            or file_ext in SPREADSHEET_EXTENSIONS
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
        if normalized_ext == "docx":
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

    async def get_file_chunks(self, space_id: int, file_id: int) -> list[FileChunkItem]:
        detail = await self.get_file_detail(space_id=space_id, file_id=file_id)
        if detail is None:
            return []

        page = 1
        chunks: list[FileChunkItem] = []
        total = 0
        while True:
            response = await self._bisheng.get_json(
                "/api/v1/knowledge/chunk",
                params={
                    "knowledge_id": space_id,
                    "file_ids": [file_id],
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
    ) -> RelatedKnowledgeFileData:
        detail = await self.get_file_detail(space_id=space_id, file_id=file_id)
        if detail is None or not detail.tags:
            return RelatedKnowledgeFileData(data=[], total=0)

        candidate_map: dict[int, dict[str, Any]] = {}
        for tag_name in detail.tags:
            search_result = await self.search_files(
                q=None,
                tag=tag_name,
                requested_space_ids=None,
                space_level=None,
                file_ext=None,
                sort="updated_at",
                page=1,
                page_size=self._page_size_limit,
            )
            for item in search_result.data:
                if item.id == file_id:
                    continue
                entry = candidate_map.setdefault(
                    item.id,
                    {"item": item, "score": 0},
                )
                entry["score"] += 1

        sorted_candidates = sorted(
            candidate_map.values(),
            key=lambda value: (
                -value["score"],
                value["item"].updated_at,
            ),
        )
        data = [value["item"] for value in sorted_candidates[:limit]]
        return RelatedKnowledgeFileData(data=data[:limit], total=len(data[:limit]))

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
    ) -> list[dict[str, Any]]:
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
            filtered.append(item)
        return filtered

    def _sort_items(self, items: list[dict[str, Any]], sort: str, keyword: Optional[str]) -> list[dict[str, Any]]:
        if sort == "updated_at" or not keyword:
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

    def _map_items(self, items: list[dict[str, Any]]) -> list[KnowledgeFileItem]:
        space_name_map = self.get_space_name_map()
        mapped: list[KnowledgeFileItem] = []
        for item in items:
            space_id = int(item.get("knowledge_id", 0))
            file_name = item.get("file_name") or ""
            mapped.append(
                KnowledgeFileItem(
                    id=int(item.get("id", 0)),
                    space_id=space_id,
                    title=self._clean_title(file_name),
                    summary=item.get("abstract") or "",
                    source=space_name_map.get(space_id, str(space_id)),
                    updated_at=self._serialize_datetime(item.get("update_time")),
                    tags=self._extract_tag_names(item),
                    file_ext=self._get_file_ext(file_name),
                    file_size=self._extract_file_size_label(item),
                    file_encoding=self._extract_file_encoding(item),
                )
            )
        return mapped

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
            if isinstance(tag, dict) and tag.get("name"):
                names.append(tag["name"])
        return names

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
        if status_code not in (None, 200):
            raise BishengBusinessError(
                int(status_code),
                str(response.get("status_message") or "Bisheng request failed"),
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
