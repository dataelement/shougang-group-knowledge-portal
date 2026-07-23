import json
import logging
import secrets
import time
from dataclasses import dataclass
from inspect import isawaitable
from typing import Any, Callable, Protocol

import httpx
from fastapi import Request
from redis.exceptions import RedisError
from fastapi.responses import Response

from app.clients.bisheng import BishengClient
from app.schemas.auth import PortalUserView
from app.services.bisheng_runtime_service import (
    BishengRuntimeService,
    _decode_jwt_exp,
    _unwrap_bisheng_payload,
    encrypt_bisheng_password,
)
from app.services.error_messages import normalize_user_facing_message

logger = logging.getLogger(__name__)

_SESSION_KEY_PREFIX = "shougang_portal:session:v1"


class PortalAuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class PortalMultiLoginConflictError(PortalAuthError):
    code = 10612

    def __init__(self):
        super().__init__("该用户已在其它设备登录，是否继续登录？", status_code=409)


@dataclass
class PortalSession:
    session_id: str
    access_token: str
    user: PortalUserView
    base_url: str
    timeout_seconds: float
    expires_at: float
    auth_source: str = ""
    auth_trace_id: str = ""


class PortalSessionStoreError(RuntimeError):
    """Raised when the shared portal session store cannot be used."""


class PortalSessionStore(Protocol):
    async def get(self, session_id: str) -> PortalSession | None: ...

    async def save(self, session: PortalSession, *, replace_existing: bool) -> None: ...

    async def delete(self, session_id: str) -> None: ...


class InMemoryPortalSessionStore:
    """Development-only session store used when Redis is not configured."""

    def __init__(self):
        self._sessions: dict[str, PortalSession] = {}
        self._session_by_account: dict[str, str] = {}

    async def get(self, session_id: str) -> PortalSession | None:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if session.expires_at > time.time():
            return session
        await self.delete(session_id)
        return None

    async def save(self, session: PortalSession, *, replace_existing: bool) -> None:
        account_key = _session_account_key(session.user.account)
        if replace_existing and account_key:
            previous_session_id = self._session_by_account.get(account_key)
            if previous_session_id and previous_session_id != session.session_id:
                self._sessions.pop(previous_session_id, None)
        self._sessions[session.session_id] = session
        if account_key:
            self._session_by_account[account_key] = session.session_id

    async def delete(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        account_key = _session_account_key(session.user.account)
        if self._session_by_account.get(account_key) == session_id:
            self._session_by_account.pop(account_key, None)


class RedisPortalSessionStore:
    """Redis-backed session store shared by all portal workers."""

    def __init__(self, redis_client: Any):
        self._redis = redis_client

    async def get(self, session_id: str) -> PortalSession | None:
        try:
            raw = await self._redis.get(self._session_key(session_id))
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalSessionStoreError("Redis 会话读取失败") from err
        if raw is None:
            return None
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            session = self._deserialize_session(json.loads(raw))
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError):
            logger.warning("门户 Redis 会话数据无效，已忽略")
            return None
        if session.expires_at > time.time():
            return session
        try:
            await self._redis.delete(self._session_key(session_id))
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalSessionStoreError("Redis 过期会话清理失败") from err
        return None

    async def save(self, session: PortalSession, *, replace_existing: bool) -> None:
        ttl_seconds = max(1, int(session.expires_at - time.time()))
        account_key = _session_account_key(session.user.account)
        try:
            if replace_existing and account_key:
                previous_session_id = await self._redis.get(self._account_key(account_key))
                if isinstance(previous_session_id, bytes):
                    previous_session_id = previous_session_id.decode("utf-8")
                if previous_session_id and previous_session_id != session.session_id:
                    await self._redis.delete(self._session_key(str(previous_session_id)))
            payload = json.dumps(self._serialize_session(session), ensure_ascii=False, separators=(",", ":"))
            await self._redis.set(self._session_key(session.session_id), payload, ex=ttl_seconds)
            if account_key:
                await self._redis.set(self._account_key(account_key), session.session_id, ex=ttl_seconds)
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalSessionStoreError("Redis 会话写入失败") from err

    async def delete(self, session_id: str) -> None:
        try:
            session = await self.get(session_id)
            await self._redis.delete(self._session_key(session_id))
            if session is None:
                return
            account_key = _session_account_key(session.user.account)
            if not account_key:
                return
            mapped_session_id = await self._redis.get(self._account_key(account_key))
            if isinstance(mapped_session_id, bytes):
                mapped_session_id = mapped_session_id.decode("utf-8")
            if mapped_session_id == session_id:
                await self._redis.delete(self._account_key(account_key))
        except PortalSessionStoreError:
            raise
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalSessionStoreError("Redis 会话删除失败") from err

    @staticmethod
    def _session_key(session_id: str) -> str:
        return f"{_SESSION_KEY_PREFIX}:id:{session_id}"

    @staticmethod
    def _account_key(account: str) -> str:
        return f"{_SESSION_KEY_PREFIX}:account:{account}"

    @staticmethod
    def _serialize_session(session: PortalSession) -> dict[str, Any]:
        return {
            "session_id": session.session_id,
            "access_token": session.access_token,
            "user": session.user.model_dump(mode="json"),
            "base_url": session.base_url,
            "timeout_seconds": session.timeout_seconds,
            "expires_at": session.expires_at,
            "auth_source": session.auth_source,
            "auth_trace_id": session.auth_trace_id,
        }

    @staticmethod
    def _deserialize_session(payload: dict[str, Any]) -> PortalSession:
        return PortalSession(
            session_id=str(payload["session_id"]),
            access_token=str(payload["access_token"]),
            user=PortalUserView.model_validate(payload["user"]),
            base_url=str(payload["base_url"]),
            timeout_seconds=float(payload["timeout_seconds"]),
            expires_at=float(payload["expires_at"]),
            auth_source=str(payload.get("auth_source") or ""),
            auth_trace_id=str(payload.get("auth_trace_id") or ""),
        )


def _session_account_key(account: str | None) -> str:
    return (account or "").strip().lower()


class PortalAuthService:
    _bisheng_cookie_name = "access_token_cookie"
    _auth_source_cookie_name = "sg_portal_auth_source"

    def __init__(
        self,
        runtime_service: BishengRuntimeService,
        *,
        cookie_name: str,
        ttl_seconds: int,
        cookie_secure: bool,
        client_factory: Callable[[str, float, str | None], BishengClient] = BishengClient,
        password_encryptor: Callable[[str, str], str] = encrypt_bisheng_password,
        session_store: PortalSessionStore | None = None,
    ):
        self._runtime_service = runtime_service
        self._cookie_name = cookie_name
        self._ttl_seconds = ttl_seconds
        self._cookie_secure = cookie_secure
        self._client_factory = client_factory
        self._password_encryptor = password_encryptor
        self._session_store = session_store or InMemoryPortalSessionStore()

    @property
    def cookie_name(self) -> str:
        return self._cookie_name

    async def login(
        self,
        *,
        account: str,
        password: str,
        remember: bool,
        captcha_key: str = "",
        captcha: str = "",
        force_login: bool = False,
        auth_source: str = "",
    ) -> PortalSession:
        base_url, timeout_seconds = self._runtime_service.get_connection_settings()
        access_token = await self._login_to_bisheng(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            account=account,
            password=password,
            captcha_key=captcha_key,
            captcha=captcha,
            force_login=force_login,
        )
        user = await self._fetch_user(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            access_token=access_token,
            fallback_account=account,
        )
        expires_at = self._resolve_expiry(access_token)
        session = PortalSession(
            session_id=secrets.token_urlsafe(32),
            access_token=access_token,
            user=user,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            expires_at=expires_at,
            auth_source=auth_source.strip(),
        )
        if not remember:
            session.expires_at = min(session.expires_at, time.time() + self._ttl_seconds)
        await self._store_session(session, replace_existing=force_login)
        return session

    async def create_session_from_access_token(
        self,
        *,
        access_token: str,
        remember: bool,
        fallback_account: str = "",
        auth_source: str = "",
        auth_trace_id: str = "",
        replace_existing: bool = False,
    ) -> PortalSession:
        base_url, timeout_seconds = self._runtime_service.get_connection_settings()
        user = await self._fetch_user(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            access_token=access_token,
            fallback_account=fallback_account,
            strict=True,
        )
        expires_at = self._resolve_expiry(access_token)
        if expires_at <= time.time():
            raise PortalAuthError("登录态已失效，请重新登录", status_code=401)
        session = PortalSession(
            session_id=secrets.token_urlsafe(32),
            access_token=access_token,
            user=user,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            expires_at=expires_at,
            auth_source=auth_source,
            auth_trace_id=auth_trace_id,
        )
        if not remember:
            session.expires_at = min(session.expires_at, time.time() + self._ttl_seconds)
        await self._store_session(session, replace_existing=replace_existing)
        return session

    def attach_session_cookie(self, response: Response, session: PortalSession, remember: bool) -> None:
        max_age = max(0, int(session.expires_at - time.time())) if remember else None
        response.set_cookie(
            key=self._cookie_name,
            value=session.session_id,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            max_age=max_age,
            path="/",
        )
        response.set_cookie(
            key=self._bisheng_cookie_name,
            value=session.access_token,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            max_age=max_age,
            path="/",
        )
        if session.auth_source:
            response.set_cookie(
                key=self._auth_source_cookie_name,
                value=session.auth_source,
                httponly=True,
                secure=self._cookie_secure,
                samesite="lax",
                max_age=max_age,
                path="/",
            )
        else:
            response.delete_cookie(
                key=self._auth_source_cookie_name,
                httponly=True,
                secure=self._cookie_secure,
                samesite="lax",
                path="/",
            )

    def clear_session_cookie(self, response: Response) -> None:
        for key in (
            self._cookie_name,
            self._bisheng_cookie_name,
            self._auth_source_cookie_name,
        ):
            self._expire_cookie(response, key)

    def _expire_cookie(self, response: Response, key: str) -> None:
        response.set_cookie(
            key=key,
            value="",
            max_age=0,
            httponly=True,
            secure=self._cookie_secure,
            samesite="lax",
            path="/",
        )

    async def get_session(self, request: Request) -> PortalSession | None:
        session_id = request.cookies.get(self._cookie_name, "")
        if not session_id:
            return None
        try:
            return await self._session_store.get(session_id)
        except PortalSessionStoreError:
            logger.exception("门户会话读取失败")
            return None

    async def require_session(self, request: Request) -> PortalSession:
        session = await self.get_session(request)
        if session is None:
            raise PortalAuthError("请先登录", status_code=401)
        return session

    async def require_session_or_bisheng_cookie(self, request: Request) -> tuple[PortalSession, bool]:
        session = await self.get_session(request)
        if session is not None:
            return session, False

        access_token = request.cookies.get(self._bisheng_cookie_name, "").strip()
        if not access_token:
            raise PortalAuthError("请先登录", status_code=401)

        base_url, timeout_seconds = self._runtime_service.get_connection_settings()
        user = await self._fetch_user(
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            access_token=access_token,
            fallback_account="",
            strict=True,
        )
        expires_at = self._resolve_expiry(access_token)
        if expires_at <= time.time():
            raise PortalAuthError("登录态已失效，请重新登录", status_code=401)

        session = PortalSession(
            session_id=secrets.token_urlsafe(32),
            access_token=access_token,
            user=user,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            expires_at=expires_at,
            auth_source=request.cookies.get(self._auth_source_cookie_name, "").strip(),
        )
        await self._store_session(session, replace_existing=False)
        return session, True

    async def logout(self, request: Request) -> None:
        session_id = request.cookies.get(self._cookie_name, "")
        if session_id:
            try:
                await self._session_store.delete(session_id)
            except PortalSessionStoreError:
                logger.exception("门户会话删除失败")

    def get_auth_source(self, request: Request) -> str:
        return request.cookies.get(self._auth_source_cookie_name, "").strip()

    def is_unified_auth_request(self, request: Request) -> bool:
        return self.get_auth_source(request) == "unified_auth"

    def create_bisheng_client(self, session: PortalSession) -> BishengClient:
        return self._client_factory(session.base_url, session.timeout_seconds, session.access_token)

    async def _login_to_bisheng(
        self,
        *,
        base_url: str,
        timeout_seconds: float,
        account: str,
        password: str,
        captcha_key: str,
        captcha: str,
        force_login: bool,
    ) -> str:
        client = self._client_factory(base_url, timeout_seconds, None)
        try:
            captcha_response = await client.get_json("/api/v1/user/get_captcha")
            captcha_data = _unwrap_bisheng_payload(captcha_response)
            requires_captcha = bool(captcha_data.get("user_capthca") or captcha_data.get("user_captcha"))
            if requires_captcha and not captcha:
                raise PortalAuthError("当前 BiSheng 登录需要验证码，请补充验证码后重试", status_code=400)

            public_key_response = await client.get_json("/api/v1/user/public_key")
            public_key = str(_unwrap_bisheng_payload(public_key_response).get("public_key") or "").strip()
            if not public_key:
                raise PortalAuthError("未获取到 BiSheng 登录公钥", status_code=502)

            encrypted_password = self._password_encryptor(public_key, password)
            login_response = await client.post_json(
                "/api/v1/user/login",
                json={
                    "user_name": account,
                    "password": encrypted_password,
                    "captcha_key": captcha_key or str(captcha_data.get("captcha_key") or ""),
                    "captcha": captcha or "",
                    "force_login": force_login,
                },
            )
            if login_response.get("status_code") == PortalMultiLoginConflictError.code:
                raise PortalMultiLoginConflictError()
            if login_response.get("status_code") not in (None, 200):
                logger.warning(
                    "BiSheng login rejected: account=%s base_url=%s status_code=%s status_message=%s",
                    account,
                    base_url,
                    login_response.get("status_code"),
                    login_response.get("status_message"),
                )
            login_data = _unwrap_bisheng_payload(login_response)
            access_token = str(login_data.get("access_token") or "").strip()
            if not access_token:
                raise PortalAuthError("BiSheng 登录成功，但未返回 access_token", status_code=502)
            return access_token
        except PortalAuthError:
            raise
        except ValueError as err:
            logger.warning(
                "BiSheng login business error: account=%s base_url=%s error=%s",
                account,
                base_url,
                err,
            )
            raise PortalAuthError(
                normalize_user_facing_message(err, fallback="登录失败，请重试"),
                status_code=401,
            ) from err
        except httpx.HTTPStatusError as err:
            logger.warning(
                "BiSheng login HTTP error: account=%s base_url=%s status_code=%s error=%s",
                account,
                base_url,
                err.response.status_code,
                err,
            )
            raise PortalAuthError(
                normalize_user_facing_message(
                    "",
                    fallback="BiSheng 登录失败，请稍后重试",
                    status_code=err.response.status_code,
                ),
                status_code=502,
            ) from err
        except httpx.HTTPError as err:
            logger.warning(
                "BiSheng login transport error: account=%s base_url=%s error_type=%s error=%s",
                account,
                base_url,
                type(err).__name__,
                err,
            )
            raise PortalAuthError(
                normalize_user_facing_message(err, fallback="连接 BiSheng 失败，请稍后重试", status_code=502),
                status_code=502,
            ) from err
        finally:
            await client.aclose()

    async def _fetch_user(
        self,
        *,
        base_url: str,
        timeout_seconds: float,
        access_token: str,
        fallback_account: str,
        strict: bool = False,
    ) -> PortalUserView:
        client = self._client_factory(base_url, timeout_seconds, access_token)
        try:
            response = await client.get_json("/api/v1/user/info")
            data = _unwrap_bisheng_payload(response)
        except Exception:
            if strict:
                raise PortalAuthError("BiSheng 登录态校验失败，请重新登录", status_code=401)
            data = {}
        finally:
            await client.aclose()

        account = self._first_str(data, "user_name", "username", "account", "email") or fallback_account
        if strict and not account:
            raise PortalAuthError("BiSheng 登录态缺少用户信息，请重新登录", status_code=401)
        name = self._first_str(data, "nick_name", "nickname", "name", "real_name", "user_name") or account
        role = self._first_str(data, "role_name", "role", "position", "department_name", "department")
        department_name = self._first_str(data, "department_name", "department")
        external_id = self._first_str(data, "external_id", "employee_id", "staff_id")
        return PortalUserView(
            account=account,
            name=name,
            initial=name[:1].upper(),
            role=role or "内部员工",
            department_name=department_name,
            external_id=external_id,
            user_id=self._first_positive_int(data, "user_id", "id"),
            # BiSheng's current /user/info contract exposes the effective tenant
            # as ``leaf_tenant_id``.  Keep the historical aliases for mixed-version
            # deployments, but prefer the runtime field used by the real response.
            tenant_id=self._first_positive_int(
                data,
                "leaf_tenant_id",
                "tenant_id",
                "tenantId",
            ),
            login_at=int(time.time() * 1000),
        )

    def _resolve_expiry(self, access_token: str) -> float:
        now = time.time()
        default_expires_at = now + self._ttl_seconds
        token_exp = _decode_jwt_exp(access_token)
        if token_exp is None:
            return default_expires_at
        return min(default_expires_at, token_exp.timestamp())

    async def _store_session(self, session: PortalSession, *, replace_existing: bool) -> None:
        try:
            await self._session_store.save(session, replace_existing=replace_existing)
        except PortalSessionStoreError as err:
            logger.exception("门户会话写入失败")
            raise PortalAuthError("登录服务暂不可用，请稍后重试", status_code=503) from err

    @staticmethod
    def _first_str(data: dict, *keys: str) -> str:
        for key in keys:
            value = data.get(key)
            if value not in (None, ""):
                return str(value)
        return ""

    @staticmethod
    def _first_positive_int(data: dict, *keys: str) -> int | None:
        for key in keys:
            value = data.get(key)
            if value in (None, "") or isinstance(value, bool):
                continue
            try:
                normalized = int(value)
            except (TypeError, ValueError):
                continue
            if normalized > 0:
                return normalized
        return None


async def get_portal_session(auth_service: Any, request: Request) -> PortalSession | None:
    """Read a session while retaining compatibility with synchronous test doubles."""
    result = auth_service.get_session(request)
    return await result if isawaitable(result) else result


async def require_portal_session(auth_service: Any, request: Request) -> PortalSession:
    """Require a session while retaining compatibility with synchronous test doubles."""
    result = auth_service.require_session(request)
    return await result if isawaitable(result) else result
