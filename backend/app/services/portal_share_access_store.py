import json
import logging
import math
import time
from dataclasses import asdict, dataclass
from typing import Any, Protocol

from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

_SHARE_ACCESS_KEY_PREFIX = "shougang_portal:share_access:v2"
SHARE_ACCESS_COOKIE_NAME = "portal_share_access"
SHARE_ACCESS_TTL_SECONDS = 3600


class PortalShareAccessStoreError(RuntimeError):
    """分享访问会话存储不可用。"""

    def __init__(self):
        super().__init__("分享访问服务暂不可用，请稍后重试")


@dataclass(frozen=True)
class PortalShareAccessSession:
    session_id: str
    share_token: str
    space_id: int
    file_id: int
    allow_download: bool
    download_grant: str
    portal_session_id: str
    expires_at: float
    canonical_document_id: int | None = None
    canonical_version_id: int | None = None
    entry_file_id: int | None = None
    desired_content_generation: int = 0
    applied_content_generation: int = 0
    desired_entry_generation: int = 0
    applied_entry_generation: int = 0


class PortalShareAccessSessionStore(Protocol):
    async def save(self, session: PortalShareAccessSession) -> None: ...

    async def get(
        self,
        session_id: str,
        *,
        share_token: str,
        space_id: int,
        file_id: int,
        portal_session_id: str = "",
        require_download: bool = False,
    ) -> PortalShareAccessSession | None: ...


def _validate_session(session: PortalShareAccessSession) -> None:
    if not session.session_id or not session.share_token:
        raise ValueError("share session identity is required")
    if session.space_id <= 0 or session.file_id <= 0:
        raise ValueError("share session target is invalid")
    if (
        session.canonical_document_id is not None
        and (
            session.canonical_document_id <= 0
            or session.entry_file_id is None
            or session.entry_file_id <= 0
        )
    ):
        raise ValueError("share session durable reference is invalid")
    if session.download_grant and not session.portal_session_id:
        raise ValueError("download grant requires portal session binding")


def _matches_session(
    session: PortalShareAccessSession,
    *,
    share_token: str,
    space_id: int,
    file_id: int,
    portal_session_id: str,
    require_download: bool,
) -> bool:
    if (
        session.share_token != share_token
        or session.space_id != space_id
        or session.file_id != file_id
    ):
        return False
    if not require_download:
        return True
    return bool(
        session.allow_download
        and session.download_grant
        and portal_session_id
        and session.portal_session_id == portal_session_id
    )


class InMemoryPortalShareAccessSessionStore:
    """仅供未配置 Redis 的开发环境使用。"""

    def __init__(self):
        self._sessions: dict[str, PortalShareAccessSession] = {}

    async def save(self, session: PortalShareAccessSession) -> None:
        _validate_session(session)
        if session.expires_at <= time.time():
            raise ValueError("share session is already expired")
        self._sessions[session.session_id] = session

    async def get(
        self,
        session_id: str,
        *,
        share_token: str,
        space_id: int,
        file_id: int,
        portal_session_id: str = "",
        require_download: bool = False,
    ) -> PortalShareAccessSession | None:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if session.expires_at <= time.time():
            self._sessions.pop(session_id, None)
            return None
        if not _matches_session(
            session,
            share_token=share_token,
            space_id=space_id,
            file_id=file_id,
            portal_session_id=portal_session_id,
            require_download=require_download,
        ):
            return None
        return session


class RedisPortalShareAccessSessionStore:
    """在门户多个 Worker 间共享的 Redis v2 分享会话。"""

    def __init__(self, redis_client: Any):
        self._redis = redis_client

    async def save(self, session: PortalShareAccessSession) -> None:
        _validate_session(session)
        ttl_seconds = math.ceil(session.expires_at - time.time())
        if ttl_seconds <= 0:
            raise ValueError("share session is already expired")
        payload = json.dumps(asdict(session), ensure_ascii=False, separators=(",", ":"))
        try:
            await self._redis.set(
                self.session_key(session.session_id),
                payload,
                ex=min(SHARE_ACCESS_TTL_SECONDS, ttl_seconds),
            )
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalShareAccessStoreError() from err

    async def get(
        self,
        session_id: str,
        *,
        share_token: str,
        space_id: int,
        file_id: int,
        portal_session_id: str = "",
        require_download: bool = False,
    ) -> PortalShareAccessSession | None:
        if not session_id:
            return None
        key = self.session_key(session_id)
        try:
            raw = await self._redis.get(key)
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise PortalShareAccessStoreError() from err
        if raw is None:
            return None
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            session = PortalShareAccessSession(**json.loads(raw))
            _validate_session(session)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
            logger.warning("门户分享访问会话数据无效，已忽略")
            return None
        if session.expires_at <= time.time():
            try:
                await self._redis.delete(key)
            except (RedisError, OSError, TypeError, ValueError) as err:
                raise PortalShareAccessStoreError() from err
            return None
        if not _matches_session(
            session,
            share_token=share_token,
            space_id=space_id,
            file_id=file_id,
            portal_session_id=portal_session_id,
            require_download=require_download,
        ):
            return None
        return session

    @staticmethod
    def session_key(session_id: str) -> str:
        return f"{_SHARE_ACCESS_KEY_PREFIX}:{session_id}"


def build_portal_share_access_session_store(
    redis_client: Any | None,
    *,
    app_env: str,
) -> PortalShareAccessSessionStore:
    if redis_client is not None:
        return RedisPortalShareAccessSessionStore(redis_client)
    if app_env.strip().lower() == "production":
        raise RuntimeError("生产环境分享访问会话必须配置 Redis")
    return InMemoryPortalShareAccessSessionStore()
