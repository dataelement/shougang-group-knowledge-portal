from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.api.dependencies import get_portal_auth_service
from app.schemas.auth import PortalAuthData, PortalLoginRequest
from app.schemas.common import response_ok
from app.services.portal_auth_service import PortalAuthError, PortalAuthService

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login")
async def login(
    payload: PortalLoginRequest,
    response: Response,
    service: PortalAuthService = Depends(get_portal_auth_service),
):
    account = payload.account.strip()
    if not account:
        raise HTTPException(status_code=400, detail="请输入账号")
    try:
        session = await service.login(
            account=account,
            password=payload.password,
            remember=payload.remember,
            captcha_key=payload.captcha_key.strip(),
            captcha=payload.captcha.strip(),
        )
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    service.attach_session_cookie(response, session, remember=payload.remember)
    return response_ok(PortalAuthData(user=session.user))


@router.get("/me")
async def get_me(
    request: Request,
    response: Response,
    service: PortalAuthService = Depends(get_portal_auth_service),
):
    try:
        session, recovered = await service.require_session_or_bisheng_cookie(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    if recovered:
        service.attach_session_cookie(response, session, remember=True)
    return response_ok(PortalAuthData(user=session.user))


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    service: PortalAuthService = Depends(get_portal_auth_service),
):
    service.logout(request)
    service.clear_session_cookie(response)
    return response_ok({"ok": True})
