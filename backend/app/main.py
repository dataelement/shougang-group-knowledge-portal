import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from redis import asyncio as redis_asyncio

from app.api.router import api_router
from app.clients.bisheng import BishengAuthRefreshError
from app.schemas.common import response_error
from app.services.bisheng_auth_state_store import (
    BishengAuthStateStoreError,
    RedisBishengAuthStateStore,
)
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.config_store import RuntimeSnapshotConfigStore
from app.services.error_messages import normalize_user_facing_message
from app.services.portal_admin_config_store import RemotePortalAdminConfigStore
from app.services.portal_auth_service import (
    InMemoryPortalSessionStore,
    PortalAuthService,
    RedisPortalSessionStore,
)
from app.services.portal_bisheng_user_lookup import PortalBishengUserLookup
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService
from app.services.portal_rest_auth_service import PortalRestAuthService
from app.services.portal_runtime_config_coordinator import (
    PortalRuntimeConfigCoordinator,
    RuntimeConfigSyncError,
)
from app.services.portal_share_access_store import build_portal_share_access_session_store
from app.services.portal_unified_auth_service import PortalUnifiedAuthService
from app.services.rest_auth_runtime_service import RestAuthRuntimeService
from app.services.runtime_config_applier import RuntimeConfigApplier
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService
from app.settings import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    redis_client = redis_asyncio.from_url(settings.redis_url, decode_responses=True) if settings.redis_url else None
    if settings.app_env.lower() == "production" and redis_client is None:
        raise RuntimeError("生产环境必须配置 PORTAL_REDIS_URL 以共享门户登录会话和数据源登录态")
    if redis_client is not None:
        try:
            await redis_client.ping()
        except Exception as err:
            await redis_client.aclose()
            redis_client = None
            if settings.app_env.lower() == "production":
                raise RuntimeError("Redis 不可用，无法启动门户认证服务") from err
            logger.warning(
                "Redis 不可用，开发环境已降级为进程内会话存储；该模式不支持多副本",
            )
    app.state.bisheng_runtime_service = BishengRuntimeService(
        config_path=settings.bisheng_runtime_config_path,
        default_base_url=str(settings.bisheng_base_url),
        default_timeout_seconds=settings.bisheng_timeout_seconds,
        default_api_token=settings.bisheng_api_token,
        default_username=settings.bisheng_username,
        default_password=(settings.bisheng_password.get_secret_value() if settings.bisheng_password else None),
        default_asset_base_url=settings.bisheng_asset_base_url,
        store=RuntimeSnapshotConfigStore(),
        auth_state_store=(RedisBishengAuthStateStore(redis_client) if redis_client is not None else None),
    )
    await app.state.bisheng_runtime_service.initialize()
    app.state.portal_admin_config_store = RemotePortalAdminConfigStore(
        runtime_service=app.state.bisheng_runtime_service,
    )
    remote_aggregate = None
    try:
        remote_aggregate = await asyncio.to_thread(
            app.state.portal_admin_config_store.load_remote_aggregate,
        )
    except Exception:
        logger.exception("BiSheng 远程门户运行时配置加载失败")
    session_store = RedisPortalSessionStore(redis_client) if redis_client else InMemoryPortalSessionStore()
    app.state.portal_auth_service = PortalAuthService(
        runtime_service=app.state.bisheng_runtime_service,
        cookie_name=settings.portal_session_cookie_name,
        ttl_seconds=settings.portal_session_ttl_seconds,
        cookie_secure=settings.portal_session_cookie_secure,
        session_store=session_store,
    )
    app.state.unified_auth_runtime_service = UnifiedAuthRuntimeService(
        settings=settings,
        store=app.state.portal_admin_config_store,
    )
    app.state.rest_auth_runtime_service = RestAuthRuntimeService(
        settings=settings,
        store=app.state.portal_admin_config_store,
        unified_auth_runtime_service=app.state.unified_auth_runtime_service,
    )
    app.state.portal_bisheng_user_lookup = PortalBishengUserLookup(
        runtime_service=app.state.bisheng_runtime_service,
    )
    app.state.portal_unified_auth_service = PortalUnifiedAuthService(
        settings=settings,
        runtime_service=app.state.bisheng_runtime_service,
        auth_service=app.state.portal_auth_service,
        cookie_secure=settings.portal_session_cookie_secure,
        config_service=app.state.unified_auth_runtime_service,
    )
    app.state.portal_rest_auth_service = PortalRestAuthService(
        settings=settings,
        auth_service=app.state.portal_auth_service,
        unified_auth_service=app.state.portal_unified_auth_service,
        config_service=app.state.rest_auth_runtime_service,
        user_lookup=app.state.portal_bisheng_user_lookup,
        cookie_secure=settings.portal_session_cookie_secure,
    )
    app.state.portal_config_service = PortalConfigService(
        config_path=settings.portal_config_path,
        store=app.state.portal_admin_config_store,
    )
    app.state.runtime_config_applier = RuntimeConfigApplier(
        aggregate_store=app.state.portal_admin_config_store,
        bisheng_runtime_service=app.state.bisheng_runtime_service,
    )
    app.state.portal_runtime_config_coordinator = None
    if redis_client is not None or remote_aggregate is not None:
        app.state.portal_admin_config_store.enable_shared_cache()
        coordinator = PortalRuntimeConfigCoordinator(
            redis_client=redis_client,
            scope=settings.runtime_config_scope,
            load_remote=(
                (lambda: remote_aggregate)
                if remote_aggregate is not None
                else lambda: asyncio.to_thread(
                    app.state.portal_admin_config_store.load_remote_aggregate,
                )
            ),
            apply_snapshot=app.state.runtime_config_applier.apply,
            cache_ttl_seconds=settings.runtime_config_cache_ttl_seconds,
        )
        app.state.portal_runtime_config_coordinator = coordinator
        await coordinator.initialize()
        await coordinator.start_listener()
    app.state.portal_home_cache_service = PortalHomeCacheService(redis_client)
    app.state.portal_share_access_session_store = build_portal_share_access_session_store(
        redis_client,
        app_env=settings.app_env,
    )
    try:
        yield
    finally:
        coordinator = getattr(
            app.state,
            "portal_runtime_config_coordinator",
            None,
        )
        if coordinator is not None:
            await coordinator.stop_listener()
        await app.state.bisheng_runtime_service.aclose()
        if redis_client is not None:
            await redis_client.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def synchronize_runtime_config(request: Request, call_next):
        coordinator = getattr(
            request.app.state,
            "portal_runtime_config_coordinator",
            None,
        )
        if coordinator is not None:
            try:
                await coordinator.ensure_current()
            except RuntimeConfigSyncError:
                if coordinator.local_version <= 0:
                    logger.warning(
                        "门户运行时配置尚未持久化，继续使用环境默认配置"
                    )
                else:
                    logger.exception(
                        "门户运行时配置检查失败，继续使用最后有效版本"
                    )

        response = await call_next(request)
        if coordinator is None:
            return response

        store = getattr(request.app.state, "portal_admin_config_store", None)
        saved = store.last_saved_aggregate if store is not None else None
        if saved is None or saved.version <= coordinator.local_version:
            return response
        try:
            await coordinator.commit_saved_snapshot(saved)
        except RuntimeConfigSyncError as exc:
            return response_error(str(exc), status_code=503)
        return response

    @app.exception_handler(BishengAuthRefreshError)
    async def bisheng_auth_refresh_exception_handler(
        _request: Request,
        exc: BishengAuthRefreshError,
    ):
        return response_error(normalize_user_facing_message(exc, status_code=502), status_code=502)

    @app.exception_handler(BishengAuthStateStoreError)
    async def bisheng_auth_state_store_exception_handler(
        _request: Request,
        _exc: BishengAuthStateStoreError,
    ):
        return response_error("Redis 登录态服务不可用，请稍后重试", status_code=503)

    app.include_router(api_router)
    return app


app = create_app()
