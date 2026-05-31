from fastapi import APIRouter

from app.api.routes.admin_config import router as admin_config_router
from app.api.routes.admin_upload import router as admin_upload_router
from app.api.routes.auth import router as auth_router
from app.api.routes.bootstrap import router as bootstrap_router
from app.api.routes.chat_proxy import router as chat_proxy_router
from app.api.routes.health import router as health_router
from app.api.routes.knowledge import router as knowledge_router
from app.api.routes.notifications import router as notifications_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(bootstrap_router)
api_router.include_router(admin_config_router)
api_router.include_router(admin_upload_router)
api_router.include_router(knowledge_router)
api_router.include_router(chat_proxy_router)
api_router.include_router(notifications_router)
