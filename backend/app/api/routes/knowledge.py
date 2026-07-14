import asyncio
import json
import logging
from time import monotonic
from typing import Annotated, Any, NoReturn, Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    get_bisheng_client,
    get_portal_auth_service,
    get_portal_config_service,
    get_portal_home_cache_service,
)
from app.clients.bisheng import BishengClient
from app.schemas.common import response_ok
from app.schemas.knowledge import (
    DocumentFileChatRequest,
    FavoriteDocumentRequest,
    FavoriteRemoveRequest,
    FavoriteStatusRequest,
    FilePreviewSourceKind,
    HomeStatsData,
    PublishPrecheckRequest,
    QaKnowledgeFolderStatsRequest,
    ShareDocumentAccessRequest,
    ShareDocumentRequest,
)
from app.schemas.portal_config import DEFAULT_DOCUMENT_TYPES, DocumentTypeConfig, PortalConfig
from app.services.domain_consistency_service import DomainConsistencyService
from app.services.domain_file_count_service import DomainFileCountService
from app.services.knowledge_service import (
    SHARE_ACCESS_COOKIE_NAME,
    SHARE_ACCESS_TTL_SECONDS,
    BishengBusinessError,
    KnowledgeService,
    ShareAccessSession,
)
from app.services.portal_auth_service import (
    PortalAuthError,
    PortalAuthService,
    get_portal_session,
    require_portal_session,
)
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService
from app.services.portal_telemetry_service import PortalTelemetryService, PortalTelemetryStatsError
from app.settings import get_settings

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])
logger = logging.getLogger(__name__)

_BISHENG_DUPLICATE_FAVORITE_CODE = 18021
_BISHENG_PERMISSION_DENIED_CODE = 18040
_QA_MODEL_OPTIONS_CACHE_TTL_SECONDS = 300.0
_qa_model_raw_servers_cache: dict[str, Any] = {
    "expires_at": 0.0,
    "raw_servers": [],
}
_qa_model_raw_servers_lock = asyncio.Lock()


def _build_business_domain_options(config: PortalConfig) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    for domain in config.domains:
        if not domain.enabled:
            continue
        code = (domain.code or "").strip().upper()
        if not code:
            continue
        options.append({"code": code, "name": domain.name})
    return options


def get_knowledge_service(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
) -> KnowledgeService:
    return KnowledgeService(
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
        default_model=get_settings().bisheng_default_model,
    )


def get_domain_file_count_service(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
) -> DomainFileCountService:
    return DomainFileCountService(
        bisheng_client=bisheng_client,
        config_service=portal_config_service,
    )


def _raise_bisheng_business_error(err: BishengBusinessError) -> NoReturn:
    status_code = 403 if err.status_code in {_BISHENG_PERMISSION_DENIED_CODE, 404} else 502
    raise HTTPException(status_code=status_code, detail=err.status_message)


_QA_TREE_FORBIDDEN_CODES = {_BISHENG_PERMISSION_DENIED_CODE, 18000}  # SpacePermissionDenied / SpaceNotFound


def _raise_qa_tree_children_error(err: BishengBusinessError) -> NoReturn:
    if err.status_code in _QA_TREE_FORBIDDEN_CODES:
        raise HTTPException(status_code=403, detail="包含无权限或不存在的知识库")
    _raise_bisheng_business_error(err)


def _normalize_document_types(raw_items: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_items, list):
        return []
    document_types: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        raw_item = {**item}
        if "label" not in raw_item and "name" in raw_item:
            raw_item["label"] = raw_item.get("name")
        try:
            normalized = DocumentTypeConfig.model_validate(raw_item)
        except Exception:
            continue
        if normalized.code in seen:
            continue
        seen.add(normalized.code)
        document_types.append(normalized.model_dump(mode="json"))
    return document_types


async def _fetch_shougang_document_types(bisheng_client: BishengClient) -> list[dict[str, Any]]:
    try:
        response = await bisheng_client.get_json("/api/v1/workstation/config")
    except Exception:
        logger.warning("failed to fetch shougang document types", exc_info=True)
        return []
    data = response.get("data") if isinstance(response, dict) else {}
    shougang = data.get("shougang") if isinstance(data, dict) else {}
    file_encoding = shougang.get("file_encoding") if isinstance(shougang, dict) else {}
    return _normalize_document_types(file_encoding.get("document_types") if isinstance(file_encoding, dict) else [])


async def _build_public_qa_model_options(
    portal_config_service: PortalConfigService,
    bisheng_client: BishengClient,
):
    try:
        raw_servers = await _fetch_public_qa_model_raw_servers(bisheng_client)
    except Exception:
        logger.warning("failed to fetch public qa model options", exc_info=True)
        return portal_config_service.build_qa_model_options([])
    return portal_config_service.build_qa_model_options(raw_servers)


async def _qa_model_name_by_id(bisheng_client: BishengClient) -> dict[str, str]:
    """实时模型列表的 id -> 展示名映射（不落库）。

    bisheng 侧 PortalQAConfig schema 会丢弃 general_model_display_name/
    reasoning_model_display_name 字段，导致 config 读回来永远为空。这里按实时
    /api/v1/llm 列表回填，保证前端问答页能显示模型名而非模型 ID。
    """
    try:
        raw_servers = await _fetch_public_qa_model_raw_servers(bisheng_client)
    except Exception:
        logger.warning("failed to fetch qa model names for config enrichment", exc_info=True)
        return {}
    name_by_id: dict[str, str] = {}
    for server in raw_servers:
        if not isinstance(server, dict):
            continue
        server_models = server.get("models")
        if not isinstance(server_models, list):
            continue
        for item in server_models:
            if not isinstance(item, dict) or item.get("id") is None:
                continue
            model_id = str(item["id"])
            name_by_id[model_id] = str(item.get("model_name") or item.get("name") or model_id)
    return name_by_id


async def _fetch_public_qa_model_raw_servers(bisheng_client: BishengClient) -> list[dict[str, Any]]:
    now = monotonic()
    cached_raw_servers = _qa_model_raw_servers_cache["raw_servers"]
    if now < float(_qa_model_raw_servers_cache["expires_at"]) and isinstance(cached_raw_servers, list):
        return cached_raw_servers

    async with _qa_model_raw_servers_lock:
        now = monotonic()
        cached_raw_servers = _qa_model_raw_servers_cache["raw_servers"]
        if now < float(_qa_model_raw_servers_cache["expires_at"]) and isinstance(cached_raw_servers, list):
            return cached_raw_servers

        try:
            response = await bisheng_client.get_json("/api/v1/llm")
        except Exception:
            if isinstance(cached_raw_servers, list) and cached_raw_servers:
                logger.warning("using stale public qa model options cache", exc_info=True)
                return cached_raw_servers
            raise

        raw_servers = response.get("data") if isinstance(response, dict) else []
        if not isinstance(raw_servers, list):
            raw_servers = []
        _qa_model_raw_servers_cache["raw_servers"] = raw_servers
        _qa_model_raw_servers_cache["expires_at"] = monotonic() + _QA_MODEL_OPTIONS_CACHE_TTL_SECONDS
        return raw_servers


async def _scoped_service_and_extra_ids(
    request: Request,
    auth_service: PortalAuthService,
    bisheng_client: BishengClient,
    portal_config_service: PortalConfigService,
) -> tuple[KnowledgeService, Optional[list[int]], Optional[BishengClient]]:
    """Build a KnowledgeService scoped to the current user when logged in.

    Returns (service, extra_space_ids, client_to_close).
    - Not logged in: system client (singleton), enabled-only scope, nothing to close.
    - Logged in: per-user token client, scope = enabled ∪ personal-visible libraries,
      and the user client is returned so the caller can aclose() it in a finally.
    """
    session = await get_portal_session(auth_service, request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        return service, None, None

    scoped_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=scoped_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        visible_spaces = await service.list_visible_spaces()
        extra_space_ids = [space.id for space in visible_spaces.data]
        return service, extra_space_ids, scoped_client
    except Exception:
        await scoped_client.aclose()
        raise


def _require_share_access(
    request: Request,
    share_token: str,
    space_id: int,
    file_id: int,
) -> ShareAccessSession:
    session_id = request.cookies.get(SHARE_ACCESS_COOKIE_NAME, "")
    session = KnowledgeService.get_share_access_session(
        session_id=session_id,
        share_token=share_token,
        space_id=space_id,
        file_id=file_id,
    )
    if session is None:
        raise HTTPException(status_code=403, detail="分享访问未验证或已过期")
    return session


@router.get("/files")
async def search_files(
    request: Request,
    q: Optional[str] = None,
    tag: Optional[str] = None,
    base_tag: Optional[str] = None,
    space_ids: Annotated[Optional[list[int]], Query()] = None,
    space_level: Optional[str] = None,
    file_ext: Optional[str] = None,
    document_type: Optional[str] = None,
    file_subcategory_code: Optional[str] = None,
    business_domain_code: Optional[str] = None,
    recommendation: Optional[str] = None,
    sort: str = "relevance",
    cursor: Optional[str] = None,
    limit: int = 20,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)

    # 未登录：系统客户端（常驻单例，勿关闭），范围 = 后台启用库
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        try:
            return response_ok(
                await service.search_files(
                    q=q,
                    tag=tag,
                    base_tag=base_tag,
                    requested_space_ids=space_ids,
                    space_level=space_level,
                    file_ext=file_ext,
                    document_type=document_type,
                    file_subcategory_code=file_subcategory_code,
                    business_domain_code=business_domain_code,
                    recommendation=recommendation,
                    sort=sort,
                    cursor=cursor,
                    limit=limit,
                    extra_space_ids=None,
                    fallback_to_public_spaces=False,
                )
            )
        except BishengBusinessError as err:
            _raise_bisheng_business_error(err)

    # 已登录：个人 token 客户端，范围 = 后台启用库 ∪ 个人可见库
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        visible_spaces = await service.list_visible_spaces()
        extra_space_ids = [space.id for space in visible_spaces.data]
        return response_ok(
            await service.search_files(
                q=q,
                tag=tag,
                base_tag=base_tag,
                requested_space_ids=space_ids,
                space_level=space_level,
                file_ext=file_ext,
                document_type=document_type,
                file_subcategory_code=file_subcategory_code,
                business_domain_code=business_domain_code,
                recommendation=recommendation,
                sort=sort,
                cursor=cursor,
                limit=limit,
                extra_space_ids=extra_space_ids,
                fallback_to_public_spaces=False,
            )
        )
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        await bisheng_client.aclose()


@router.get("/tags")
async def get_aggregated_tags(
    request: Request,
    space_ids: Annotated[Optional[list[int]], Query()] = None,
    space_level: Optional[str] = None,
    business_domain_code: Optional[str] = None,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request=request,
        auth_service=auth_service,
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
    )
    try:
        return response_ok(
            await service.get_aggregated_tags(
                requested_space_ids=space_ids,
                space_level=space_level,
                business_domain_code=business_domain_code,
                extra_space_ids=extra_space_ids,
                fallback_to_public_spaces=False,
            )
        )
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


def _home_sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _home_cache_ttl_seconds(config: PortalConfig) -> int:
    return config.site.home_cache_ttl_seconds


def _extract_cached_home_sections(payload: Any) -> list[dict[str, Any]] | None:
    if not isinstance(payload, dict):
        return None
    sections = payload.get("sections")
    if not isinstance(sections, list):
        return None
    normalized: list[dict[str, Any]] = []
    for section in sections:
        if not isinstance(section, dict):
            return None
        tag = section.get("tag")
        items = section.get("items")
        if not isinstance(tag, str) or not isinstance(items, list):
            return None
        normalized.append({"tag": tag, "items": items})
    return normalized


async def _cached_home_stream(sections: list[dict[str, Any]]):
    for section in sections:
        yield _home_sse_event({"type": "section", **section})
    yield _home_sse_event({"type": "done"})


@router.get("/home")
async def get_home_content(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    cache_service: PortalHomeCacheService = Depends(get_portal_home_cache_service),
):
    """Stream home sections over SSE, emitting each section as soon as it is ready."""
    session = await get_portal_session(auth_service, request)
    config = portal_config_service.get_config()
    ttl_seconds = _home_cache_ttl_seconds(config)

    if session is None:
        cache_key = cache_service.home_content_key(config=config)
        cached_sections = _extract_cached_home_sections(await cache_service.get_json(cache_key))
        if cached_sections is not None:
            return StreamingResponse(_cached_home_stream(cached_sections), media_type="text/event-stream")

        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )

        async def anonymous_stream():
            sections: list[dict[str, Any]] = []
            async for tag, items in service.iter_home_content():
                section = {"tag": tag, "items": [item.model_dump(mode="json") for item in items]}
                sections.append(section)
                yield _home_sse_event({"type": "section", **section})
            yield _home_sse_event({"type": "done"})
            await cache_service.set_json(cache_key, {"sections": sections}, ttl_seconds)

        return StreamingResponse(anonymous_stream(), media_type="text/event-stream")

    bisheng_client = auth_service.create_bisheng_client(session)
    # Resolve visible spaces before streaming starts so an auth/upstream failure here
    # surfaces as a clean HTTP error instead of aborting an already-open SSE stream.
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        visible_spaces = await service.list_visible_spaces()
        extra_space_ids = [space.id for space in visible_spaces.data]
    except BaseException:
        await bisheng_client.aclose()
        raise

    cache_key = cache_service.home_content_key(
        config=config,
        account=getattr(getattr(session, "user", None), "account", ""),
        visible_space_ids=extra_space_ids,
    )
    cached_sections = _extract_cached_home_sections(await cache_service.get_json(cache_key))
    if cached_sections is not None:
        await bisheng_client.aclose()
        return StreamingResponse(_cached_home_stream(cached_sections), media_type="text/event-stream")

    async def authenticated_stream():
        try:
            sections: list[dict[str, Any]] = []
            async for tag, items in service.iter_home_content(extra_space_ids=extra_space_ids):
                section = {"tag": tag, "items": [item.model_dump(mode="json") for item in items]}
                sections.append(section)
                yield _home_sse_event({"type": "section", **section})
            yield _home_sse_event({"type": "done"})
            await cache_service.set_json(cache_key, {"sections": sections}, ttl_seconds)
        finally:
            await bisheng_client.aclose()

    return StreamingResponse(authenticated_stream(), media_type="text/event-stream")


@router.get("/home/stats")
async def get_home_stats(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    cache_service: PortalHomeCacheService = Depends(get_portal_home_cache_service),
):
    cache_key = cache_service.home_stats_key()
    cached = await cache_service.get_json(cache_key)
    required_fields = {"total_documents", "read_count", "favorite_count", "qa_count"}
    if isinstance(cached, dict) and required_fields.issubset(cached):
        try:
            return response_ok(HomeStatsData.model_validate(cached))
        except (TypeError, ValueError):
            logger.warning("portal home stats cache payload is invalid key=%s", cache_key, exc_info=True)
    try:
        counts = await PortalTelemetryService(bisheng_client).fetch_home_stats_counts()
    except PortalTelemetryStatsError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    total_documents = counts.pop("total_files", 0)
    data = HomeStatsData(total_documents=total_documents, **counts)
    await cache_service.set_json(
        cache_key,
        data.model_dump(mode="json"),
        _home_cache_ttl_seconds(portal_config_service.get_config()),
    )
    return response_ok(data)


@router.get("/config")
async def get_portal_config(
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    config = portal_config_service.get_config()
    if config.document_types:
        document_types = [dt.model_dump() for dt in config.document_types]
    else:
        bisheng_document_types = await _fetch_shougang_document_types(bisheng_client)
        document_types = _normalize_document_types(bisheng_document_types or DEFAULT_DOCUMENT_TYPES)

    business_domain_options = _build_business_domain_options(config)

    config_dict = config.model_dump(mode="json")

    # 回填 QA 模型展示名（bisheng 侧 schema 丢弃了 display_name 字段，按实时列表补齐）
    qa = config_dict.get("qa")
    if isinstance(qa, dict):
        name_by_id = await _qa_model_name_by_id(bisheng_client)
        if name_by_id:
            general_id = str(qa.get("general_model") or qa.get("selected_model") or "").strip()
            reasoning_id = str(qa.get("reasoning_model") or "").strip()
            if general_id in name_by_id and not str(qa.get("general_model_display_name") or "").strip():
                qa["general_model_display_name"] = name_by_id[general_id]
            if reasoning_id in name_by_id and not str(qa.get("reasoning_model_display_name") or "").strip():
                qa["reasoning_model_display_name"] = name_by_id[reasoning_id]

    return response_ok({
        **config_dict,
        "document_types": document_types,
        "business_domain_options": business_domain_options,
    })


@router.get("/qa/model-options")
async def get_public_qa_model_options(
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    return response_ok(await _build_public_qa_model_options(portal_config_service, bisheng_client))


@router.get("/domain-file-counts")
async def get_domain_file_counts(
    background_tasks: BackgroundTasks,
    service: DomainFileCountService = Depends(get_domain_file_count_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    cache_service: PortalHomeCacheService = Depends(get_portal_home_cache_service),
):
    domains = portal_config_service.get_config().domains
    codes = sorted({d.code.strip().upper() for d in domains if d.code and d.code.strip()})
    cache_key = cache_service.domain_file_counts_key(codes)
    cached = await cache_service.get_json(cache_key)
    if isinstance(cached, dict):
        cached_counts = cached.get("counts")
        if isinstance(cached_counts, dict) and set(cached_counts) == set(codes):
            try:
                return response_ok({"counts": {code: int(cached_counts[code]) for code in codes}})
            except (TypeError, ValueError):
                logger.warning("domain file counts cache payload is invalid key=%s", cache_key, exc_info=True)
    counts, stale = service.read_cached(codes)
    if stale and codes:
        background_tasks.add_task(service.refresh_in_background, codes)
    if not stale:
        await cache_service.set_json(
            cache_key,
            {"counts": counts},
            _home_cache_ttl_seconds(portal_config_service.get_config()),
        )
    return response_ok({"counts": counts})


@router.get("/spaces")
async def list_visible_spaces(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.list_visible_spaces())
    finally:
        await bisheng_client.aclose()


@router.get("/qa/tree/spaces")
async def list_qa_tree_spaces(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.list_public_spaces())

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.list_visible_spaces())
    finally:
        await bisheng_client.aclose()


@router.get("/qa/tree/spaces/{space_id}/children")
async def list_qa_tree_children(
    space_id: int,
    request: Request,
    parent_id: Optional[int] = Query(default=None),
    cursor: Optional[str] = Query(default=None),
    page_size: int = Query(default=10, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        public_space_ids = {space.id for space in (await service.list_public_spaces()).data}
        if space_id not in public_space_ids:
            raise HTTPException(status_code=403, detail="未登录仅可浏览公共知识库目录")
        try:
            return response_ok(
                await service.get_qa_tree_children(
                    space_id=space_id,
                    parent_id=parent_id,
                    cursor=cursor,
                    page_size=page_size,
                )
            )
        except BishengBusinessError as err:
            # _raise_qa_tree_children_error 必定抛 HTTPException(不会 fall through)
            _raise_qa_tree_children_error(err)

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        # 信任上游 /children 的读权限校验:不再自己全量拉取可见空间做预检。
        try:
            return response_ok(
                await service.get_qa_tree_children(
                    space_id=space_id,
                    parent_id=parent_id,
                    cursor=cursor,
                    page_size=page_size,
                )
            )
        except BishengBusinessError as err:
            # _raise_qa_tree_children_error 必定抛 HTTPException(不会 fall through)
            _raise_qa_tree_children_error(err)
    finally:
        await bisheng_client.aclose()


@router.post("/qa/tree/spaces/{space_id}/folder-stats")
async def get_qa_tree_folder_stats(
    space_id: int,
    body: QaKnowledgeFolderStatsRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        public_space_ids = {space.id for space in (await service.list_public_spaces()).data}
        if space_id not in public_space_ids:
            raise HTTPException(status_code=403, detail="未登录仅可浏览公共知识库目录")
        try:
            return response_ok(await service.get_qa_tree_folder_stats(space_id, body.folder_ids))
        except BishengBusinessError as err:
            _raise_qa_tree_children_error(err)

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        try:
            return response_ok(await service.get_qa_tree_folder_stats(space_id, body.folder_ids))
        except BishengBusinessError as err:
            _raise_qa_tree_children_error(err)
    finally:
        await bisheng_client.aclose()


@router.get("/qa/files/search")
async def search_qa_files_by_name(
    request: Request,
    q: str = Query(..., min_length=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=await get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        space_ids = [space.id for space in (await service.list_public_spaces()).data]
        return response_ok(
            await service.search_qa_files_by_name(
                q=q,
                space_ids=space_ids,
                page=page,
                page_size=page_size,
            )
        )

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        visible_spaces = await service.list_visible_spaces()
        space_ids = [space.id for space in visible_spaces.data]
        return response_ok(
            await service.search_qa_files_by_name(
                q=q,
                space_ids=space_ids,
                page=page,
                page_size=page_size,
            )
        )
    finally:
        await bisheng_client.aclose()


@router.get("/personal-spaces")
async def list_personal_spaces(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.list_personal_spaces())
    finally:
        await bisheng_client.aclose()


@router.post("/favorites")
async def create_favorite(
    req: FavoriteDocumentRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        result = await service.create_favorite(req)
        await PortalTelemetryService(bisheng_client).record_event(
            event_type="portal_favorite",
            source_app="shougang_portal",
            scene="search_result_favorite",
            entry_point="search_result_favorite",
            resource_type="document",
            source_space_id=req.source_space_id,
            source_file_id=req.source_file_id,
            space_id=req.source_space_id,
            file_id=req.source_file_id,
        )
        return response_ok(result)
    except BishengBusinessError as err:
        if err.status_code == _BISHENG_DUPLICATE_FAVORITE_CODE:
            raise HTTPException(status_code=409, detail="该文档已收藏到所选个人知识库") from err
        raise HTTPException(status_code=502, detail=err.status_message) from err
    finally:
        await bisheng_client.aclose()


@router.post("/favorites/remove")
async def remove_favorite(
    req: FavoriteRemoveRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.remove_favorite(req))
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        await bisheng_client.aclose()


@router.post("/favorites/status")
async def favorite_status(
    req: FavoriteStatusRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.favorite_status(req))
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        await bisheng_client.aclose()


@router.get("/favorites/files")
async def list_favorites(
    request: Request,
    page: int = 1,
    page_size: int = 20,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.list_favorites(page=page, page_size=page_size))
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        await bisheng_client.aclose()


@router.post("/share-links")
async def create_share_link(
    req: ShareDocumentRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = KnowledgeService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
        )
        return response_ok(await service.create_share_link(req))
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        await bisheng_client.aclose()


@router.get("/share-links/{share_token}")
async def get_share_link_meta(
    share_token: str,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    try:
        return response_ok(await service.get_share_link_meta(share_token))
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)


@router.post("/share-links/{share_token}/access")
async def access_share_link(
    share_token: str,
    req: ShareDocumentAccessRequest,
    response: Response,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = await get_portal_session(auth_service, request)
    metadata_service = KnowledgeService(
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
    )
    try:
        meta = await metadata_service.get_share_link_meta(share_token)
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)

    if meta.visibility == "department" and session is None:
        raise HTTPException(status_code=401, detail="仅本部门分享需要登录后访问")

    scoped_client = auth_service.create_bisheng_client(session) if session is not None else bisheng_client
    should_close_scoped_client = session is not None
    try:
        service = KnowledgeService(
            bisheng_client=scoped_client,
            portal_config_service=portal_config_service,
        )
        access = await service.verify_share_link_access(share_token, req)
        share_session = KnowledgeService.create_share_access_session(access)
        response.set_cookie(
            key=SHARE_ACCESS_COOKIE_NAME,
            value=share_session.session_id,
            httponly=True,
            samesite="lax",
            max_age=SHARE_ACCESS_TTL_SECONDS,
            path="/",
        )
        return response_ok(access)
    except BishengBusinessError as err:
        _raise_bisheng_business_error(err)
    finally:
        if should_close_scoped_client:
            await scoped_client.aclose()


@router.get("/space/{space_id}/files")
async def list_space_files(
    space_id: int,
    request: Request,
    file_ext: Optional[str] = None,
    document_type: Optional[str] = None,
    file_subcategory_code: Optional[str] = None,
    tag: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        return response_ok(
            await service.list_space_files(
                space_id=space_id,
                file_ext=file_ext,
                document_type=file_subcategory_code or document_type,
                tag=tag,
                page=page,
                page_size=page_size,
                extra_space_ids=extra_space_ids,
            )
        )
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.get("/space/{space_id}/tags")
async def get_space_tags(
    space_id: int,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        return response_ok(await service.get_space_tags(space_id, extra_space_ids=extra_space_ids))
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.get("/space/{space_id}/files/{file_id}")
async def get_file_detail(
    space_id: int,
    file_id: int,
    request: Request,
    share_token: Optional[str] = None,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    if share_token:
        _require_share_access(request, share_token, space_id, file_id)
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        detail = await service.get_file_detail(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        return response_ok(detail)
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.get("/space/{space_id}/files/{file_id}/preview")
async def get_file_preview(
    space_id: int,
    file_id: int,
    request: Request,
    share_token: Optional[str] = None,
    entry_point: Optional[str] = Query(default=None),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    share_session = _require_share_access(request, share_token, space_id, file_id) if share_token else None
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        preview = await service.get_file_preview(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        if preview is not None:
            await PortalTelemetryService(service._bisheng).record_event(
                event_type="portal_document_read",
                source_app="shougang_portal",
                scene="document_preview",
                entry_point=entry_point or "search_result_preview",
                resource_type="document",
                space_id=space_id,
                file_id=file_id,
            )
        if preview and share_session and not share_session.allow_download:
            preview.download_url = ""
        if (
            preview
            and not preview.viewer_url
            and preview.source_kind != "none"
            and preview.mode not in {"unsupported", "chunks"}
        ):
            query = f"source_kind={preview.source_kind}"
            if share_token:
                query = f"{query}&share_token={quote(share_token)}"
            preview.viewer_url = (
                f"/api/v1/knowledge/space/{space_id}/files/{file_id}/preview/content"
                f"?{query}"
            )
        return response_ok(preview)
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.get("/space/{space_id}/files/{file_id}/preview/content")
async def get_file_preview_content(
    space_id: int,
    file_id: int,
    request: Request,
    source_kind: Optional[FilePreviewSourceKind] = Query(default=None),
    share_token: Optional[str] = None,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    if share_token:
        _require_share_access(request, share_token, space_id, file_id)
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        source = await service.resolve_preview_content_source(
            space_id=space_id,
            file_id=file_id,
            requested_source_kind=source_kind,
            extra_space_ids=extra_space_ids,
        )
        if source is None or not source.url:
            raise HTTPException(status_code=404, detail="未找到可预览内容")

        forwarded_headers = {
            header_name: request.headers[header_name]
            for header_name in ("range", "if-range", "if-none-match", "if-modified-since")
            if header_name in request.headers
        }
        # Keep the upstream response open until StreamingResponse finishes. This
        # prevents a large PDF from being buffered in the BFF and preserves 206.
        upstream = await service._bisheng.open_preview_asset_stream(
            source.url,
            headers=forwarded_headers or None,
        )
        response_headers = {"Cache-Control": "private, no-store"}
        for header_name in (
            "accept-ranges",
            "content-disposition",
            "content-length",
            "content-range",
            "content-type",
            "etag",
            "last-modified",
        ):
            header_value = upstream.headers.get(header_name)
            if header_value:
                response_headers[header_name] = header_value

        scoped_client = client_to_close
        client_to_close = None

        async def stream_body():
            try:
                if upstream.is_stream_consumed:
                    yield upstream.content
                    return
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
                if scoped_client is not None:
                    await scoped_client.aclose()

        return StreamingResponse(
            stream_body(),
            status_code=upstream.status_code,
            headers=response_headers,
        )
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.get("/space/{space_id}/files/{file_id}/chunks")
async def get_file_chunks(
    space_id: int,
    file_id: int,
    request: Request,
    share_token: Optional[str] = None,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    if share_token:
        _require_share_access(request, share_token, space_id, file_id)
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        chunks = await service.get_file_chunks(
            space_id=space_id, file_id=file_id, extra_space_ids=extra_space_ids
        )
        return response_ok(chunks)
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.post("/space/{space_id}/files/{file_id}/chat")
async def chat_document_file(
    space_id: int,
    file_id: int,
    req: DocumentFileChatRequest,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    try:
        upstream = service.stream_document_file_chat(space_id=space_id, file_id=file_id, req=req)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

    async def stream():
        telemetry_recorded = False
        async for chunk in upstream:
            if not telemetry_recorded:
                await PortalTelemetryService(service._bisheng).record_event(
                    event_type="portal_qa",
                    source_app="shougang_portal",
                    scene="search_result_document_qa",
                    entry_point="search_result_document_qa",
                    resource_type="document",
                    space_id=space_id,
                    file_id=file_id,
                )
                telemetry_recorded = True
            yield chunk

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/space/{space_id}/files/{file_id}/related")
async def get_related_files(
    space_id: int,
    file_id: int,
    request: Request,
    limit: int = 3,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    service, extra_space_ids, client_to_close = await _scoped_service_and_extra_ids(
        request, auth_service, bisheng_client, portal_config_service
    )
    try:
        return response_ok(
            await service.get_related_files(
                space_id=space_id,
                file_id=file_id,
                limit=limit,
                extra_space_ids=extra_space_ids,
            )
        )
    finally:
        if client_to_close is not None:
            await client_to_close.aclose()


@router.post("/space/{space_id}/files/{file_id}/download-event")
async def record_file_download_event(
    space_id: int,
    file_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    """Record a download telemetry event for a file. Best-effort, always returns 200."""
    async def _record() -> None:
        telemetry = PortalTelemetryService(bisheng_client)
        await telemetry.record_event(
            event_type="portal_document_download",
            source_app="shougang_portal",
            scene="document_download",
            entry_point="detail_page",
            resource_type="document",
            space_id=space_id,
            file_id=file_id,
        )
    background_tasks.add_task(_record)
    return response_ok({"accepted": True})


@router.post("/publish/precheck")
async def publish_precheck(
    payload: PublishPrecheckRequest,
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    config = portal_config_service.get_config()
    result = DomainConsistencyService().check(
        payload.file_encoding,
        payload.target_space_id,
        config.domains,
    )
    return response_ok(result)
