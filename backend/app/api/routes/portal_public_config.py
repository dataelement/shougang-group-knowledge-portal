from fastapi import APIRouter, Depends

from app.api.dependencies import get_portal_config_service
from app.schemas.common import response_ok
from app.schemas.portal_config import resolve_portal_watermark_horizontal_text
from app.services.portal_config_service import PortalConfigService

router = APIRouter(prefix="/api/v1/shougang-portal/config", tags=["portal-public-config"])


@router.get("/watermark")
async def get_portal_watermark_config(
    portal_config_service: PortalConfigService = Depends(get_portal_config_service),
):
    configured = portal_config_service.get_config().watermark.horizontal_text
    return response_ok(
        {
            "horizontal_text": resolve_portal_watermark_horizontal_text(configured),
        }
    )
