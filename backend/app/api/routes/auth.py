from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from app.api.dependencies import get_portal_auth_service, get_portal_unified_auth_service
from app.schemas.auth import PortalAuthData, PortalLoginRequest, PortalUnifiedAuthConfigData
from app.schemas.common import response_ok
from app.services.portal_auth_service import PortalAuthError, PortalAuthService
from app.services.portal_unified_auth_service import (
    STATE_COOKIE_NAME,
    UnifiedAuthFailure,
    UnifiedAuthUnavailable,
    PortalUnifiedAuthService,
    log_unified_auth_trace,
    normalize_redirect,
)

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


@router.get("/unified/config")
async def get_unified_auth_config(
    service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
):
    config = service.get_public_config()
    return response_ok(PortalUnifiedAuthConfigData(**config.model_dump()))


@router.get("/unified/start")
async def start_unified_auth(
    redirect: str = "/",
    service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
):
    try:
        start = service.build_start(redirect)
    except UnifiedAuthUnavailable:
        return RedirectResponse(service.build_failure_redirect_url("oauth_unavailable", redirect))
    response = RedirectResponse(start.authorize_url)
    service.set_state_cookie(response, start.state, start.max_age)
    return response


@router.get("/unified/callback")
async def unified_auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    try:
        result = await service.complete_callback(
            code=code,
            state=state,
            cookie_state=request.cookies.get(STATE_COOKIE_NAME),
        )
    except (UnifiedAuthFailure, UnifiedAuthUnavailable) as err:
        auth_error = err.auth_error if isinstance(err, UnifiedAuthFailure) else "oauth_unavailable"
        redirect = err.redirect if isinstance(err, UnifiedAuthFailure) else "/"
        response = RedirectResponse(service.build_failure_redirect_url(auth_error, redirect))
        service.clear_state_cookie(response)
        return response
    response = RedirectResponse(result.redirect)
    service.clear_state_cookie(response)
    auth_service.attach_session_cookie(response, result.session, remember=True)
    return response


@router.get("/unified/logout/start")
async def start_unified_auth_logout(
    request: Request,
    redirect: str = "/login",
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    safe_redirect = normalize_redirect(redirect)
    if safe_redirect == "/":
        safe_redirect = "/login"

    response = RedirectResponse(safe_redirect)
    auth_service.logout(request)
    auth_service.clear_session_cookie(response)
    return response


@router.get("/unified/logout/callback")
async def unified_auth_logout_callback(
    request: Request,
    redirect: str = "/login",
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    safe_redirect = normalize_redirect(redirect)
    if safe_redirect == "/":
        safe_redirect = "/login"
    response = RedirectResponse(safe_redirect)
    auth_service.logout(request)
    auth_service.clear_session_cookie(response)
    return response


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
    if session.auth_source == "unified_auth" or session.auth_trace_id or recovered:
        log_unified_auth_trace(
            session.auth_trace_id,
            "auth_me",
            "session_restored",
            {
                "recovered": recovered,
                "auth_source": session.auth_source,
                "auth_trace_id": session.auth_trace_id,
                "session_id": session.session_id,
                "access_token": session.access_token,
                "expires_at": session.expires_at,
                "user": session.user.model_dump(),
            },
        )
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
