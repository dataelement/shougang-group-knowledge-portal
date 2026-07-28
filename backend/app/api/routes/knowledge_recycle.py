"""Portal BFF proxy for BiSheng knowledge recycle-bin APIs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.dependencies import get_portal_auth_service, require_admin_session
from app.services.portal_auth_service import PortalAuthService, PortalSession

router = APIRouter(prefix="/api/v1/knowledge_recycle", tags=["knowledge-recycle"])


def _raise_if_bisheng_error(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    status = payload.get("status_code", payload.get("status"))
    if status not in (None, 200):
        raise HTTPException(
            status_code=400,
            detail=payload.get("status_message") or payload.get("msg") or "请求失败",
        )
    return payload.get("data", payload)


async def _with_user_client(
    auth_service: PortalAuthService,
    session: PortalSession,
):
    client = auth_service.create_bisheng_client(session)
    try:
        yield client
    finally:
        await client.aclose()


@router.get("/config")
async def get_config(
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.get_json("/api/v1/knowledge_recycle/config")
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()


@router.put("/config")
async def update_config(
    request: Request,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    body = await request.json()
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.put_json("/api/v1/knowledge_recycle/config", json=body)
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()


@router.get("/items")
async def list_items(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    knowledge_id: int | None = None,
    space_level: str | None = None,
    file_type: int | None = None,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    params: dict[str, Any] = {"page": page, "page_size": page_size}
    if keyword:
        params["keyword"] = keyword
    if knowledge_id is not None:
        params["knowledge_id"] = knowledge_id
    if space_level:
        params["space_level"] = space_level
    if file_type is not None:
        params["file_type"] = file_type
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.get_json("/api/v1/knowledge_recycle/items", params=params)
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()


@router.post("/restore/preview")
async def preview_restore(
    request: Request,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    body = await request.json()
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.post_json("/api/v1/knowledge_recycle/restore/preview", json=body)
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()


@router.post("/restore")
async def restore_items(
    request: Request,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    body = await request.json()
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.post_json("/api/v1/knowledge_recycle/restore", json=body)
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()


@router.post("/purge")
async def purge_items(
    request: Request,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    body = await request.json()
    client = auth_service.create_bisheng_client(session)
    try:
        payload = await client.post_json("/api/v1/knowledge_recycle/purge", json=body)
        return _raise_if_bisheng_error(payload)
    finally:
        await client.aclose()
