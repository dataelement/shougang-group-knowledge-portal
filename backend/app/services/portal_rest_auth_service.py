import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx
from fastapi import Request
from fastapi.responses import Response

from app.services.portal_auth_service import (
    PortalAuthError,
    PortalAuthService,
    PortalMultiLoginConflictError,
    PortalSession,
)
from app.services.portal_bisheng_user_lookup import PortalBishengUserLookup, is_local_bisheng_user
from app.services.portal_unified_auth_service import (
    MappedUnifiedUser,
    UnifiedAuthFailure,
    UnifiedAuthLoginConflict,
    map_rest_user_attributes,
    normalize_redirect,
    log_unified_auth_failure,
    log_unified_auth_trace,
    PortalUnifiedAuthService,
)
from app.services.rest_auth_runtime_service import RestAuthRuntimeService
from app.settings import Settings

logger = logging.getLogger(__name__)

IDP_TOKEN_COOKIE_NAME = "sg_idp_token_id"
REST_AUTH_SOURCE = "rest_auth"
LOCAL_AUTH_SOURCE = "local"

_SENSITIVE_REST_FORM_KEYS = frozenset({"password", "tokenid"})


class RestAuthUnavailable(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class RestAuthInternalConfig:
    enabled: bool
    app_id: str
    authenticate_url: str
    token_valid_url: str
    user_attributes_url: str
    http_timeout_seconds: float
    token_check_interval_seconds: int
    verify_tls: bool
    login_sync_hmac_secret: str
    login_sync_signature_header: str
    rest_token_id_param: str
    bisheng_lookup_required: bool


def rest_config_trace_payload(config: RestAuthInternalConfig) -> dict[str, Any]:
    return {
        "app_id": config.app_id,
        "authenticate_url": config.authenticate_url,
        "token_valid_url": config.token_valid_url,
        "user_attributes_url": config.user_attributes_url,
        "http_timeout_seconds": config.http_timeout_seconds,
        "token_check_interval_seconds": config.token_check_interval_seconds,
        "verify_tls": config.verify_tls,
        "login_sync_signature_header": config.login_sync_signature_header,
        "has_login_sync_hmac_secret": bool(config.login_sync_hmac_secret),
        "rest_token_id_param": config.rest_token_id_param,
        "bisheng_lookup_required": config.bisheng_lookup_required,
    }


def rest_form_payload_trace(payload: dict[str, str]) -> dict[str, str]:
    traced: dict[str, str] = {}
    for key, value in payload.items():
        if key.lower() in _SENSITIVE_REST_FORM_KEYS:
            traced[key] = "***"
        else:
            traced[key] = value
    return traced


def format_rest_http_error(err: httpx.HTTPError) -> dict[str, Any]:
    details: dict[str, Any] = {
        "error": str(err) or repr(err),
        "error_type": type(err).__name__,
    }
    response = getattr(err, "response", None)
    if response is not None:
        details["status_code"] = response.status_code
        try:
            details["response_text"] = (response.text or "")[:500]
        except Exception as read_err:
            details["response_text_error"] = str(read_err)
    return details


@dataclass(frozen=True)
class RestAuthResult:
    session: PortalSession
    redirect: str
    trace_id: str
    token_id: str = ""


def resolve_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").strip()
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


class PortalRestAuthService:
    def __init__(
        self,
        *,
        settings: Settings,
        auth_service: PortalAuthService,
        unified_auth_service: PortalUnifiedAuthService,
        config_service: RestAuthRuntimeService,
        user_lookup: PortalBishengUserLookup,
        cookie_secure: bool,
        http_client_factory: Callable[[], Any] | None = None,
        clock: Callable[[], float] = time.time,
        nonce_factory: Callable[[int], str] = secrets.token_urlsafe,
    ):
        self._settings = settings
        self._auth_service = auth_service
        self._unified_auth_service = unified_auth_service
        self._config_service = config_service
        self._user_lookup = user_lookup
        self._cookie_secure = cookie_secure
        self._http_client_factory = http_client_factory
        self._clock = clock
        self._nonce_factory = nonce_factory
        self._last_token_checks: dict[str, float] = {}

    def resolve_config(self) -> RestAuthInternalConfig:
        runtime = self._config_service.get_config()
        missing = self._config_service.list_missing_fields(runtime)
        runtime_snapshot = {
            **self._config_service.get_public_config().model_dump(mode="json"),
        }
        if not runtime.enabled:
            logger.warning(
                "REST auth unavailable: reason=disabled runtime=%s",
                runtime_snapshot,
            )
            raise RestAuthUnavailable("disabled")
        if missing:
            logger.warning(
                "REST auth unavailable: reason=missing_fields fields=%s runtime=%s",
                missing,
                runtime_snapshot,
            )
            raise RestAuthUnavailable(",".join(missing))
        base_url = runtime.rest_base_url.rstrip("/")
        return RestAuthInternalConfig(
            enabled=True,
            app_id=runtime.rest_app_id.strip(),
            authenticate_url=runtime.authenticate_url.strip()
            or f"{base_url}/idp/restful/IDPAuthenticate",
            token_valid_url=runtime.token_valid_url.strip()
            or f"{base_url}/idp/restful/isIDPTokenValid",
            user_attributes_url=runtime.user_attributes_url.strip()
            or f"{base_url}/idp/restful/getIDPUserAttributes",
            http_timeout_seconds=runtime.http_timeout_seconds,
            token_check_interval_seconds=runtime.token_check_interval_seconds,
            verify_tls=runtime.verify_tls,
            login_sync_hmac_secret=self._config_service.get_effective_login_sync_hmac_secret(runtime),
            login_sync_signature_header=runtime.login_sync_signature_header or "X-Signature",
            rest_token_id_param=runtime.rest_token_id_param or "tokenId",
            bisheng_lookup_required=runtime.bisheng_lookup_required,
        )

    def get_public_auth_config(self) -> dict[str, Any]:
        runtime = self._config_service.get_config()
        missing = self._config_service.list_missing_fields(runtime)
        ready = runtime.enabled and not missing
        return {
            "rest_enabled": ready,
            "rest_token_id_param": runtime.rest_token_id_param or "tokenId",
            "missing_fields": missing,
        }

    async def exchange(
        self,
        *,
        token_id: str,
        redirect: str | None,
        client_ip: str,
        remember: bool = True,
        force_login: bool = False,
    ) -> RestAuthResult:
        config = self.resolve_config()
        safe_redirect = normalize_redirect(redirect)
        trace_id = self._nonce_factory(16)
        normalized_token = token_id.strip()
        if not normalized_token:
            raise UnifiedAuthFailure("invalid_callback", safe_redirect)

        log_unified_auth_trace(
            trace_id,
            "rest_exchange",
            "start",
            {"redirect": safe_redirect, "rest_config": rest_config_trace_payload(config)},
        )
        if not await self._is_token_valid(config, normalized_token, client_ip, trace_id, safe_redirect):
            raise UnifiedAuthFailure("token_expired", safe_redirect)

        user_payload = await self._fetch_user_attributes(
            config,
            normalized_token,
            client_ip,
            trace_id,
            safe_redirect,
        )
        mapped_user = map_rest_user_attributes(user_payload)
        session = await self._complete_rest_session(
            config,
            mapped_user=mapped_user,
            token_id=normalized_token,
            redirect=safe_redirect,
            trace_id=trace_id,
            remember=remember,
            force_login=force_login,
        )
        return RestAuthResult(
            session=session,
            redirect=safe_redirect,
            trace_id=trace_id,
            token_id=normalized_token,
        )

    async def login_with_password(
        self,
        *,
        account: str,
        password: str,
        remember: bool,
        redirect: str | None,
        captcha_key: str = "",
        captcha: str = "",
        force_login: bool = False,
        client_ip: str,
    ) -> RestAuthResult:
        self.resolve_config()
        normalized_account = account.strip()
        safe_redirect = normalize_redirect(redirect)
        trace_id = self._nonce_factory(16)

        source = await self._resolve_user_source(normalized_account, trace_id, safe_redirect)
        if is_local_bisheng_user(source):
            logger.info(
                "REST login routing to local BiSheng password: account=%s source=%s trace_id=%s",
                normalized_account,
                source,
                trace_id,
            )
            try:
                session = await self._auth_service.login(
                    account=normalized_account,
                    password=password,
                    remember=remember,
                    captcha_key=captcha_key,
                    captcha=captcha,
                    force_login=force_login,
                    auth_source=LOCAL_AUTH_SOURCE,
                )
            except PortalMultiLoginConflictError:
                raise
            except PortalAuthError as err:
                logger.warning(
                    "REST local login failed: account=%s trace_id=%s status_code=%s message=%s",
                    normalized_account,
                    trace_id,
                    err.status_code,
                    err.message,
                )
                raise
            log_unified_auth_trace(
                trace_id,
                "rest_login",
                "local_session_created",
                {"account": normalized_account, "auth_source": LOCAL_AUTH_SOURCE},
            )
            return RestAuthResult(session=session, redirect=safe_redirect, trace_id=trace_id)

        config = self.resolve_config()
        logger.info(
            "REST login routing to IAM REST: account=%s source=%s trace_id=%s",
            normalized_account,
            source,
            trace_id,
        )
        log_unified_auth_trace(
            trace_id,
            "rest_login",
            "iam_start",
            {
                "account": normalized_account,
                "client_ip": client_ip,
                "rest_config": rest_config_trace_payload(config),
            },
        )
        token_id = await self._authenticate(
            config,
            normalized_account,
            password,
            client_ip,
            trace_id,
            safe_redirect,
        )
        if not await self._is_token_valid(config, token_id, client_ip, trace_id, safe_redirect):
            raise UnifiedAuthFailure("token_expired", safe_redirect)

        user_payload = await self._fetch_user_attributes(
            config,
            token_id,
            client_ip,
            trace_id,
            safe_redirect,
        )
        mapped_user = map_rest_user_attributes(user_payload)
        session = await self._complete_rest_session(
            config,
            mapped_user=mapped_user,
            token_id=token_id,
            redirect=safe_redirect,
            trace_id=trace_id,
            remember=remember,
            force_login=force_login,
        )
        return RestAuthResult(
            session=session,
            redirect=safe_redirect,
            trace_id=trace_id,
            token_id=token_id,
        )

    async def ensure_rest_session_valid(self, request: Request, session: PortalSession) -> None:
        if session.auth_source != REST_AUTH_SOURCE:
            return
        config = self.resolve_config()
        token_id = request.cookies.get(IDP_TOKEN_COOKIE_NAME, "").strip()
        if not token_id:
            raise PortalAuthError("统一认证已过期，请重新登录", status_code=401)

        now = self._clock()
        last_checked = self._last_token_checks.get(session.session_id, 0.0)
        if now - last_checked < config.token_check_interval_seconds:
            return

        client_ip = resolve_client_ip(request)
        trace_id = session.auth_trace_id or self._nonce_factory(8)
        valid = await self._is_token_valid(
            config,
            token_id,
            client_ip,
            trace_id,
            "/",
            raise_on_failure=False,
        )
        self._last_token_checks[session.session_id] = now
        if not valid:
            raise PortalAuthError("统一认证已过期，请重新登录", status_code=401)

    def attach_rest_cookies(
        self,
        response: Response,
        *,
        session: PortalSession,
        remember: bool,
        token_id: str = "",
    ) -> None:
        self._auth_service.attach_session_cookie(response, session, remember=remember)
        max_age = max(0, int(session.expires_at - self._clock())) if remember else None
        if token_id:
            response.set_cookie(
                key=IDP_TOKEN_COOKIE_NAME,
                value=token_id,
                httponly=True,
                secure=self._cookie_secure,
                samesite="lax",
                max_age=max_age,
                path="/",
            )
        else:
            self.clear_idp_token_cookie(response)

    def clear_idp_token_cookie(self, response: Response) -> None:
        response.set_cookie(
            key=IDP_TOKEN_COOKIE_NAME,
            value="",
            max_age=0,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            path="/",
        )

    async def _resolve_user_source(
        self,
        account: str,
        trace_id: str,
        redirect: str,
    ) -> str | None:
        config = self._config_service.get_config()
        try:
            return await self._user_lookup.resolve_user_source(account)
        except Exception as err:
            logger.warning("BiSheng 用户 source 查询失败: %s", err)
            log_unified_auth_failure(
                trace_id,
                "rest_unavailable",
                redirect,
                "bisheng_user_lookup_failed",
                {"error": str(err), "error_type": type(err).__name__},
            )
            if config.bisheng_lookup_required:
                raise RestAuthUnavailable("bisheng_lookup_failed") from err
            return None

    async def _complete_rest_session(
        self,
        config: RestAuthInternalConfig,
        *,
        mapped_user: MappedUnifiedUser,
        token_id: str,
        redirect: str,
        trace_id: str,
        remember: bool,
        force_login: bool,
    ) -> PortalSession:
        try:
            access_token = await self._unified_auth_service.login_sync_mapped_user(
                mapped_user,
                redirect,
                trace_id,
                login_sync_hmac_secret=config.login_sync_hmac_secret,
                login_sync_signature_header=config.login_sync_signature_header,
                http_timeout_seconds=config.http_timeout_seconds,
                force_login=force_login,
            )
        except UnifiedAuthLoginConflict:
            raise PortalMultiLoginConflictError()
        except UnifiedAuthFailure:
            raise

        try:
            session = await self._auth_service.create_session_from_access_token(
                access_token=access_token,
                remember=remember,
                fallback_account=mapped_user.external_user_id,
                auth_source=REST_AUTH_SOURCE,
                auth_trace_id=trace_id,
                replace_existing=force_login,
            )
        except PortalAuthError as err:
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "session_create_failed",
                {"error": err.message, "status_code": err.status_code},
            )
            raise UnifiedAuthFailure("permission_denied", redirect) from err

        log_unified_auth_trace(
            trace_id,
            "rest_session",
            "session_created",
            {
                "redirect": redirect,
                "auth_source": REST_AUTH_SOURCE,
                "session_id": session.session_id,
            },
        )
        return session

    async def _authenticate(
        self,
        config: RestAuthInternalConfig,
        account: str,
        password: str,
        client_ip: str,
        trace_id: str,
        redirect: str,
    ) -> str:
        payload = {
            "appId": config.app_id,
            "userName": account,
            "password": password,
            "authnMethod": "UsernamePassword",
            "remoteIp": client_ip,
        }
        log_unified_auth_trace(
            trace_id,
            "rest_authenticate",
            "request",
            {
                "url": config.authenticate_url,
                "account": account,
                "client_ip": client_ip,
                "form": rest_form_payload_trace(payload),
                "rest_config": rest_config_trace_payload(config),
            },
        )
        response_payload = await self._post_form(
            config,
            config.authenticate_url,
            payload,
            trace_id,
            redirect,
            failure_code="oauth_token_failed",
        )
        data = response_payload.get("data") if isinstance(response_payload.get("data"), dict) else response_payload
        token_id = str(data.get("tokenId") or "").strip()
        if not token_id:
            log_unified_auth_failure(
                trace_id,
                "oauth_token_failed",
                redirect,
                "authenticate_missing_token",
                {"payload": response_payload},
            )
            raise UnifiedAuthFailure("oauth_token_failed", redirect)
        return token_id

    async def _is_token_valid(
        self,
        config: RestAuthInternalConfig,
        token_id: str,
        client_ip: str,
        trace_id: str,
        redirect: str,
        *,
        raise_on_failure: bool = True,
    ) -> bool:
        payload = {
            "appId": config.app_id,
            "tokenId": token_id,
            "remoteIp": client_ip,
        }
        log_unified_auth_trace(
            trace_id,
            "rest_token_valid",
            "request",
            {
                "url": config.token_valid_url,
                "client_ip": client_ip,
                "form": rest_form_payload_trace(payload),
                "rest_config": rest_config_trace_payload(config),
            },
        )
        response_payload = await self._post_form(
            config,
            config.token_valid_url,
            payload,
            trace_id,
            redirect,
            failure_code="token_expired",
            raise_on_failure=raise_on_failure,
        )
        data = response_payload.get("data") if isinstance(response_payload.get("data"), dict) else response_payload
        is_valid = data.get("isValid")
        if isinstance(is_valid, str):
            is_valid = is_valid.strip().lower() in {"true", "1", "yes"}
        valid = bool(is_valid)
        if not valid and raise_on_failure:
            raise UnifiedAuthFailure("token_expired", redirect)
        return valid

    async def _fetch_user_attributes(
        self,
        config: RestAuthInternalConfig,
        token_id: str,
        client_ip: str,
        trace_id: str,
        redirect: str,
    ) -> dict[str, Any]:
        params = {
            "appId": config.app_id,
            "tokenId": token_id,
            "remoteIp": client_ip,
            "attributeNames": "loginName,uid,mail,mobile,displayName",
        }
        log_unified_auth_trace(
            trace_id,
            "rest_user_attributes",
            "request",
            {
                "url": config.user_attributes_url,
                "params": {**params, "tokenId": "***" if params.get("tokenId") else ""},
                "rest_config": rest_config_trace_payload(config),
            },
        )
        client = self._make_http_client(config.http_timeout_seconds, verify_tls=config.verify_tls)
        try:
            response = await client.get(config.user_attributes_url, params=params)
            response.raise_for_status()
            payload = response.json()
            log_unified_auth_trace(
                trace_id,
                "rest_user_attributes",
                "response",
                {"status_code": response.status_code, "payload": payload},
            )
        except httpx.HTTPError as err:
            error_details = format_rest_http_error(err)
            logger.warning(
                "IAM getIDPUserAttributes 调用失败: url=%s verify_tls=%s app_id=%s details=%s",
                config.user_attributes_url,
                config.verify_tls,
                config.app_id,
                error_details,
            )
            log_unified_auth_failure(
                trace_id,
                "oauth_userinfo_failed",
                redirect,
                "user_attributes_http_error",
                {
                    **error_details,
                    "rest_config": rest_config_trace_payload(config),
                },
            )
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect) from err
        except ValueError as err:
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect) from err
        finally:
            await self._close_http_client(client)

        if not isinstance(payload, dict):
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect)
        return payload

    async def _post_form(
        self,
        config: RestAuthInternalConfig,
        url: str,
        payload: dict[str, str],
        trace_id: str,
        redirect: str,
        *,
        failure_code: str,
        raise_on_failure: bool = True,
    ) -> dict[str, Any]:
        client = self._make_http_client(config.http_timeout_seconds, verify_tls=config.verify_tls)
        try:
            response = await client.post(url, data=payload)
            response.raise_for_status()
            body = response.json()
            log_unified_auth_trace(
                trace_id,
                "rest_http",
                "response",
                {"url": url, "status_code": response.status_code, "payload": body},
            )
        except httpx.HTTPError as err:
            error_details = format_rest_http_error(err)
            logger.warning(
                "IAM REST 调用失败: url=%s verify_tls=%s app_id=%s form=%s details=%s",
                url,
                config.verify_tls,
                config.app_id,
                rest_form_payload_trace(payload),
                error_details,
            )
            if raise_on_failure:
                log_unified_auth_failure(
                    trace_id,
                    failure_code,
                    redirect,
                    "rest_http_error",
                    {
                        "url": url,
                        **error_details,
                        "form": rest_form_payload_trace(payload),
                        "rest_config": rest_config_trace_payload(config),
                    },
                )
                raise UnifiedAuthFailure(failure_code, redirect) from err
            return {}
        except ValueError as err:
            if raise_on_failure:
                raise UnifiedAuthFailure(failure_code, redirect) from err
            return {}
        finally:
            await self._close_http_client(client)

        if not isinstance(body, dict):
            if raise_on_failure:
                raise UnifiedAuthFailure(failure_code, redirect)
            return {}
        return body

    def _make_http_client(self, timeout_seconds: float, *, verify_tls: bool = True):
        if self._http_client_factory is not None:
            return self._http_client_factory()
        return httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=False,
            verify=verify_tls,
        )

    @staticmethod
    async def _close_http_client(client: Any) -> None:
        close = getattr(client, "aclose", None)
        if close is not None:
            await close()
