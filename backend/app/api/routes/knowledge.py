import asyncio
import logging
from typing import Annotated, Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_bisheng_client, get_portal_auth_service, get_portal_config_service
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
    ShareDocumentAccessRequest,
    ShareDocumentRequest,
)
from app.schemas.portal_config import PortalConfig
from app.services.domain_consistency_service import DomainConsistencyService
from app.services.domain_file_count_service import DomainFileCountService
from app.services.knowledge_service import (
    SHARE_ACCESS_COOKIE_NAME,
    SHARE_ACCESS_TTL_SECONDS,
    BishengBusinessError,
    KnowledgeService,
    ShareAccessSession,
)
from app.services.portal_auth_service import PortalAuthError, PortalAuthService
from app.services.portal_config_service import PortalConfigService
from app.services.portal_telemetry_service import PortalTelemetryService, PortalTelemetryStatsError
from app.settings import get_settings

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])
logger = logging.getLogger(__name__)

_BISHENG_DUPLICATE_FAVORITE_CODE = 18021
_BISHENG_PERMISSION_DENIED_CODE = 18040


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


def _raise_bisheng_business_error(err: BishengBusinessError) -> None:
    status_code = 403 if err.status_code in {_BISHENG_PERMISSION_DENIED_CODE, 404} else 502
    raise HTTPException(status_code=status_code, detail=err.status_message)


async def _fetch_shougang_portal_space_info(
    bisheng_client: BishengClient,
    space_ids: list[int],
) -> dict[int, dict]:
    if not space_ids:
        return {}
    try:
        response = await bisheng_client.post_json(
            "/api/v1/knowledge/shougang-portal/spaces/info",
            json={"space_ids": space_ids},
        )
    except Exception:
        return {}
    data = response.get("data") or {}
    raw_spaces = data.get("spaces") if isinstance(data, dict) else []
    if not isinstance(raw_spaces, list):
        return {}
    live_space_data: dict[int, dict] = {}
    for item in raw_spaces:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        item_data = item.get("data") or {}
        live_space_data[int(item["id"])] = item_data if isinstance(item_data, dict) else {}
    return live_space_data


def _normalize_document_types(raw_items: Any) -> list[dict[str, str]]:
    if not isinstance(raw_items, list):
        return []
    document_types: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "").strip().upper()
        label = str(item.get("label") or item.get("name") or "").strip()
        if not code or not label or code in seen:
            continue
        seen.add(code)
        document_types.append({"code": code, "label": label})
    return document_types


async def _fetch_shougang_document_types(bisheng_client: BishengClient) -> list[dict[str, str]]:
    try:
        response = await bisheng_client.get_json("/api/v1/workstation/config")
    except Exception:
        logger.warning("failed to fetch shougang document types", exc_info=True)
        return []
    data = response.get("data") if isinstance(response, dict) else {}
    shougang = data.get("shougang") if isinstance(data, dict) else {}
    file_encoding = shougang.get("file_encoding") if isinstance(shougang, dict) else {}
    return _normalize_document_types(file_encoding.get("document_types") if isinstance(file_encoding, dict) else [])


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
    session = auth_service.get_session(request)
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
    space_ids: Annotated[Optional[list[int]], Query()] = None,
    space_level: Optional[str] = None,
    file_ext: Optional[str] = None,
    document_type: Optional[str] = None,
    sort: str = "updated_at",
    page: int = 1,
    page_size: int = 20,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = auth_service.get_session(request)

    # 未登录：系统客户端（常驻单例，勿关闭），范围 = 后台启用库
    if session is None:
        service = KnowledgeService(
            bisheng_client=get_bisheng_client(request),
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        return response_ok(
            await service.search_files(
                q=q,
                tag=tag,
                requested_space_ids=space_ids,
                space_level=space_level,
                file_ext=file_ext,
                document_type=document_type,
                sort=sort,
                page=page,
                page_size=page_size,
                extra_space_ids=None,
            )
        )

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
                requested_space_ids=space_ids,
                space_level=space_level,
                file_ext=file_ext,
                document_type=document_type,
                sort=sort,
                page=page,
                page_size=page_size,
                extra_space_ids=extra_space_ids,
            )
        )
    finally:
        await bisheng_client.aclose()


@router.get("/tags")
async def get_aggregated_tags(
    space_ids: Annotated[Optional[list[int]], Query()] = None,
    space_level: Optional[str] = None,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(await service.get_aggregated_tags(requested_space_ids=space_ids, space_level=space_level))


@router.get("/home")
async def get_home_content(
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(await service.get_home_content())


@router.get("/home/stats")
async def get_home_stats(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        counts = await PortalTelemetryService(bisheng_client).fetch_home_stats_counts()
    except PortalTelemetryStatsError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    total_documents = sum(
        space.file_count
        for space in portal_config_service.get_config().spaces
        if space.enabled
    )
    return response_ok(HomeStatsData(total_documents=total_documents, **counts))


@router.get("/config")
async def get_portal_config(
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    config = portal_config_service.get_config()
    live_space_data, document_types = await asyncio.gather(
        _fetch_shougang_portal_space_info(
            bisheng_client,
            [space.id for space in config.spaces],
        ),
        _fetch_shougang_document_types(bisheng_client),
    )
    runtime_config = portal_config_service.with_live_space_data(config, live_space_data)
    return response_ok(PortalConfig.model_validate({
        **runtime_config.model_dump(mode="json"),
        "document_types": document_types,
    }))


@router.get("/domain-file-counts")
async def get_domain_file_counts(
    background_tasks: BackgroundTasks,
    service: DomainFileCountService = Depends(get_domain_file_count_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    domains = portal_config_service.get_config().domains
    codes = sorted({d.code.strip().upper() for d in domains if d.code and d.code.strip()})
    counts, stale = service.read_cached(codes)
    if stale and codes:
        background_tasks.add_task(service.refresh_in_background, codes)
    return response_ok({"counts": counts})


@router.get("/spaces")
async def list_visible_spaces(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    try:
        session = auth_service.require_session(request)
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
    session = auth_service.get_session(request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        return response_ok(service.list_public_config_spaces())

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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = auth_service.get_session(request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        public_space_ids = {space.id for space in service.list_public_config_spaces().data}
        if space_id not in public_space_ids:
            raise HTTPException(status_code=403, detail="未登录仅可浏览公共知识库目录")
        return response_ok(
            await service.get_qa_tree_children(
                space_id=space_id,
                parent_id=parent_id,
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
        visible_space_ids = {space.id for space in (await service.list_visible_spaces()).data}
        if space_id not in visible_space_ids:
            raise HTTPException(status_code=403, detail="包含无权限或不存在的知识库")
        return response_ok(
            await service.get_qa_tree_children(
                space_id=space_id,
                parent_id=parent_id,
                page=page,
                page_size=page_size,
            )
        )
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
    session = auth_service.get_session(request)
    if session is None:
        service = KnowledgeService(
            bisheng_client=get_bisheng_client(request),
            portal_config_service=portal_config_service,
        )
        space_ids = [space.id for space in service.list_public_config_spaces().data]
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
        session = auth_service.require_session(request)
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
        session = auth_service.require_session(request)
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
        session = auth_service.require_session(request)
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
        session = auth_service.require_session(request)
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
        session = auth_service.require_session(request)
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
        session = auth_service.require_session(request)
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
    session = auth_service.get_session(request)
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
                document_type=document_type,
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

        # Read the asset through the same scoped client so BiSheng authorizes it.
        upstream = await service._bisheng.get_preview_asset(source.url)
        headers = {"Cache-Control": "no-store"}
        content_type = upstream.headers.get("content-type")
        content_length = upstream.headers.get("content-length")
        if content_length:
            headers["Content-Length"] = content_length
        return Response(
            content=upstream.content,
            media_type=content_type,
            headers=headers,
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
