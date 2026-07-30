import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.dependencies import get_bisheng_client, require_admin_session
from app.clients.bisheng import BishengClient
from app.schemas.common import response_ok
from app.services.error_messages import normalize_user_facing_message

router = APIRouter(
    prefix="/api/v1/admin/upload",
    tags=["admin-upload"],
    dependencies=[Depends(require_admin_session)],
)

@router.post("/banner")
async def upload_banner_image(
    file: UploadFile = File(...),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    return await _proxy_public_asset(file, bisheng_client, "banner")


@router.post("/app-icon")
async def upload_application_icon(
    file: UploadFile = File(...),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    return await _proxy_public_asset(file, bisheng_client, "app-icon")


async def _proxy_public_asset(
    file: UploadFile,
    bisheng_client: BishengClient,
    category: str,
):
    try:
        payload = await bisheng_client.post_multipart(
            f"/api/v1/shougang-portal/assets/{category}",
            files={
                "file": (
                    file.filename or "portal-asset",
                    file.file,
                    file.content_type or "application/octet-stream",
                )
            },
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=normalize_user_facing_message(
                exc,
                fallback="BiSheng 资源上传服务连接异常，请稍后重试",
                status_code=502,
            ),
        ) from exc

    remote_status = int(payload.get("status_code") or 500)
    data = payload.get("data")
    if remote_status != 200 or not isinstance(data, dict) or not data.get("image_url"):
        portal_status = remote_status if 400 <= remote_status < 500 else 502
        raise HTTPException(
            status_code=portal_status,
            detail=normalize_user_facing_message(
                payload.get("status_message"),
                fallback="BiSheng 资源上传失败，请稍后重试",
                status_code=portal_status,
            ),
        )

    return response_ok({"image_url": str(data["image_url"])})
