from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

import logging

from app.api.dependencies import (
    get_portal_auth_service,
    get_portal_rest_auth_service,
    get_portal_unified_auth_service,
    get_rest_auth_runtime_service,
)
from app.schemas.auth import (
    PortalAuthData,
    PortalLoginRequest,
    PortalRestExchangeRequest,
    PortalRestLoginRequest,
    PortalUnifiedAuthConfigData,
)
from app.schemas.common import UnifiedResponseModel, response_ok
from app.services.portal_auth_service import PortalAuthError, PortalAuthService, PortalMultiLoginConflictError
from app.services.portal_rest_auth_service import RestAuthUnavailable, resolve_client_ip
from app.services.portal_unified_auth_service import (
    PENDING_LOGIN_COOKIE_NAME,
    STATE_COOKIE_NAME,
    UnifiedAuthFailure,
    UnifiedAuthPendingConfirmation,
    UnifiedAuthUnavailable,
    PortalUnifiedAuthService,
    log_unified_auth_trace,
    normalize_redirect,
)
from app.services.rest_auth_runtime_service import RestAuthRuntimeService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _rest_config_snapshot(rest_runtime_service: RestAuthRuntimeService) -> dict:
    return rest_runtime_service.get_public_config().model_dump(mode="json")


def _log_auth_failure(
    route: str,
    *,
    status_code: int,
    message: str,
    **context: object,
) -> None:
    logger.warning(
        "auth request failed: route=%s status_code=%s message=%s context=%s",
        route,
        status_code,
        message,
        context,
    )


def _build_public_auth_config(
    *,
    unified_service: PortalUnifiedAuthService,
    rest_runtime_service: RestAuthRuntimeService,
) -> PortalUnifiedAuthConfigData:
    rest_public = rest_runtime_service.get_public_config()
    rest_ready = rest_public.enabled and not rest_public.missing_fields
    oauth_config = unified_service.get_public_config()
    label = oauth_config.label or "统一身份认证"

    if rest_ready:
        return PortalUnifiedAuthConfigData(
            enabled=True,
            auth_mode="rest",
            provider=oauth_config.provider or "rest",
            label=label,
            rest_token_id_param=rest_public.rest_token_id_param or "tokenId",
            unavailable_reason="",
            missing_fields=[],
        )

    if oauth_config.enabled:
        return PortalUnifiedAuthConfigData(
            enabled=True,
            auth_mode="oauth",
            provider=oauth_config.provider,
            label=label,
            rest_token_id_param=rest_public.rest_token_id_param or "tokenId",
            unavailable_reason=oauth_config.unavailable_reason,
            missing_fields=oauth_config.missing_fields,
        )

    missing_fields = list(rest_public.missing_fields or oauth_config.missing_fields)
    unavailable_reason = oauth_config.unavailable_reason or (
        "rest_unavailable" if rest_public.enabled else ""
    )
    return PortalUnifiedAuthConfigData(
        enabled=False,
        auth_mode="none",
        provider=oauth_config.provider or "custom",
        label=label,
        rest_token_id_param=rest_public.rest_token_id_param or "tokenId",
        unavailable_reason=unavailable_reason,
        missing_fields=missing_fields,
    )


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
            force_login=payload.force_login,
        )
    except PortalMultiLoginConflictError as err:
        return JSONResponse(
            status_code=err.status_code,
            content=UnifiedResponseModel(
                status_code=err.code,
                status_message=err.message,
                data={"code": err.code},
            ).model_dump(mode="json"),
        )
    except PortalAuthError as err:
        _log_auth_failure(
            "POST /login",
            status_code=err.status_code,
            message=err.message,
            account=account,
            force_login=payload.force_login,
        )
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    service.attach_session_cookie(response, session, remember=payload.remember)
    return response_ok(PortalAuthData(user=session.user, auth_source=session.auth_source))


@router.get("/unified/config")
async def get_unified_auth_config(
    unified_service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
    rest_runtime_service: RestAuthRuntimeService = Depends(get_rest_auth_runtime_service),
):
    return response_ok(
        _build_public_auth_config(
            unified_service=unified_service,
            rest_runtime_service=rest_runtime_service,
        )
    )


@router.post("/rest/exchange")
async def rest_auth_exchange(
    request: Request,
    payload: PortalRestExchangeRequest,
    response: Response,
    rest_service=Depends(get_portal_rest_auth_service),
    rest_runtime_service: RestAuthRuntimeService = Depends(get_rest_auth_runtime_service),
):
    client_ip = resolve_client_ip(request)
    try:
        result = await rest_service.exchange(
            token_id=payload.token_id,
            redirect=payload.redirect,
            client_ip=client_ip,
            remember=payload.remember,
        )
    except RestAuthUnavailable as err:
        _log_auth_failure(
            "POST /rest/exchange",
            status_code=503,
            message="统一认证 REST 暂不可用",
            reason=err.reason,
            client_ip=client_ip,
            redirect=payload.redirect,
            rest_config=_rest_config_snapshot(rest_runtime_service),
        )
        raise HTTPException(status_code=503, detail="统一认证 REST 暂不可用") from err
    except UnifiedAuthFailure as err:
        status_code = 403 if err.auth_error == "user_unregistered" else 401
        _log_auth_failure(
            "POST /rest/exchange",
            status_code=status_code,
            message=err.auth_error,
            auth_error=err.auth_error,
            client_ip=client_ip,
            redirect=err.redirect,
            rest_config=_rest_config_snapshot(rest_runtime_service),
        )
        if err.auth_error == "user_unregistered":
            return JSONResponse(
                status_code=403,
                content=UnifiedResponseModel(
                    status_code=403,
                    status_message="您未在本系统注册，请联系管理员",
                    data={"code": "user_unregistered"},
                ).model_dump(mode="json"),
            )
        raise HTTPException(status_code=401, detail=err.auth_error) from err
    rest_service.attach_rest_cookies(
        response,
        session=result.session,
        remember=payload.remember,
        token_id=result.token_id,
    )
    return response_ok(
        PortalAuthData(user=result.session.user, auth_source=result.session.auth_source)
    )


@router.post("/rest/login")
async def rest_auth_login(
    request: Request,
    payload: PortalRestLoginRequest,
    response: Response,
    rest_service=Depends(get_portal_rest_auth_service),
    rest_runtime_service: RestAuthRuntimeService = Depends(get_rest_auth_runtime_service),
):
    account = payload.account.strip()
    if not account:
        raise HTTPException(status_code=400, detail="请输入账号")
    client_ip = resolve_client_ip(request)
    try:
        result = await rest_service.login_with_password(
            account=account,
            password=payload.password,
            remember=payload.remember,
            redirect=payload.redirect,
            captcha_key=payload.captcha_key.strip(),
            captcha=payload.captcha.strip(),
            force_login=payload.force_login,
            client_ip=client_ip,
        )
    except RestAuthUnavailable as err:
        _log_auth_failure(
            "POST /rest/login",
            status_code=503,
            message="登录服务暂不可用，请稍后重试",
            reason=err.reason,
            account=account,
            client_ip=client_ip,
            redirect=payload.redirect,
            force_login=payload.force_login,
            rest_config=_rest_config_snapshot(rest_runtime_service),
        )
        raise HTTPException(status_code=503, detail="登录服务暂不可用，请稍后重试") from err
    except PortalAuthError as err:
        _log_auth_failure(
            "POST /rest/login",
            status_code=err.status_code,
            message=err.message,
            account=account,
            client_ip=client_ip,
            redirect=payload.redirect,
            force_login=payload.force_login,
            auth_path="local",
            rest_config=_rest_config_snapshot(rest_runtime_service),
        )
        raise HTTPException(status_code=err.status_code, detail=err.message) from err
    except PortalMultiLoginConflictError as err:
        return JSONResponse(
            status_code=err.status_code,
            content=UnifiedResponseModel(
                status_code=err.code,
                status_message=err.message,
                data={"code": err.code},
            ).model_dump(mode="json"),
        )
    except UnifiedAuthFailure as err:
        status_code = 403 if err.auth_error == "user_unregistered" else 401
        _log_auth_failure(
            "POST /rest/login",
            status_code=status_code,
            message=err.auth_error,
            account=account,
            client_ip=client_ip,
            redirect=err.redirect,
            auth_error=err.auth_error,
            auth_path="iam_rest",
            rest_config=_rest_config_snapshot(rest_runtime_service),
        )
        if err.auth_error == "user_unregistered":
            return JSONResponse(
                status_code=403,
                content=UnifiedResponseModel(
                    status_code=403,
                    status_message="您未在本系统注册，请联系管理员",
                    data={"code": "user_unregistered"},
                ).model_dump(mode="json"),
            )
        raise HTTPException(status_code=401, detail=err.auth_error) from err
    rest_service.attach_rest_cookies(
        response,
        session=result.session,
        remember=payload.remember,
        token_id=result.token_id,
    )
    return response_ok(
        PortalAuthData(user=result.session.user, auth_source=result.session.auth_source)
    )


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
    except UnifiedAuthPendingConfirmation as err:
        response = RedirectResponse(service.build_failure_redirect_url("multi_login_conflict", err.redirect))
        service.clear_state_cookie(response)
        service.set_pending_login_cookie(response, err.pending_id)
        return response
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


@router.post("/unified/confirm")
async def confirm_unified_auth_login(
    request: Request,
    response: Response,
    service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    try:
        result = await service.confirm_pending_login(request.cookies.get(PENDING_LOGIN_COOKIE_NAME))
    except (UnifiedAuthFailure, UnifiedAuthUnavailable) as err:
        service.clear_pending_login_cookie(response)
        detail = err.auth_error if isinstance(err, UnifiedAuthFailure) else "oauth_unavailable"
        raise HTTPException(status_code=400, detail=detail) from err
    service.clear_pending_login_cookie(response)
    auth_service.attach_session_cookie(response, result.session, remember=True)
    return response_ok(PortalAuthData(user=result.session.user, auth_source=result.session.auth_source))


@router.get("/unified/logout/start")
async def start_unified_auth_logout(
    request: Request,
    redirect: str = "/",
    service: PortalUnifiedAuthService = Depends(get_portal_unified_auth_service),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    rest_service=Depends(get_portal_rest_auth_service),
):
    safe_redirect = normalize_redirect(redirect)
    target = safe_redirect
    if auth_service.is_unified_auth_request(request):
        try:
            target = service.build_logout_start(safe_redirect).logout_url
        except UnifiedAuthUnavailable:
            target = safe_redirect

    response = RedirectResponse(target)
    await auth_service.logout(request)
    auth_service.clear_session_cookie(response)
    rest_service.clear_idp_token_cookie(response)
    return response


@router.get("/unified/logout/callback")
async def unified_auth_logout_callback(
    request: Request,
    redirect: str = "/",
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
    rest_service=Depends(get_portal_rest_auth_service),
):
    safe_redirect = normalize_redirect(redirect)
    response = RedirectResponse(safe_redirect)
    await auth_service.logout(request)
    auth_service.clear_session_cookie(response)
    rest_service.clear_idp_token_cookie(response)
    return response


@router.get("/me")
async def get_me(
    request: Request,
    response: Response,
    service: PortalAuthService = Depends(get_portal_auth_service),
    rest_service=Depends(get_portal_rest_auth_service),
):
    try:
        session, recovered = await service.require_session_or_bisheng_cookie(request)
        await rest_service.ensure_rest_session_valid(request, session)
    except PortalAuthError as err:
        has_session_cookie = bool(request.cookies.get(service.cookie_name, "").strip())
        has_bisheng_cookie = bool(request.cookies.get("access_token_cookie", "").strip())
        auth_source = service.get_auth_source(request)
        log_fn = logger.info if err.message == "请先登录" else logger.warning
        log_fn(
            "auth me failed: status_code=%s message=%s has_session_cookie=%s "
            "has_bisheng_cookie=%s auth_source=%s idp_token_present=%s",
            err.status_code,
            err.message,
            has_session_cookie,
            has_bisheng_cookie,
            auth_source,
            bool(request.cookies.get("sg_idp_token_id", "").strip()),
        )
        rest_service.clear_idp_token_cookie(response)
        service.clear_session_cookie(response)
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
    return response_ok(PortalAuthData(user=session.user, auth_source=session.auth_source))


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    service: PortalAuthService = Depends(get_portal_auth_service),
    rest_service=Depends(get_portal_rest_auth_service),
):
    await service.logout(request)
    service.clear_session_cookie(response)
    rest_service.clear_idp_token_cookie(response)
    return response_ok({"ok": True})
