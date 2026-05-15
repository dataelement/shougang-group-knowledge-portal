from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from app.api.dependencies import get_bisheng_client, get_portal_auth_service, get_portal_config_service
from app.clients.bisheng import BishengClient
from app.schemas.common import response_ok
from app.schemas.knowledge import FilePreviewSourceKind
from app.services.knowledge_service import KnowledgeService
from app.services.portal_auth_service import PortalAuthError, PortalAuthService
from app.services.portal_config_service import PortalConfigService

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


def get_knowledge_service(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
) -> KnowledgeService:
    return KnowledgeService(
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
    )


@router.get("/files")
async def search_files(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    space_ids: Annotated[Optional[list[int]], Query()] = None,
    space_level: Optional[str] = None,
    file_ext: Optional[str] = None,
    sort: str = "updated_at",
    page: int = 1,
    page_size: int = 20,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(
        await service.search_files(
            q=q,
            tag=tag,
            requested_space_ids=space_ids,
            space_level=space_level,
            file_ext=file_ext,
            sort=sort,
            page=page,
            page_size=page_size,
        )
    )


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


@router.get("/space/{space_id}/files")
async def list_space_files(
    space_id: int,
    file_ext: Optional[str] = None,
    tag: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(
        await service.list_space_files(
            space_id=space_id,
            file_ext=file_ext,
            tag=tag,
            page=page,
            page_size=page_size,
        )
    )


@router.get("/space/{space_id}/tags")
async def get_space_tags(
    space_id: int,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(await service.get_space_tags(space_id))


@router.get("/space/{space_id}/files/{file_id}")
async def get_file_detail(
    space_id: int,
    file_id: int,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    detail = await service.get_file_detail(space_id=space_id, file_id=file_id)
    return response_ok(detail)


@router.get("/space/{space_id}/files/{file_id}/preview")
async def get_file_preview(
    space_id: int,
    file_id: int,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    preview = await service.get_file_preview(space_id=space_id, file_id=file_id)
    if preview and preview.source_kind != "none" and preview.mode not in {"unsupported", "chunks"}:
        preview.viewer_url = (
            f"/api/v1/knowledge/space/{space_id}/files/{file_id}/preview/content"
            f"?source_kind={preview.source_kind}"
        )
    return response_ok(preview)


@router.get("/space/{space_id}/files/{file_id}/preview/content")
async def get_file_preview_content(
    space_id: int,
    file_id: int,
    source_kind: Optional[FilePreviewSourceKind] = Query(default=None),
    service: KnowledgeService = Depends(get_knowledge_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    source = await service.resolve_preview_content_source(
        space_id=space_id,
        file_id=file_id,
        requested_source_kind=source_kind,
    )
    if source is None or not source.url:
        raise HTTPException(status_code=404, detail="PREVIEW_CONTENT_NOT_FOUND")

    upstream = await bisheng_client.get_preview_asset(source.url)
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


@router.get("/space/{space_id}/files/{file_id}/chunks")
async def get_file_chunks(
    space_id: int,
    file_id: int,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    chunks = await service.get_file_chunks(space_id=space_id, file_id=file_id)
    return response_ok(chunks)


@router.get("/space/{space_id}/files/{file_id}/related")
async def get_related_files(
    space_id: int,
    file_id: int,
    limit: int = 3,
    service: KnowledgeService = Depends(get_knowledge_service),
):
    return response_ok(
        await service.get_related_files(
            space_id=space_id,
            file_id=file_id,
            limit=limit,
        )
    )
