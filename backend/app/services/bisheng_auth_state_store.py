import json
import time
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError
from redis.exceptions import RedisError

from app.schemas.bisheng_runtime import BishengRuntimeAuthUser

_KEY_PREFIX = "shougang_portal:bisheng_auth:v1"
_RELEASE_LOCK_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


class BishengAuthStateStoreError(RuntimeError):
    """共享毕昇登录态无法安全读取或更新。"""


class BishengSharedAuthState(BaseModel):
    access_token: str = ""
    connected: bool = False
    auth_message: str = "未验证"
    auth_user: BishengRuntimeAuthUser | None = None
    last_auth_at: str = ""
    expires_at: float
    version: str


class BishengAuthStateStore(Protocol):
    async def get(self, config_fingerprint: str) -> BishengSharedAuthState | None: ...

    async def save(
        self,
        config_fingerprint: str,
        state: BishengSharedAuthState,
    ) -> None: ...

    async def acquire_refresh_lock(
        self,
        config_fingerprint: str,
        owner: str,
        *,
        ttl_seconds: int,
    ) -> bool: ...

    async def release_refresh_lock(self, config_fingerprint: str, owner: str) -> None: ...


class RedisBishengAuthStateStore:
    """所有门户 Worker 共用的毕昇服务账号运行时登录态。"""

    def __init__(self, redis_client: Any):
        self._redis = redis_client

    async def get(self, config_fingerprint: str) -> BishengSharedAuthState | None:
        key = self.state_key(config_fingerprint)
        try:
            raw = await self._redis.get(key)
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 登录态读取失败") from err
        if raw is None:
            return None
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            state = BishengSharedAuthState.model_validate(json.loads(raw))
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 登录态数据无效") from err
        if state.expires_at > time.time():
            return state
        try:
            await self._redis.delete(key)
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 过期登录态清理失败") from err
        return None

    async def save(
        self,
        config_fingerprint: str,
        state: BishengSharedAuthState,
    ) -> None:
        ttl_seconds = max(1, int(state.expires_at - time.time()))
        payload = state.model_dump_json()
        try:
            await self._redis.set(
                self.state_key(config_fingerprint),
                payload,
                ex=ttl_seconds,
            )
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 登录态写入失败") from err

    async def acquire_refresh_lock(
        self,
        config_fingerprint: str,
        owner: str,
        *,
        ttl_seconds: int,
    ) -> bool:
        try:
            acquired = await self._redis.set(
                self.lock_key(config_fingerprint),
                owner,
                ex=max(1, int(ttl_seconds)),
                nx=True,
            )
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 登录刷新锁获取失败") from err
        return bool(acquired)

    async def release_refresh_lock(self, config_fingerprint: str, owner: str) -> None:
        try:
            await self._redis.eval(
                _RELEASE_LOCK_SCRIPT,
                1,
                self.lock_key(config_fingerprint),
                owner,
            )
        except (RedisError, OSError, TypeError, ValueError) as err:
            raise BishengAuthStateStoreError("Redis 登录刷新锁释放失败") from err

    @staticmethod
    def state_key(config_fingerprint: str) -> str:
        return f"{_KEY_PREFIX}:state:{config_fingerprint}"

    @staticmethod
    def lock_key(config_fingerprint: str) -> str:
        return f"{_KEY_PREFIX}:refresh-lock:{config_fingerprint}"
