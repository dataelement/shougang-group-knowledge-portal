import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlencode

import httpx
from fastapi.responses import Response

from app.schemas.auth import PortalUnifiedAuthConfigData
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_auth_service import PortalAuthError, PortalAuthService, PortalSession
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService
from app.settings import Settings

logger = logging.getLogger(__name__)

GROUP_OAUTH_BASE_URL = "https://amdev.shougang.com.cn/idp/oauth2"
STOCK_OAUTH_BASE_URL = "https://10.68.27.111/idp/oauth2"
GROUP_GLO_URL = "https://amdev.shougang.com.cn/idp/profile/OAUTH2/Redirect/GLO"
STOCK_GLO_URL = "https://10.68.27.111/idp/profile/OAUTH2/Redirect/GLO"
STATE_COOKIE_NAME = "sg_unified_auth_state"
LOGIN_SYNC_PATH = "/api/v1/internal/sso/login-sync"
SAFE_ERROR_MESSAGES = {
    "invalid_callback": "统一认证回调参数缺失",
    "invalid_state": "登录请求已失效，请重新认证",
    "oauth_token_failed": "统一认证登录失败",
    "oauth_userinfo_failed": "未能获取统一认证用户信息",
    "identity_missing": "统一认证返回用户标识不足",
    "permission_denied": "账号已认证但暂未开通知库权限",
    "oauth_unavailable": "统一认证暂不可用",
}


class UnifiedAuthUnavailable(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class UnifiedAuthFailure(Exception):
    def __init__(self, auth_error: str, redirect: str = "/"):
        super().__init__(auth_error)
        self.auth_error = auth_error
        self.redirect = normalize_redirect(redirect)


@dataclass(frozen=True)
class UnifiedAuthEndpoints:
    authorize_url: str
    token_url: str
    userinfo_url: str


@dataclass(frozen=True)
class UnifiedAuthInternalConfig:
    enabled: bool
    provider: str
    label: str
    client_id: str
    client_secret: str
    redirect_uri: str
    endpoints: UnifiedAuthEndpoints
    token_param_style: str
    state_secret: str
    state_ttl_seconds: int
    http_timeout_seconds: float
    login_sync_hmac_secret: str
    login_sync_signature_header: str
    glo_url: str
    glo_entity_id: str
    glo_redirect_to_url: str
    glo_redirect_to_login: bool


@dataclass(frozen=True)
class UnifiedAuthStart:
    authorize_url: str
    state: str
    max_age: int
    trace_id: str


@dataclass(frozen=True)
class UnifiedAuthLogoutStart:
    logout_url: str
    trace_id: str


@dataclass(frozen=True)
class UnifiedAuthResult:
    session: PortalSession
    redirect: str
    trace_id: str


@dataclass(frozen=True)
class MappedUnifiedUser:
    external_user_id: str
    user_attrs: dict[str, str]
    primary_dept_external_id: str | None = None


def normalize_redirect(target: str | None) -> str:
    value = (target or "").strip()
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    if any(ord(ch) < 32 for ch in value):
        return "/"
    return value


def compute_login_sync_signature(method: str, path: str, raw_body: bytes, secret: str) -> str:
    message = f"{method.upper()}\n{path}\n".encode("utf-8") + (raw_body or b"")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def log_unified_auth_trace(trace_id: str, stage: str, event: str, payload: dict[str, Any] | None = None) -> None:
    entry = {
        "trace_id": trace_id,
        "stage": stage,
        "event": event,
        "payload": redact_trace_payload(payload or {}),
    }
    try:
        line = json.dumps(entry, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        fallback = {
            "trace_id": trace_id,
            "stage": stage,
            "event": event,
            "payload": {"raw": str(payload)},
        }
        line = json.dumps(fallback, ensure_ascii=False, sort_keys=True)
    print(f"[portal unified auth trace] {line}")


def log_unified_auth_failure(
    trace_id: str,
    auth_error: str,
    redirect: str,
    event: str,
    payload: dict[str, Any] | None = None,
) -> None:
    details = {
        "auth_error": auth_error,
        "redirect": normalize_redirect(redirect),
    }
    if payload:
        details.update(payload)
    log_unified_auth_trace(trace_id, "failure", event, details)


def redact_trace_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _redact_value(str(key), item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_trace_payload(item) for item in value]
    if isinstance(value, tuple):
        return [redact_trace_payload(item) for item in value]
    return value


def _redact_value(key: str, value: Any) -> Any:
    key_lower = key.lower().replace("_", "-")
    sensitive_keys = {
        "access-token",
        "refresh-token",
        "token",
        "client-secret",
        "login-sync-hmac-secret",
        "state-secret",
        "password",
        "cookie",
        "set-cookie",
        "authorization",
        "signature",
        "x-signature",
        "session-id",
        "code",
    }
    if key_lower in sensitive_keys or key_lower.endswith("-token") or key_lower.endswith("-secret"):
        return _redacted_marker(value)
    return redact_trace_payload(value)


def _redacted_marker(value: Any) -> dict[str, Any]:
    if value in (None, ""):
        return {"redacted": True, "present": False, "type": type(value).__name__}
    raw = value if isinstance(value, str) else str(value)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10]
    return {
        "redacted": True,
        "present": True,
        "type": type(value).__name__,
        "length": len(raw),
        "sha256": digest,
    }


def map_unified_userinfo(userinfo_payload: dict[str, Any], token_payload: dict[str, Any]) -> MappedUnifiedUser:
    userinfo = _select_userinfo_object(userinfo_payload)
    external_user_id = (
        _first_str(userinfo, "loginName", "login_name")
        or _first_str(userinfo, "uid")
        or _first_str(token_payload, "uid")
        or _first_str(userinfo, "user_id", "userId", "account", "username", "employee_id", "staff_id")
    )
    if not external_user_id:
        raise ValueError("missing stable unified auth user identifier")

    name = (
        _first_str(
            userinfo,
            "displayName",
            "display_name",
            "real_name",
            "realName",
            "name",
            "nick_name",
            "nickname",
            "loginName",
            "login_name",
            "username",
            "uid",
        )
        or external_user_id
    )
    email = _first_str(userinfo, "email", "mail")
    phone = _first_str(userinfo, "phone", "mobile", "telephone")
    primary_dept_external_id = _first_str(userinfo, "primary_dept_external_id", "dept_id", "department_id") or None
    user_attrs = {
        "name": name,
    }
    if email:
        user_attrs["email"] = email
    if phone:
        user_attrs["phone"] = phone
    return MappedUnifiedUser(
        external_user_id=external_user_id,
        user_attrs=user_attrs,
        primary_dept_external_id=primary_dept_external_id,
    )


def _select_userinfo_object(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data")
    if isinstance(data, dict):
        merged = dict(data)
        for key, value in payload.items():
            if key != "data" and key not in merged:
                merged[key] = value
        return merged
    return payload


def _first_str(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


class PortalUnifiedAuthService:
    def __init__(
        self,
        *,
        settings: Settings,
        runtime_service: BishengRuntimeService,
        auth_service: PortalAuthService,
        cookie_secure: bool,
        config_service: UnifiedAuthRuntimeService | None = None,
        http_client_factory: Callable[[], Any] | None = None,
        clock: Callable[[], float] = time.time,
        nonce_factory: Callable[[int], str] = secrets.token_urlsafe,
    ):
        self._settings = settings
        self._runtime_service = runtime_service
        self._auth_service = auth_service
        self._cookie_secure = cookie_secure
        self._config_service = config_service
        self._http_client_factory = http_client_factory
        self._clock = clock
        self._nonce_factory = nonce_factory

    def get_public_config(self) -> PortalUnifiedAuthConfigData:
        runtime_config = self._read_runtime_config()
        provider = self._normalize_provider(runtime_config.provider)
        label = self._label_for_provider(provider)
        try:
            config = self._resolve_config()
        except UnifiedAuthUnavailable as err:
            return PortalUnifiedAuthConfigData(
                enabled=False,
                provider=provider,
                label=label,
                unavailable_reason=err.reason,
            )
        return PortalUnifiedAuthConfigData(
            enabled=True,
            provider=config.provider,
            label=config.label,
            unavailable_reason="",
        )

    def build_start(self, redirect: str | None) -> UnifiedAuthStart:
        config = self._resolve_config()
        safe_redirect = normalize_redirect(redirect)
        trace_id = self._nonce_factory(16)
        now = int(self._clock())
        state = self._encode_state(
            {
                "nonce": self._nonce_factory(24),
                "redirect": safe_redirect,
                "trace_id": trace_id,
                "iat": now,
                "exp": now + config.state_ttl_seconds,
            },
            config.state_secret,
        )
        params = {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "state": state,
        }
        separator = "&" if "?" in config.endpoints.authorize_url else "?"
        log_unified_auth_trace(
            trace_id,
            "start",
            "authorize_redirect_built",
            {
                "redirect": safe_redirect,
                "provider": config.provider,
                "label": config.label,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "redirect_uri": config.redirect_uri,
                "response_type": "code",
                "state_generated": True,
                "state_ttl_seconds": config.state_ttl_seconds,
                "state_secret": config.state_secret,
                "token_param_style": config.token_param_style,
                "login_sync_hmac_secret": config.login_sync_hmac_secret,
                "login_sync_signature_header": config.login_sync_signature_header,
                "endpoints": {
                    "authorize_url": config.endpoints.authorize_url,
                    "token_url": config.endpoints.token_url,
                    "userinfo_url": config.endpoints.userinfo_url,
                },
            },
        )
        return UnifiedAuthStart(
            authorize_url=f"{config.endpoints.authorize_url}{separator}{urlencode(params)}",
            state=state,
            max_age=config.state_ttl_seconds,
            trace_id=trace_id,
        )

    def build_logout_start(self) -> UnifiedAuthLogoutStart:
        config = self._resolve_config()
        trace_id = self._nonce_factory(16)
        required = {
            "glo_url": config.glo_url,
            "glo_entity_id": config.glo_entity_id,
            "glo_redirect_to_url": config.glo_redirect_to_url,
        }
        if any(not value for value in required.values()):
            log_unified_auth_trace(
                trace_id,
                "logout",
                "glo_config_missing",
                {
                    "provider": config.provider,
                    "glo_url": config.glo_url,
                    "glo_entity_id": config.glo_entity_id,
                    "glo_redirect_to_url": config.glo_redirect_to_url,
                    "glo_redirect_to_login": config.glo_redirect_to_login,
                },
            )
            raise UnifiedAuthUnavailable("missing_glo_config")

        params = {
            "redirctToUrl": config.glo_redirect_to_url,
            "redirectToLogin": "true" if config.glo_redirect_to_login else "false",
            "entityId": config.glo_entity_id,
        }
        separator = "&" if "?" in config.glo_url else "?"
        logout_url = f"{config.glo_url}{separator}{urlencode(params)}"
        log_unified_auth_trace(
            trace_id,
            "logout",
            "glo_redirect_built",
            {
                "provider": config.provider,
                "label": config.label,
                "glo_url": config.glo_url,
                "params": params,
                "logout_url": logout_url,
            },
        )
        return UnifiedAuthLogoutStart(logout_url=logout_url, trace_id=trace_id)

    async def complete_callback(self, *, code: str | None, state: str | None, cookie_state: str | None) -> UnifiedAuthResult:
        if not code or not state:
            log_unified_auth_failure(
                "",
                "invalid_callback",
                "/",
                "callback_missing_params",
                {
                    "code_present": bool(code),
                    "state_present": bool(state),
                    "cookie_state_present": bool(cookie_state),
                },
            )
            raise UnifiedAuthFailure("invalid_callback", "/")
        if not cookie_state or cookie_state != state:
            log_unified_auth_failure(
                "",
                "invalid_state",
                "/",
                "state_cookie_mismatch",
                {
                    "code_present": True,
                    "state_present": True,
                    "cookie_state_present": bool(cookie_state),
                },
            )
            raise UnifiedAuthFailure("invalid_state", "/")

        config = self._resolve_config()
        try:
            state_payload = self._decode_state(state, config.state_secret)
        except UnifiedAuthFailure as err:
            log_unified_auth_failure(
                "",
                err.auth_error,
                err.redirect,
                "state_decode_failed",
                {
                    "code_present": True,
                    "state_present": True,
                    "cookie_state_present": True,
                },
            )
            raise
        trace_id = str(state_payload.get("trace_id") or "")
        redirect = normalize_redirect(str(state_payload.get("redirect") or "/"))
        log_unified_auth_trace(
            trace_id,
            "callback",
            "callback_received",
            {
                "code": code,
                "state_present": True,
                "cookie_state_present": True,
                "redirect": redirect,
            },
        )
        log_unified_auth_trace(
            trace_id,
            "state",
            "state_validated",
            {
                "nonce_present": bool(state_payload.get("nonce")),
                "trace_id": trace_id,
                "redirect": redirect,
                "iat": state_payload.get("iat"),
                "exp": state_payload.get("exp"),
            },
        )

        token_payload = await self._exchange_token(config, code, redirect, trace_id)
        access_token = _first_str(token_payload, "access_token")
        if not access_token:
            log_unified_auth_failure(
                trace_id,
                "oauth_token_failed",
                redirect,
                "missing_access_token",
                {"token_payload": token_payload},
            )
            raise UnifiedAuthFailure("oauth_token_failed", redirect)

        userinfo_payload = await self._fetch_userinfo(config, access_token, redirect, trace_id)
        log_unified_auth_trace(
            trace_id,
            "get_userinfo",
            "raw_userinfo",
            {"userinfo_payload": userinfo_payload},
        )
        # 开发测试阶段临时打印，用于确认统一认证 getUserInfo 的真实字段。
        print(
            "[portal unified auth getUserInfo raw] "
            + json.dumps({"trace_id": trace_id, "payload": userinfo_payload}, ensure_ascii=False, sort_keys=True)
        )

        try:
            mapped_user = map_unified_userinfo(userinfo_payload, token_payload)
        except ValueError as err:
            logger.warning("统一认证用户信息缺少稳定标识: %s", err)
            log_unified_auth_failure(
                trace_id,
                "identity_missing",
                redirect,
                "mapper_identity_missing",
                {
                    "error": str(err),
                    "userinfo_payload": userinfo_payload,
                    "token_payload": token_payload,
                },
            )
            raise UnifiedAuthFailure("identity_missing", redirect) from err
        log_unified_auth_trace(
            trace_id,
            "mapper",
            "mapped_user",
            {
                "userinfo_payload": userinfo_payload,
                "token_payload": token_payload,
                "mapped_user": {
                    "external_user_id": mapped_user.external_user_id,
                    "user_attrs": mapped_user.user_attrs,
                    "primary_dept_external_id": mapped_user.primary_dept_external_id,
                },
            },
        )

        bisheng_token = await self._login_sync(config, mapped_user, redirect, trace_id)
        try:
            session = await self._auth_service.create_session_from_access_token(
                access_token=bisheng_token,
                remember=True,
                fallback_account=mapped_user.external_user_id,
                auth_source="unified_auth",
                auth_trace_id=trace_id,
            )
        except PortalAuthError as err:
            logger.warning("统一认证换签后创建门户 session 失败: %s", err.message)
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "session_create_failed",
                {
                    "error": err.message,
                    "status_code": err.status_code,
                    "fallback_account": mapped_user.external_user_id,
                },
            )
            raise UnifiedAuthFailure("permission_denied", redirect) from err
        log_unified_auth_trace(
            trace_id,
            "session",
            "session_created",
            {
                "redirect": redirect,
                "session_id": session.session_id,
                "access_token": session.access_token,
                "user": session.user.model_dump(),
                "expires_at": session.expires_at,
                "auth_source": session.auth_source,
                "auth_trace_id": session.auth_trace_id,
            },
        )
        return UnifiedAuthResult(session=session, redirect=redirect, trace_id=trace_id)

    def build_failure_redirect_url(self, auth_error: str, redirect: str | None = "/") -> str:
        safe_error = auth_error if auth_error in SAFE_ERROR_MESSAGES else "oauth_unavailable"
        params = urlencode({"auth_error": safe_error, "redirect": normalize_redirect(redirect)})
        return f"/login?{params}"

    def set_state_cookie(self, response: Response, state: str, max_age: int) -> None:
        response.set_cookie(
            key=STATE_COOKIE_NAME,
            value=state,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            max_age=max_age,
            path="/",
        )

    def clear_state_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=STATE_COOKIE_NAME,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            path="/",
        )

    def _read_runtime_config(self) -> UnifiedAuthRuntimeConfig:
        if self._config_service is not None:
            return self._config_service.get_config()

        login_sync_secret = self._secret_value(
            self._settings.unified_auth_login_sync_hmac_secret,
        ) or self._secret_value(self._settings.unified_auth_bisheng_hmac_secret)
        login_sync_header = (
            self._settings.unified_auth_login_sync_signature_header
            or self._settings.unified_auth_bisheng_signature_header
            or "X-Signature"
        )
        return UnifiedAuthRuntimeConfig(
            enabled=self._settings.unified_auth_enabled,
            provider=self._settings.unified_auth_provider,
            client_id=self._settings.unified_auth_client_id,
            client_secret=self._secret_value(self._settings.unified_auth_client_secret),
            redirect_uri=self._settings.unified_auth_redirect_uri,
            authorize_url=self._settings.unified_auth_authorize_url,
            token_url=self._settings.unified_auth_token_url,
            userinfo_url=self._settings.unified_auth_userinfo_url,
            token_param_style=self._settings.unified_auth_token_param_style,
            state_secret=self._secret_value(self._settings.unified_auth_state_secret),
            state_ttl_seconds=self._settings.unified_auth_state_ttl_seconds,
            http_timeout_seconds=self._settings.unified_auth_http_timeout_seconds,
            login_sync_hmac_secret=login_sync_secret,
            login_sync_signature_header=login_sync_header,
            glo_url=self._settings.unified_auth_glo_url,
            glo_entity_id=self._settings.unified_auth_glo_entity_id,
            glo_redirect_to_url=self._settings.unified_auth_glo_redirect_to_url,
            glo_redirect_to_login=self._settings.unified_auth_glo_redirect_to_login,
        )

    def _resolve_config(self) -> UnifiedAuthInternalConfig:
        runtime_config = self._read_runtime_config()
        if not runtime_config.enabled:
            raise UnifiedAuthUnavailable("disabled")

        provider = self._normalize_provider(runtime_config.provider)
        endpoints = self._resolve_endpoints(provider, runtime_config)
        token_param_style = (runtime_config.token_param_style or "query").strip().lower()
        if token_param_style not in {"query", "form"}:
            raise UnifiedAuthUnavailable("invalid_token_param_style")

        client_secret = self._secret_value(runtime_config.client_secret)
        state_secret = self._secret_value(runtime_config.state_secret)
        login_sync_hmac_secret = self._secret_value(runtime_config.login_sync_hmac_secret)
        glo_url = runtime_config.glo_url.strip() or self._default_glo_url(provider)
        required = {
            "client_id": runtime_config.client_id.strip(),
            "client_secret": client_secret,
            "redirect_uri": runtime_config.redirect_uri.strip(),
            "state_secret": state_secret,
            "login_sync_hmac_secret": login_sync_hmac_secret,
            "authorize_url": endpoints.authorize_url,
            "token_url": endpoints.token_url,
            "userinfo_url": endpoints.userinfo_url,
        }
        if any(not value for value in required.values()):
            raise UnifiedAuthUnavailable("missing_config")

        return UnifiedAuthInternalConfig(
            enabled=True,
            provider=provider,
            label=self._label_for_provider(provider),
            client_id=required["client_id"],
            client_secret=client_secret,
            redirect_uri=required["redirect_uri"],
            endpoints=endpoints,
            token_param_style=token_param_style,
            state_secret=state_secret,
            state_ttl_seconds=max(1, int(runtime_config.state_ttl_seconds)),
            http_timeout_seconds=max(1.0, float(runtime_config.http_timeout_seconds)),
            login_sync_hmac_secret=login_sync_hmac_secret,
            login_sync_signature_header=(runtime_config.login_sync_signature_header or "X-Signature").strip()
            or "X-Signature",
            glo_url=glo_url,
            glo_entity_id=runtime_config.glo_entity_id.strip(),
            glo_redirect_to_url=runtime_config.glo_redirect_to_url.strip(),
            glo_redirect_to_login=bool(runtime_config.glo_redirect_to_login),
        )

    def _resolve_endpoints(self, provider: str, runtime_config: UnifiedAuthRuntimeConfig) -> UnifiedAuthEndpoints:
        defaults = self._default_endpoints(provider)
        authorize_url = runtime_config.authorize_url.strip() or defaults.authorize_url
        token_url = runtime_config.token_url.strip() or defaults.token_url
        userinfo_url = runtime_config.userinfo_url.strip() or defaults.userinfo_url
        return UnifiedAuthEndpoints(
            authorize_url=authorize_url,
            token_url=token_url,
            userinfo_url=userinfo_url,
        )

    @staticmethod
    def _default_endpoints(provider: str) -> UnifiedAuthEndpoints:
        if provider == "group":
            base = GROUP_OAUTH_BASE_URL
        elif provider == "stock":
            base = STOCK_OAUTH_BASE_URL
        elif provider == "custom":
            base = ""
        else:
            raise UnifiedAuthUnavailable("invalid_provider")
        return UnifiedAuthEndpoints(
            authorize_url=f"{base}/authorize" if base else "",
            token_url=f"{base}/getToken" if base else "",
            userinfo_url=f"{base}/getUserInfo" if base else "",
        )

    @staticmethod
    def _default_glo_url(provider: str) -> str:
        if provider == "group":
            return GROUP_GLO_URL
        if provider == "stock":
            return STOCK_GLO_URL
        if provider == "custom":
            return ""
        raise UnifiedAuthUnavailable("invalid_provider")

    @staticmethod
    def _normalize_provider(provider: str | None) -> str:
        normalized = (provider or "group").strip().lower()
        return normalized if normalized in {"group", "stock", "custom"} else normalized

    @staticmethod
    def _label_for_provider(provider: str) -> str:
        if provider == "group":
            return "集团统一身份认证"
        if provider == "stock":
            return "股份统一身份认证"
        return "统一身份认证"

    @staticmethod
    def _secret_value(value: Any) -> str:
        if value is None:
            return ""
        if hasattr(value, "get_secret_value"):
            return str(value.get_secret_value()).strip()
        return str(value).strip()

    @staticmethod
    def _encode_state(payload: dict[str, Any], secret: str) -> str:
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        payload_b64 = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
        signature = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
        return f"{payload_b64}.{signature}"

    def _decode_state(self, state: str, secret: str) -> dict[str, Any]:
        try:
            payload_b64, signature = state.split(".", 1)
        except ValueError as err:
            raise UnifiedAuthFailure("invalid_state", "/") from err
        expected = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise UnifiedAuthFailure("invalid_state", "/")
        try:
            padding = "=" * (-len(payload_b64) % 4)
            payload = json.loads(base64.urlsafe_b64decode(f"{payload_b64}{padding}"))
        except (ValueError, json.JSONDecodeError) as err:
            raise UnifiedAuthFailure("invalid_state", "/") from err
        exp = float(payload.get("exp") or 0)
        if exp <= self._clock():
            raise UnifiedAuthFailure("invalid_state", "/")
        return payload

    async def _exchange_token(
        self,
        config: UnifiedAuthInternalConfig,
        code: str,
        redirect: str,
        trace_id: str,
    ) -> dict[str, Any]:
        params = {
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "code": code,
            "grant_type": "authorization_code",
        }
        log_unified_auth_trace(
            trace_id,
            "get_token",
            "request",
            {
                "url": config.endpoints.token_url,
                "token_param_style": config.token_param_style,
                "params": params,
            },
        )
        # 股份统一认证测试环境证书链未被本地 CA 信任；临时关闭 OAuth TLS 校验。
        client = self._make_http_client(config.http_timeout_seconds, verify_tls=False)
        try:
            if config.token_param_style == "form":
                response = await client.post(config.endpoints.token_url, data=params)
            else:
                response = await client.post(config.endpoints.token_url, params=params)
            response.raise_for_status()
            payload = response.json()
            log_unified_auth_trace(
                trace_id,
                "get_token",
                "response",
                {
                    "status_code": response.status_code,
                    "payload": payload,
                },
            )
        except httpx.HTTPError as err:
            logger.warning("统一认证 getToken HTTP 调用失败: %s", err)
            log_unified_auth_failure(
                trace_id,
                "oauth_unavailable",
                redirect,
                "get_token_http_error",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": config.endpoints.token_url,
                },
            )
            raise UnifiedAuthFailure("oauth_unavailable", redirect) from err
        except ValueError as err:
            log_unified_auth_failure(
                trace_id,
                "oauth_token_failed",
                redirect,
                "get_token_invalid_json",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": config.endpoints.token_url,
                },
            )
            raise UnifiedAuthFailure("oauth_token_failed", redirect) from err
        finally:
            await self._close_http_client(client)

        if not isinstance(payload, dict):
            log_unified_auth_failure(
                trace_id,
                "oauth_token_failed",
                redirect,
                "get_token_unexpected_payload",
                {"payload": payload},
            )
            raise UnifiedAuthFailure("oauth_token_failed", redirect)
        errcode = _first_str(payload, "errcode")
        if errcode:
            logger.warning("统一认证 getToken 返回错误 errcode=%s msg=%s", errcode, _first_str(payload, "msg"))
            log_unified_auth_failure(
                trace_id,
                "oauth_token_failed",
                redirect,
                "get_token_business_error",
                {
                    "errcode": errcode,
                    "msg": _first_str(payload, "msg"),
                    "payload": payload,
                },
            )
            raise UnifiedAuthFailure("oauth_token_failed", redirect)
        return payload

    async def _fetch_userinfo(
        self,
        config: UnifiedAuthInternalConfig,
        access_token: str,
        redirect: str,
        trace_id: str,
    ) -> dict[str, Any]:
        params = {
            "access_token": access_token,
            "client_id": config.client_id,
        }
        log_unified_auth_trace(
            trace_id,
            "get_userinfo",
            "request",
            {
                "url": config.endpoints.userinfo_url,
                "params": params,
            },
        )
        # 股份统一认证测试环境证书链未被本地 CA 信任；临时关闭 OAuth TLS 校验。
        client = self._make_http_client(config.http_timeout_seconds, verify_tls=False)
        try:
            response = await client.get(
                config.endpoints.userinfo_url,
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
            log_unified_auth_trace(
                trace_id,
                "get_userinfo",
                "response",
                {
                    "status_code": response.status_code,
                    "payload": payload,
                },
            )
        except httpx.HTTPError as err:
            logger.warning("统一认证 getUserInfo HTTP 调用失败: %s", err)
            log_unified_auth_failure(
                trace_id,
                "oauth_unavailable",
                redirect,
                "get_userinfo_http_error",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": config.endpoints.userinfo_url,
                },
            )
            raise UnifiedAuthFailure("oauth_unavailable", redirect) from err
        except ValueError as err:
            log_unified_auth_failure(
                trace_id,
                "oauth_userinfo_failed",
                redirect,
                "get_userinfo_invalid_json",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": config.endpoints.userinfo_url,
                },
            )
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect) from err
        finally:
            await self._close_http_client(client)

        if not isinstance(payload, dict):
            log_unified_auth_failure(
                trace_id,
                "oauth_userinfo_failed",
                redirect,
                "get_userinfo_unexpected_payload",
                {"payload": payload},
            )
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect)
        errcode = _first_str(payload, "errcode")
        if errcode:
            logger.warning("统一认证 getUserInfo 返回错误 errcode=%s msg=%s", errcode, _first_str(payload, "msg"))
            log_unified_auth_failure(
                trace_id,
                "oauth_userinfo_failed",
                redirect,
                "get_userinfo_business_error",
                {
                    "errcode": errcode,
                    "msg": _first_str(payload, "msg"),
                    "payload": payload,
                },
            )
            raise UnifiedAuthFailure("oauth_userinfo_failed", redirect)
        return payload

    async def _login_sync(
        self,
        config: UnifiedAuthInternalConfig,
        mapped_user: MappedUnifiedUser,
        redirect: str,
        trace_id: str,
    ) -> str:
        base_url, _ = self._runtime_service.get_connection_settings()
        url = f"{base_url.rstrip('/')}{LOGIN_SYNC_PATH}"
        request_payload: dict[str, Any] = {
            "source": "sso",
            "external_user_id": mapped_user.external_user_id,
            "user_attrs": mapped_user.user_attrs,
            "root_tenant_id": 1,
            "ts": int(self._clock()),
            "account_disabled": False,
        }
        if mapped_user.primary_dept_external_id:
            request_payload["primary_dept_external_id"] = mapped_user.primary_dept_external_id
        raw_body = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        signature = compute_login_sync_signature("POST", LOGIN_SYNC_PATH, raw_body, config.login_sync_hmac_secret)
        log_unified_auth_trace(
            trace_id,
            "login_sync",
            "request",
            {
                "url": url,
                "path": LOGIN_SYNC_PATH,
                "body": request_payload,
                "signature_header": config.login_sync_signature_header,
                "signature": signature,
            },
        )
        client = self._make_http_client(config.http_timeout_seconds)
        try:
            response = await client.post(
                url,
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    config.login_sync_signature_header: signature,
                },
            )
            response.raise_for_status()
            payload = response.json()
            log_unified_auth_trace(
                trace_id,
                "login_sync",
                "response",
                {
                    "status_code": response.status_code,
                    "payload": payload,
                },
            )
        except httpx.HTTPError as err:
            logger.warning("BiSheng login-sync 调用失败: %s", err)
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "login_sync_http_error",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": url,
                },
            )
            raise UnifiedAuthFailure("permission_denied", redirect) from err
        except ValueError as err:
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "login_sync_invalid_json",
                {
                    "error": str(err),
                    "error_type": type(err).__name__,
                    "url": url,
                },
            )
            raise UnifiedAuthFailure("permission_denied", redirect) from err
        finally:
            await self._close_http_client(client)

        if not isinstance(payload, dict):
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "login_sync_unexpected_payload",
                {"payload": payload},
            )
            raise UnifiedAuthFailure("permission_denied", redirect)
        status_code = payload.get("status_code")
        if status_code not in (None, 200):
            logger.warning("BiSheng login-sync 返回业务错误 status_code=%s", status_code)
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "login_sync_business_error",
                {
                    "status_code": status_code,
                    "payload": payload,
                },
            )
            raise UnifiedAuthFailure("permission_denied", redirect)
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        token = _first_str(data, "token", "access_token")
        if not token:
            log_unified_auth_failure(
                trace_id,
                "permission_denied",
                redirect,
                "login_sync_missing_token",
                {"payload": payload},
            )
            raise UnifiedAuthFailure("permission_denied", redirect)
        return token

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
