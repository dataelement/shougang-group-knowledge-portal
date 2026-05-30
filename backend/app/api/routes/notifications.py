from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.dependencies import get_portal_auth_service
from app.schemas.common import response_ok
from app.services.notification_service import NotificationService
from app.services.portal_auth_service import PortalAuthError, PortalAuthService

router = APIRouter(prefix="/api/v1/portal/notifications", tags=["notifications"])


@router.get("/summary")
async def get_notification_summary(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    try:
        session = auth_service.require_session(request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err

    bisheng_client = auth_service.create_bisheng_client(session)
    try:
        service = NotificationService(bisheng_client=bisheng_client)
        return response_ok(await service.get_summary())
    finally:
        await bisheng_client.aclose()
