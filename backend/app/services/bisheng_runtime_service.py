import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import time
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from app.clients.bisheng import BishengClient
from app.schemas.bisheng_runtime import (
    BishengRuntimeAuthUser,
    BishengRuntimeConfig,
    BishengRuntimeConfigUpdate,
    BishengRuntimeConfigView,
)
from app.schemas.portal_admin_config import PortalBishengPersistentConfig
from app.services.bisheng_auth_state_store import (
    BishengAuthStateStore,
    BishengAuthStateStoreError,
    BishengSharedAuthState,
)
from app.services.config_store import InMemoryConfigStore
from app.services.error_messages import normalize_user_facing_message

ClientFactory = Callable[..., BishengClient]

logger = logging.getLogger(__name__)


DEFAULT_REFRESH_INTERVAL_SECONDS = 30 * 60
DEFAULT_REFRESH_THRESHOLD_SECONDS = 60 * 60
DEFAULT_SHARED_REFRESH_WAIT_SECONDS = 10.0
DEFAULT_SHARED_REFRESH_POLL_SECONDS = 0.05
DEFAULT_DISCONNECTED_STATE_TTL_SECONDS = 5 * 60
DEFAULT_OPAQUE_TOKEN_TTL_SECONDS = 60 * 60
DEFAULT_CLIENT_RETIRE_GRACE_SECONDS = 1.0
PORTAL_RUNTIME_TOKEN_PURPOSE = "portal_runtime"


def encrypt_bisheng_password(public_key_pem: str, password: str) -> str:
    modulus, exponent = _parse_rsa_public_key(public_key_pem)
    return _encrypt_pkcs1_v1_5(modulus, exponent, password.encode("utf-8"))


class BishengRuntimeService:
    _TABLE_NAME = "bisheng_runtime_config"
    _LEGACY_CONFIG_KEY = "bisheng_runtime"

    def __init__(
        self,
        config_path: Path,
        default_base_url: str,
        default_timeout_seconds: float,
        default_api_token: str | None = None,
        default_username: str | None = None,
        default_password: str | None = None,
        default_asset_base_url: str | None = None,
        client_factory: ClientFactory = BishengClient,
        password_encryptor: Callable[[str, str], str] = encrypt_bisheng_password,
        refresh_interval_seconds: float = DEFAULT_REFRESH_INTERVAL_SECONDS,
        refresh_threshold_seconds: float = DEFAULT_REFRESH_THRESHOLD_SECONDS,
        sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
        store: Any | None = None,
        auth_state_store: BishengAuthStateStore | None = None,
        shared_refresh_wait_seconds: float = DEFAULT_SHARED_REFRESH_WAIT_SECONDS,
        shared_refresh_poll_seconds: float = DEFAULT_SHARED_REFRESH_POLL_SECONDS,
        client_retire_grace_seconds: float = DEFAULT_CLIENT_RETIRE_GRACE_SECONDS,
        client_retire_sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._config_path = config_path
        self._store = store or InMemoryConfigStore()
        self._default_base_url = default_base_url
        self._default_timeout_seconds = default_timeout_seconds
        self._default_api_token = default_api_token or ""
        self._default_username = (default_username or "").strip()
        self._default_password = default_password or ""
        self._default_asset_base_url = (default_asset_base_url or "").strip().rstrip("/")
        self._client_factory = client_factory
        self._password_encryptor = password_encryptor
        self._refresh_interval_seconds = refresh_interval_seconds
        self._refresh_threshold_seconds = refresh_threshold_seconds
        self._sleeper = sleeper
        self._auth_state_store = auth_state_store
        self._shared_refresh_wait_seconds = shared_refresh_wait_seconds
        self._shared_refresh_poll_seconds = shared_refresh_poll_seconds
        self._client_retire_grace_seconds = max(
            float(client_retire_grace_seconds),
            0.0,
        )
        self._client_retire_sleeper = client_retire_sleeper
        self._lock = asyncio.Lock()
        self._client: BishengClient | None = None
        self._refresh_task: asyncio.Task | None = None
        self._retired_client_tasks: set[asyncio.Task] = set()
        self._connected = False
        self._auth_message = "未验证"
        self._auth_user: BishengRuntimeAuthUser | None = None
        self._ensure_seeded()

    async def initialize(self) -> None:
        await self.sync_shared_auth_state()
        async with self._lock:
            await self._replace_client(self._read_config())
        if self._can_auto_refresh():
            await self._refresh_token_if_due()
            self._ensure_refresh_task()
        await self._refresh_runtime_account_info()

    async def aclose(self) -> None:
        task = self._refresh_task
        self._refresh_task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        retired_tasks = list(self._retired_client_tasks)
        self._retired_client_tasks.clear()
        for retired_task in retired_tasks:
            retired_task.cancel()
        if retired_tasks:
            await asyncio.gather(*retired_tasks, return_exceptions=True)
        client = self._client
        self._client = None
        if client is not None:
            await client.aclose()

    def get_client(self) -> BishengClient:
        if self._client is None:
            raise RuntimeError("BiSheng client is not initialized")
        return self._client

    def get_public_config(self) -> BishengRuntimeConfigView:
        return self._to_public_view(self._read_config())

    async def get_shared_public_config(self) -> BishengRuntimeConfigView:
        await self.sync_shared_auth_state()
        return self.get_public_config()

    async def sync_shared_auth_state(self) -> BishengSharedAuthState | None:
        if self._auth_state_store is None:
            return None
        current = self._read_config()
        shared = await self._auth_state_store.get(self._config_fingerprint(current))
        if shared is None:
            return None
        await self._apply_shared_state(shared)
        return shared

    async def apply_persistent_config(
        self,
        config: PortalBishengPersistentConfig,
    ) -> BishengRuntimeConfigView:
        async with self._lock:
            current = self._read_config()
            username = config.username.strip()
            endpoint_changed = (
                str(config.base_url) != str(current.base_url)
                or username != current.username
            )
            next_token = "" if endpoint_changed else current.api_token
            last_auth_at = config.last_auth_at if not endpoint_changed else ""
            should_login = (
                self._auth_state_store is None
                and bool(username and config.saved_password)
                and (not next_token or self._is_token_due_for_refresh(next_token))
            )
            if should_login:
                try:
                    next_token = await self._login_and_get_token(
                        base_url=str(config.base_url),
                        username=username,
                        password=config.saved_password,
                        timeout_seconds=config.timeout_seconds,
                    )
                    last_auth_at = _utc_now()
                except ValueError as err:
                    logger.warning("BiSheng 远程配置服务账号登录失败：%s", err)

            updated = BishengRuntimeConfig(
                base_url=config.base_url,
                asset_base_url=config.asset_base_url,
                username=username,
                timeout_seconds=config.timeout_seconds,
                api_token=next_token,
                saved_password=config.saved_password,
                last_auth_at=last_auth_at,
            )
            self._write_config(updated)
            await self._replace_client(updated)
            if self._can_auto_refresh():
                self._ensure_refresh_task()
        if self._auth_state_store is not None:
            await self.sync_shared_auth_state()
            if self._is_token_due_for_refresh(self._read_config().api_token):
                await self._refresh_token_if_due()
        await self._refresh_runtime_account_info()
        return self.get_public_config()

    def is_bootstrap_required(self) -> bool:
        return not self._connected

    async def refresh_connection_status(self) -> BishengRuntimeConfigView:
        await self.sync_shared_auth_state()
        async with self._lock:
            if self._client is None:
                await self._replace_client(self._read_config())
        await self._refresh_runtime_account_info()
        return self.get_public_config()

    def get_connection_settings(self) -> tuple[str, float]:
        config = self._read_config()
        return str(config.base_url), config.timeout_seconds

    def get_runtime_config_snapshot(self) -> BishengRuntimeConfig:
        return self._read_config()

    def get_persistent_config(self) -> PortalBishengPersistentConfig:
        config = self._read_config()
        return PortalBishengPersistentConfig(
            base_url=config.base_url,
            asset_base_url=config.asset_base_url,
            username=config.username,
            timeout_seconds=config.timeout_seconds,
            saved_password=config.saved_password,
            last_auth_at=config.last_auth_at,
        )

    async def update_config(self, payload: BishengRuntimeConfigUpdate) -> BishengRuntimeConfigView:
        await self.sync_shared_auth_state()
        async with self._lock:
            current = self._read_config()
            password = payload.password.get_secret_value().strip() if payload.password else ""
            next_base_url = str(payload.base_url)
            next_asset_base_url = payload.asset_base_url
            next_username = payload.username.strip()
            next_timeout = float(payload.timeout_seconds)

            requires_reauth = (
                bool(password)
                or next_base_url != str(current.base_url)
                or next_username != current.username
                or not current.api_token
            )

            next_token = current.api_token
            last_auth_at = current.last_auth_at
            next_saved_password = current.saved_password
            if requires_reauth:
                if not next_username:
                    raise ValueError("请输入 BiSheng 登录账号")
                if not password:
                    raise ValueError("修改地址或账号时，必须重新输入密码以换取共享令牌")
                next_token = await self._login_and_get_token(
                    base_url=next_base_url,
                    username=next_username,
                    password=password,
                    timeout_seconds=next_timeout,
                )
                next_saved_password = password
                last_auth_at = _utc_now()

            updated = BishengRuntimeConfig(
                base_url=payload.base_url,
                asset_base_url=next_asset_base_url,
                username=next_username,
                timeout_seconds=next_timeout,
                api_token=next_token,
                saved_password=next_saved_password,
                last_auth_at=last_auth_at,
            )
            self._write_config(updated)
            await self._replace_client(updated)
        await self._refresh_runtime_account_info()
        return self.get_public_config()

    async def _refresh_loop(self) -> None:
        while True:
            try:
                await self._sleeper(self._refresh_interval_seconds)
            except asyncio.CancelledError:
                raise
            try:
                await self._refresh_token_if_due()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("BiSheng token 自动刷新循环异常，将在下次轮询重试")

    async def _refresh_token_if_due(self) -> None:
        if self._auth_state_store is not None:
            await self.sync_shared_auth_state()
            current = self._read_config()
            if not self._is_token_due_for_refresh(current.api_token):
                return
            try:
                await self._refresh_shared_token(current.api_token)
            except ValueError as err:
                logger.warning("BiSheng token 自动续期失败：%s", err)
                return
            await self._refresh_runtime_account_info()
            return

        refreshed = False
        async with self._lock:
            current = self._read_config()
            if not self._is_token_due_for_refresh(current.api_token):
                return
            username = current.username.strip() or self._default_username
            password = self._runtime_password(current)
            if not username or not password:
                logger.warning(
                    "BiSheng token 即将过期但未配置可用的服务账号或密码，无法自动续期"
                )
                return
            try:
                next_token = await self._login_and_get_token(
                    base_url=str(current.base_url),
                    username=username,
                    password=password,
                    timeout_seconds=current.timeout_seconds,
                )
            except ValueError as err:
                logger.warning("BiSheng token 自动续期失败：%s", err)
                return

            updated = BishengRuntimeConfig(
                base_url=current.base_url,
                asset_base_url=current.asset_base_url,
                username=username,
                timeout_seconds=current.timeout_seconds,
                api_token=next_token,
                saved_password=current.saved_password,
                last_auth_at=_utc_now(),
            )
            self._write_config(updated)
            self._set_current_client_token(next_token)
            logger.info("BiSheng token 已自动续期")
            refreshed = True
        if refreshed:
            await self._refresh_runtime_account_info()

    def _is_token_due_for_refresh(self, token: str) -> bool:
        if not token:
            return True
        exp = _decode_jwt_exp(token)
        if exp is None:
            return True
        remaining = (exp - datetime.now(UTC)).total_seconds()
        return remaining <= self._refresh_threshold_seconds

    def _can_auto_refresh(self) -> bool:
        current = self._read_config()
        return bool(self._default_password or current.saved_password)

    def _ensure_refresh_task(self) -> None:
        if self._refresh_task is None or self._refresh_task.done():
            self._refresh_task = asyncio.create_task(self._refresh_loop())

    async def refresh_token_after_auth_failure(self, failed_token: str = "") -> str:
        if self._auth_state_store is not None:
            return await self._refresh_shared_token(failed_token)

        async with self._lock:
            current = self._read_config()
            if failed_token and current.api_token and current.api_token != failed_token:
                self._set_current_client_token(current.api_token)
                return current.api_token

            username = current.username.strip() or self._default_username
            password = self._runtime_password(current)
            if not username or not password:
                raise ValueError("BiSheng 数据源登录态失效，且未配置可用的服务账号密码")

            next_token = await self._login_and_get_token(
                base_url=str(current.base_url),
                username=username,
                password=password,
                timeout_seconds=current.timeout_seconds,
            )
            updated = BishengRuntimeConfig(
                base_url=current.base_url,
                asset_base_url=current.asset_base_url,
                username=username,
                timeout_seconds=current.timeout_seconds,
                api_token=next_token,
                saved_password=current.saved_password,
                last_auth_at=_utc_now(),
            )
            self._write_config(updated)
            self._set_current_client_token(next_token)
            logger.info("BiSheng token 已在认证失败后自动重登")
            return next_token

    async def _refresh_shared_token(self, failed_token: str) -> str:
        if self._auth_state_store is None:
            raise RuntimeError("BiSheng shared auth state store is not configured")
        current = self._read_config()
        fingerprint = self._config_fingerprint(current)
        shared = await self._auth_state_store.get(fingerprint)
        if shared and shared.access_token and shared.access_token != failed_token:
            await self._apply_shared_state(shared)
            return shared.access_token

        owner = secrets.token_urlsafe(24)
        lock_ttl_seconds = max(60, int(current.timeout_seconds * 3))
        acquired = await self._auth_state_store.acquire_refresh_lock(
            fingerprint,
            owner,
            ttl_seconds=lock_ttl_seconds,
        )
        if not acquired:
            return await self._wait_for_shared_refresh(
                fingerprint,
                failed_token=failed_token,
                previous_version=shared.version if shared else "",
            )

        try:
            latest = await self._auth_state_store.get(fingerprint)
            if latest and latest.access_token and latest.access_token != failed_token:
                await self._apply_shared_state(latest)
                return latest.access_token

            username = current.username.strip() or self._default_username
            password = self._runtime_password(current)
            if not username or not password:
                await self._save_disconnected_shared_state(
                    current,
                    "BiSheng 数据源自动重登失败，请检查服务账号配置",
                )
                raise ValueError("BiSheng 数据源自动重登失败，请检查服务账号配置")

            try:
                next_token = await self._login_and_get_token(
                    base_url=str(current.base_url),
                    username=username,
                    password=password,
                    timeout_seconds=current.timeout_seconds,
                )
            except Exception as err:
                logger.warning("BiSheng 数据源共享登录态刷新失败：%s", err.__class__.__name__)
                await self._save_disconnected_shared_state(
                    current,
                    "BiSheng 数据源自动重登失败，请检查服务账号配置",
                )
                raise ValueError("BiSheng 数据源自动重登失败，请检查服务账号配置") from err

            last_auth_at = _utc_now()
            next_state = BishengSharedAuthState(
                access_token=next_token,
                connected=True,
                auth_message="已连接",
                auth_user=latest.auth_user if latest else self._auth_user,
                last_auth_at=last_auth_at,
                expires_at=self._shared_token_expires_at(next_token),
                version=secrets.token_urlsafe(16),
            )
            await self._auth_state_store.save(fingerprint, next_state)
            await self._apply_shared_state(next_state)
            logger.info("BiSheng token 已在认证失败后完成跨 Worker 自动重登")
            return next_token
        finally:
            try:
                await self._auth_state_store.release_refresh_lock(fingerprint, owner)
            except BishengAuthStateStoreError:
                # 锁带有租期；释放失败不回滚已经成功写入的共享登录态。
                logger.warning("BiSheng 共享登录刷新锁释放失败，将等待租期自动清理")

    async def _wait_for_shared_refresh(
        self,
        fingerprint: str,
        *,
        failed_token: str,
        previous_version: str,
    ) -> str:
        if self._auth_state_store is None:
            raise RuntimeError("BiSheng shared auth state store is not configured")
        deadline = time.monotonic() + self._shared_refresh_wait_seconds
        while time.monotonic() < deadline:
            await asyncio.sleep(self._shared_refresh_poll_seconds)
            shared = await self._auth_state_store.get(fingerprint)
            if shared is None:
                continue
            if shared.access_token and shared.access_token != failed_token:
                await self._apply_shared_state(shared)
                return shared.access_token
            if not shared.access_token and shared.version != previous_version:
                await self._apply_shared_state(shared)
                raise ValueError("BiSheng 数据源自动重登失败，请检查服务账号配置")
        raise ValueError("BiSheng 数据源自动重登超时，请稍后重试")

    async def _save_disconnected_shared_state(
        self,
        config: BishengRuntimeConfig,
        message: str,
    ) -> None:
        if self._auth_state_store is None:
            return
        state = BishengSharedAuthState(
            access_token="",
            connected=False,
            auth_message=message,
            auth_user=None,
            last_auth_at=config.last_auth_at,
            expires_at=time.time() + DEFAULT_DISCONNECTED_STATE_TTL_SECONDS,
            version=secrets.token_urlsafe(16),
        )
        await self._auth_state_store.save(self._config_fingerprint(config), state)
        await self._apply_shared_state(state)

    async def _login_and_get_token(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        timeout_seconds: float,
    ) -> str:
        client = self._client_factory(base_url, timeout_seconds, None)
        try:
            captcha_response = await client.get_json("/api/v1/user/get_captcha")
            captcha_data = _unwrap_bisheng_payload(captcha_response)
            if captcha_data.get("user_capthca"):
                raise ValueError("当前 BiSheng 环境启用了验证码，门户后台暂不支持自动登录")

            public_key_response = await client.get_json("/api/v1/user/public_key")
            public_key = str(_unwrap_bisheng_payload(public_key_response).get("public_key") or "").strip()
            if not public_key:
                raise ValueError("未获取到 BiSheng 登录公钥")

            encrypted_password = self._password_encryptor(public_key, password)
            login_response = await client.post_json(
                "/api/v1/user/login",
                json={
                    "user_name": username,
                    "password": encrypted_password,
                    "captcha_key": str(captcha_data.get("captcha_key") or ""),
                    "captcha": "",
                    "token_purpose": PORTAL_RUNTIME_TOKEN_PURPOSE,
                },
            )
            login_data = _unwrap_bisheng_payload(login_response)
            access_token = str(login_data.get("access_token") or "").strip()
            if not access_token:
                raise ValueError("BiSheng 登录成功，但未返回 access_token")
            return access_token
        except httpx.HTTPStatusError as err:
            raise ValueError(
                normalize_user_facing_message(
                    f"BiSheng 登录失败：HTTP {err.response.status_code}",
                    fallback="BiSheng 登录失败，请稍后重试",
                    status_code=err.response.status_code,
                )
            ) from err
        except httpx.HTTPError as err:
            raise ValueError(
                normalize_user_facing_message(err, fallback="连接 BiSheng 失败，请稍后重试", status_code=502)
            ) from err
        finally:
            await client.aclose()

    async def _refresh_runtime_account_info(self) -> None:
        async with self._lock:
            current = self._read_config()
            if not current.api_token:
                self._connected = False
                self._auth_user = None
                self._auth_message = "未配置 BiSheng 数据源 token"
                client = None
                token = ""
            elif self._client is None:
                self._connected = False
                self._auth_user = None
                self._auth_message = "BiSheng client is not initialized"
                client = None
                token = current.api_token
            else:
                client = self._client
                token = current.api_token
        if client is None:
            await self._publish_shared_state()
            return

        try:
            response = await client.get_json("/api/v1/user/info")
            data = _unwrap_bisheng_payload(response)
        except Exception as err:
            async with self._lock:
                if self._client is not client:
                    return
                current = self._read_config()
                self._connected = False
                self._auth_user = None
                self._auth_message = (
                    f"BiSheng 数据源登录信息获取失败："
                    f"{self._sanitize_error_message(err, current.api_token or token)}"
                )
            await self._publish_shared_state()
            return

        account = self._first_str(data, "user_name", "username", "account", "email") or current.username
        name = self._first_str(data, "nick_name", "nickname", "name", "real_name", "user_name") or account
        auth_user = BishengRuntimeAuthUser(
            account=account,
            name=name,
            role=self._first_str(data, "role_name", "role", "position", "department_name", "department"),
            external_id=self._first_str(data, "external_id", "employee_id", "staff_id"),
        )
        async with self._lock:
            if self._client is not client:
                return
            self._auth_user = auth_user
            self._connected = True
            self._auth_message = "已连接"
        await self._publish_shared_state()

    def _ensure_seeded(self) -> None:
        if self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY) is not None:
            return
        if self._config_path.exists():
            legacy = BishengRuntimeConfig.model_validate_json(
                self._config_path.read_text(encoding="utf-8")
            )
            self._write_config(legacy)
            return
        seeded = BishengRuntimeConfig(
            base_url=self._default_base_url,
            asset_base_url=self._default_asset_base_url,
            username=self._default_username,
            timeout_seconds=self._default_timeout_seconds,
            api_token=self._default_api_token,
            saved_password="",
            last_auth_at="",
        )
        self._write_config(seeded)

    def _read_config(self) -> BishengRuntimeConfig:
        data = self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY)
        if data is not None:
            return BishengRuntimeConfig.model_validate(data)
        self._ensure_seeded()
        data = self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY)
        if data is None:
            raise RuntimeError("BiSheng runtime config is not initialized")
        return BishengRuntimeConfig.model_validate(data)

    def _write_config(self, config: BishengRuntimeConfig) -> None:
        self._store.upsert_document(self._TABLE_NAME, config.model_dump(mode="json"))

    async def _apply_shared_state(self, state: BishengSharedAuthState) -> None:
        async with self._lock:
            current = self._read_config()
            if current.api_token != state.access_token or current.last_auth_at != state.last_auth_at:
                current = current.model_copy(
                    update={
                        "api_token": state.access_token,
                        "last_auth_at": state.last_auth_at,
                    }
                )
                self._write_config(current)
            self._connected = state.connected
            self._auth_message = state.auth_message
            self._auth_user = state.auth_user
            self._set_current_client_token(state.access_token)

    async def _publish_shared_state(self) -> None:
        if self._auth_state_store is None:
            return
        async with self._lock:
            current = self._read_config()
            token = current.api_token
            state = BishengSharedAuthState(
                access_token=token,
                connected=self._connected,
                auth_message=self._auth_message,
                auth_user=self._auth_user,
                last_auth_at=current.last_auth_at,
                expires_at=(
                    self._shared_token_expires_at(token)
                    if token
                    else time.time() + DEFAULT_DISCONNECTED_STATE_TTL_SECONDS
                ),
                version=secrets.token_urlsafe(16),
            )
            fingerprint = self._config_fingerprint(current)
        owner = secrets.token_urlsafe(24)
        acquired = await self._auth_state_store.acquire_refresh_lock(
            fingerprint,
            owner,
            ttl_seconds=max(60, int(current.timeout_seconds * 3)),
        )
        if not acquired:
            return
        try:
            latest = await self._auth_state_store.get(fingerprint)
            if latest is not None and latest.access_token != state.access_token:
                await self._apply_shared_state(latest)
                return
            await self._auth_state_store.save(fingerprint, state)
        finally:
            try:
                await self._auth_state_store.release_refresh_lock(fingerprint, owner)
            except BishengAuthStateStoreError:
                logger.warning("BiSheng 共享登录状态发布锁释放失败，将等待租期自动清理")

    @staticmethod
    def _config_fingerprint(config: BishengRuntimeConfig) -> str:
        source = f"{str(config.base_url).rstrip('/')}|{config.username.strip().lower()}"
        return hashlib.sha256(source.encode("utf-8")).hexdigest()

    @staticmethod
    def _shared_token_expires_at(token: str) -> float:
        expires_at = _decode_jwt_exp(token)
        if expires_at is not None:
            return expires_at.timestamp()
        return time.time() + DEFAULT_OPAQUE_TOKEN_TTL_SECONDS

    async def _replace_client(self, config: BishengRuntimeConfig) -> None:
        next_client = self._create_runtime_client(config)
        previous = self._client
        self._client = next_client
        if previous is not None:
            task = asyncio.create_task(
                self._retire_client(previous),
                name="bisheng-runtime-client-retire",
            )
            self._retired_client_tasks.add(task)
            task.add_done_callback(self._retired_client_tasks.discard)

    async def _retire_client(self, client: BishengClient) -> None:
        try:
            await self._client_retire_sleeper(
                self._client_retire_grace_seconds
            )
        finally:
            await client.aclose()

    def _to_public_view(self, config: BishengRuntimeConfig) -> BishengRuntimeConfigView:
        return BishengRuntimeConfigView(
            base_url=config.base_url,
            asset_base_url=config.asset_base_url,
            username=config.username,
            timeout_seconds=config.timeout_seconds,
            has_token=bool(config.api_token),
            has_saved_password=bool(config.saved_password),
            last_auth_at=config.last_auth_at,
            connected=self._connected,
            auth_message=self._auth_message,
            auth_user=self._auth_user,
        )

    @staticmethod
    def _first_str(data: dict, *keys: str) -> str:
        for key in keys:
            value = data.get(key)
            if value not in (None, ""):
                return str(value)
        return ""

    @staticmethod
    def _sanitize_error_message(err: Exception, token: str) -> str:
        message = str(err) or err.__class__.__name__
        if token:
            message = message.replace(token, "***")
        return message

    def _create_runtime_client(self, config: BishengRuntimeConfig) -> BishengClient:
        kwargs = {
            "asset_base_url": config.asset_base_url or None,
            "auth_refresh_handler": self.refresh_token_after_auth_failure,
        }
        try:
            return self._client_factory(
                str(config.base_url),
                config.timeout_seconds,
                config.api_token or None,
                **kwargs,
            )
        except TypeError as err:
            if "auth_refresh_handler" not in str(err):
                raise
            kwargs.pop("auth_refresh_handler", None)
            return self._client_factory(
                str(config.base_url),
                config.timeout_seconds,
                config.api_token or None,
                **kwargs,
            )

    def _set_current_client_token(self, token: str) -> None:
        if self._client is not None and hasattr(self._client, "set_api_token"):
            self._client.set_api_token(token)

    def _runtime_password(self, config: BishengRuntimeConfig) -> str:
        if config.saved_password:
            return config.saved_password
        return self._default_password


def _unwrap_bisheng_payload(response: dict) -> dict:
    if response.get("status_code") == 200:
        data = response.get("data")
        return data if isinstance(data, dict) else {}
    status = response.get("status_code")
    raise ValueError(
        normalize_user_facing_message(
            response.get("status_message"),
            fallback="BiSheng 请求失败",
            status_code=int(status) if isinstance(status, int) else None,
        )
    )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _decode_jwt_exp(token: str) -> datetime | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload_segment = parts[1]
    padding = "=" * (-len(payload_segment) % 4)
    try:
        payload_bytes = base64.urlsafe_b64decode(payload_segment + padding)
        payload = json.loads(payload_bytes)
    except (ValueError, json.JSONDecodeError):
        return None
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    return datetime.fromtimestamp(exp, tz=timezone.utc)


def _parse_rsa_public_key(public_key_pem: str) -> tuple[int, int]:
    body = "".join(
        line.strip()
        for line in public_key_pem.splitlines()
        if "BEGIN" not in line and "END" not in line
    )
    der = base64.b64decode(body)
    sequence, _ = _read_tlv(der, 0, 0x30)
    modulus_bytes, offset = _read_tlv(sequence, 0, 0x02)
    exponent_bytes, _ = _read_tlv(sequence, offset, 0x02)
    modulus = int.from_bytes(_strip_leading_zero(modulus_bytes), "big")
    exponent = int.from_bytes(_strip_leading_zero(exponent_bytes), "big")
    return modulus, exponent


def _encrypt_pkcs1_v1_5(modulus: int, exponent: int, message: bytes) -> str:
    key_size = (modulus.bit_length() + 7) // 8
    if len(message) > key_size - 11:
        raise ValueError("密码长度超出 RSA 加密限制")

    padding_length = key_size - len(message) - 3
    padding = bytearray()
    while len(padding) < padding_length:
        chunk = os.urandom(padding_length - len(padding))
        padding.extend(byte for byte in chunk if byte != 0)
    encoded_message = b"\x00\x02" + bytes(padding[:padding_length]) + b"\x00" + message
    cipher_int = pow(int.from_bytes(encoded_message, "big"), exponent, modulus)
    cipher_bytes = cipher_int.to_bytes(key_size, "big")
    return base64.b64encode(cipher_bytes).decode("ascii")


def _read_tlv(data: bytes, offset: int, expected_tag: int) -> tuple[bytes, int]:
    if data[offset] != expected_tag:
        raise ValueError("登录加密配置异常，请联系管理员")
    length, cursor = _read_length(data, offset + 1)
    end = cursor + length
    return data[cursor:end], end


def _read_length(data: bytes, offset: int) -> tuple[int, int]:
    length = data[offset]
    if length < 0x80:
        return length, offset + 1
    length_size = length & 0x7F
    start = offset + 1
    end = start + length_size
    return int.from_bytes(data[start:end], "big"), end


def _strip_leading_zero(raw: bytes) -> bytes:
    return raw[1:] if raw and raw[0] == 0 else raw
