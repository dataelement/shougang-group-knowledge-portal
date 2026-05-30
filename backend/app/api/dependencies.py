from fastapi import HTTPException, Request

from app.clients.bisheng import BishengClient
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_auth_service import PortalAuthError, PortalAuthService, PortalSession
from app.services.portal_config_service import PortalConfigService


ADMIN_ROLES = {"管理员", "系统管理员", "admin"}
ADMIN_ACCOUNTS = {"admin"}


def get_portal_config_service(request: Request) -> PortalConfigService:
    return request.app.state.portal_config_service


def get_bisheng_runtime_service(request: Request) -> BishengRuntimeService:
    return request.app.state.bisheng_runtime_service


def get_portal_auth_service(request: Request) -> PortalAuthService:
    return request.app.state.portal_auth_service


def get_bisheng_client(request: Request) -> BishengClient:
    if hasattr(request.app.state, "bisheng_client"):
        return request.app.state.bisheng_client
    return request.app.state.bisheng_runtime_service.get_client()


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
