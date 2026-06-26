from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    get_bisheng_client,
    get_bisheng_runtime_service,
    get_portal_auth_service,
    get_portal_config_service,
)
from app.clients.bisheng import BishengClient
from app.schemas.chat import PortalChatCompletionRequest
from app.schemas.common import response_ok
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.chat_proxy_service import ChatProxyService
from app.services.error_messages import normalize_user_facing_message
from app.services.portal_auth_service import PortalAuthError, PortalAuthService
from app.services.portal_config_service import PortalConfigService
from app.services.portal_telemetry_service import PortalTelemetryService
from app.settings import get_settings

router = APIRouter(prefix="/api/v1/workstation", tags=["chat-proxy"])


def get_chat_proxy_service(
    bisheng_client: BishengClient = Depends(get_bisheng_client),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_runtime_service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
) -> ChatProxyService:
    return ChatProxyService(
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
        default_model=get_settings().bisheng_default_model,
    )


def _require_portal_session(request: Request, auth_service: PortalAuthService):
    try:
        return auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err


def _normalize_upload_payload(payload: dict, fallback_file_id: str, fallback_filename: str) -> dict:
    if payload.get("status_code") not in (None, 200):
        status_code = payload.get("status_code")
        raise HTTPException(
            status_code=502,
            detail=normalize_user_facing_message(
                payload.get("status_message"),
                fallback="附件上传失败",
                status_code=int(status_code) if isinstance(status_code, int) else None,
            ),
        )
    data = payload.get("data", payload)
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="附件上传失败")
    return {
        "file_id": str(data.get("file_id") or fallback_file_id),
        "temp_file_id": str(data.get("temp_file_id") or fallback_file_id),
        "filepath": str(data.get("filepath") or data.get("file_path") or ""),
        "filename": str(data.get("filename") or data.get("file_name") or fallback_filename),
        "type": str(data.get("type") or ""),
        "context": str(data.get("context") or "message_attachment"),
        "message": str(data.get("message") or "File uploaded successfully"),
    }


@router.get("/chat/list")
async def list_conversations(
    request: Request,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = _require_portal_session(request, auth_service)
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = ChatProxyService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        return response_ok(await service.list_conversations(page=page, limit=limit))
    except ValueError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    finally:
        await bisheng_client.aclose()


@router.get("/workflow/conversations")
async def list_workflow_conversations(
    request: Request,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = _require_portal_session(request, auth_service)
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = ChatProxyService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        return response_ok(await service.list_agent_workflow_conversations(page=page, limit=limit))
    except ValueError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    finally:
        await bisheng_client.aclose()


@router.get("/messages/{conversation_id}")
async def get_conversation_messages(
    conversation_id: str,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = _require_portal_session(request, auth_service)
    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = ChatProxyService(
            bisheng_client=bisheng_client,
            portal_config_service=portal_config_service,
            default_model=get_settings().bisheng_default_model,
        )
        return response_ok(await service.get_conversation_messages(conversation_id))
    except ValueError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    finally:
        await bisheng_client.aclose()


@router.post("/files")
async def upload_chat_attachment(
    request: Request,
    file: UploadFile = File(...),
    file_id: str = Form(default=""),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    session = auth_service.get_session(request)
    is_anonymous = session is None
    bisheng_client = get_bisheng_client(request) if is_anonymous else auth_service.create_bisheng_client(session)
    temp_file_id = file_id.strip() or uuid4().hex
    filename = file.filename or "attachment"
    try:
        payload = await bisheng_client.post_multipart(
            "/api/v1/workstation/files",
            data={"file_id": temp_file_id, "file_name": filename},
            files={"file": (filename, file.file, file.content_type or "application/octet-stream")},
        )
        return response_ok(_normalize_upload_payload(payload, temp_file_id, filename))
    except httpx.HTTPError as err:
        raise HTTPException(status_code=502, detail="附件上传失败") from err
    finally:
        await file.close()
        if not is_anonymous:
            await bisheng_client.aclose()


@router.post("/chat/completions")
async def chat_completions(
    payload: PortalChatCompletionRequest,
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    session = auth_service.get_session(request)
    is_anonymous = session is None
    if is_anonymous:
        # 未登录：系统客户端（常驻单例，请求结束后勿关闭）
        bisheng_client = get_bisheng_client(request)
    else:
        # 已登录：个人 token 客户端，用完需关闭
        bisheng_client = auth_service.create_bisheng_client(session)

    async def _close_owned_client() -> None:
        if not is_anonymous:
            await bisheng_client.aclose()

    service = ChatProxyService(
        bisheng_client=bisheng_client,
        portal_config_service=portal_config_service,
        default_model=get_settings().bisheng_default_model,
        is_anonymous=is_anonymous,
    )
    try:
        path, request_body, trailing_events = await service.build_chat_request(payload)
    except ValueError as err:
        await _close_owned_client()
        raise HTTPException(status_code=400, detail=str(err)) from err
    except PermissionError as err:
        await _close_owned_client()
        raise HTTPException(status_code=403, detail=str(err)) from err

    async def stream():
        telemetry_recorded = False
        try:
            async for chunk in service.stream_prepared_chat_completion(path, request_body):
                if not telemetry_recorded and path == "/api/v1/workstation/shougang-portal/chat/completions":
                    await PortalTelemetryService(bisheng_client).record_event(
                        event_type="portal_qa",
                        source_app="shougang_portal",
                        scene="smart_qa",
                        entry_point=payload.entry_point or "qa_page",
                        resource_type="knowledge_space",
                        conversation_id=payload.conversationId,
                    )
                    telemetry_recorded = True
                yield chunk
            for event in trailing_events:
                yield event
        finally:
            await _close_owned_client()

    return StreamingResponse(stream(), media_type="text/event-stream")
