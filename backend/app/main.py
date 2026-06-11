from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.portal_auth_service import PortalAuthService
from app.services.portal_config_service import PortalConfigService
from app.services.portal_unified_auth_service import PortalUnifiedAuthService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService
from app.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings
    app.state.bisheng_runtime_service = BishengRuntimeService(
        config_path=settings.bisheng_runtime_config_path,
        default_base_url=str(settings.bisheng_base_url),
        default_timeout_seconds=settings.bisheng_timeout_seconds,
        default_api_token=settings.bisheng_api_token,
        default_username=settings.bisheng_username,
        default_password=(
            settings.bisheng_password.get_secret_value() if settings.bisheng_password else None
        ),
        default_asset_base_url=settings.bisheng_asset_base_url,
        database_path=settings.portal_database_path,
    )
    await app.state.bisheng_runtime_service.initialize()
    app.state.portal_auth_service = PortalAuthService(
        runtime_service=app.state.bisheng_runtime_service,
        cookie_name=settings.portal_session_cookie_name,
        ttl_seconds=settings.portal_session_ttl_seconds,
        cookie_secure=settings.portal_session_cookie_secure,
    )
    app.state.unified_auth_runtime_service = UnifiedAuthRuntimeService(
        database_path=settings.portal_database_path,
        settings=settings,
    )
    app.state.portal_unified_auth_service = PortalUnifiedAuthService(
        settings=settings,
        runtime_service=app.state.bisheng_runtime_service,
        auth_service=app.state.portal_auth_service,
        cookie_secure=settings.portal_session_cookie_secure,
        config_service=app.state.unified_auth_runtime_service,
    )
    app.state.portal_config_service = PortalConfigService(
        config_path=settings.portal_config_path,
        database_path=settings.portal_database_path,
    )
    yield
    await app.state.bisheng_runtime_service.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        lifespan=lifespan,
    )

    uploads_root = settings.portal_config_path.parent / "uploads"
    uploads_root.mkdir(parents=True, exist_ok=True)
    app.state.uploads_root = uploads_root
    app.mount("/uploads", StaticFiles(directory=uploads_root), name="uploads")

    app.include_router(api_router)
    return app


app = create_app()
