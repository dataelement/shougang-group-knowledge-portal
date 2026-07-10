from fastapi import HTTPException, Request

from app.clients.bisheng import BishengClient
from app.schemas.portal_admin_config import PortalBishengPersistentConfig
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_auth_service import PortalAuthError, PortalAuthService, PortalSession
from app.services.portal_config_service import PortalConfigService
from app.services.portal_home_cache_service import PortalHomeCacheService
from app.services.portal_unified_auth_service import PortalUnifiedAuthService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService


ADMIN_ROLES = {"管理员", "系统管理员", "admin"}
ADMIN_ACCOUNTS = {"admin"}


def get_portal_config_service(request: Request) -> PortalConfigService:
    return request.app.state.portal_config_service


def get_portal_home_cache_service(request: Request) -> PortalHomeCacheService:
    return getattr(request.app.state, "portal_home_cache_service", PortalHomeCacheService())


def get_bisheng_runtime_service(request: Request) -> BishengRuntimeService:
    return request.app.state.bisheng_runtime_service


def get_portal_auth_service(request: Request) -> PortalAuthService:
    return request.app.state.portal_auth_service


def get_portal_unified_auth_service(request: Request) -> PortalUnifiedAuthService:
    return request.app.state.portal_unified_auth_service


def get_unified_auth_runtime_service(request: Request) -> UnifiedAuthRuntimeService:
    return request.app.state.unified_auth_runtime_service


async def get_bisheng_client(request: Request) -> BishengClient:
    if hasattr(request.app.state, "bisheng_client"):
        return request.app.state.bisheng_client
    runtime_service = request.app.state.bisheng_runtime_service
    await _apply_remote_bisheng_runtime_config_if_needed(request, runtime_service)
    return runtime_service.get_client()


async def _apply_remote_bisheng_runtime_config_if_needed(
    request: Request,
    runtime_service: BishengRuntimeService,
) -> None:
    current = runtime_service.get_runtime_config_snapshot()
    if current.api_token and current.saved_password and not runtime_service.is_bootstrap_required():
        return

    store = getattr(request.app.state, "portal_admin_config_store", None)
    if store is None or getattr(store, "runtime_service", None) is not runtime_service:
        return

    remote_runtime = store.get_document("bisheng_runtime_config")
    if not remote_runtime:
        return

    await runtime_service.apply_persistent_config(
        PortalBishengPersistentConfig.model_validate(remote_runtime),
    )


def _normalize_identity(value: str | None) -> str:
    return (value or "").strip().lower()


def is_portal_admin_role(role: str | None) -> bool:
    return _normalize_identity(role) in ADMIN_ROLES


def is_portal_admin_account(account: str | None) -> bool:
    return _normalize_identity(account) in ADMIN_ACCOUNTS


def require_admin_session(request: Request) -> PortalSession:
    auth_service = get_portal_auth_service(request)
    try:
        session = auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    if not (is_portal_admin_role(session.user.role) or is_portal_admin_account(session.user.account)):
        raise HTTPException(status_code=403, detail="无权限访问知识管理后台")
    return session
