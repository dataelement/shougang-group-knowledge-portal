import io
import uuid
from pathlib import Path
from typing import Final

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from PIL import Image, UnidentifiedImageError

from app.api.dependencies import require_admin_session
from app.schemas.common import response_ok

router = APIRouter(
    prefix="/api/v1/admin/upload",
    tags=["admin-upload"],
    dependencies=[Depends(require_admin_session)],
)

MAX_BANNER_BYTES: Final[int] = 5 * 1024 * 1024
ALLOWED_MIME: Final[set[str]] = {"image/jpeg", "image/png", "image/webp"}
PILLOW_FORMAT_TO_EXT: Final[dict[str, str]] = {
    "JPEG": "jpg",
    "PNG": "png",
    "WEBP": "webp",
}


def get_uploads_root(request: Request) -> Path:
    return request.app.state.uploads_root


@router.post("/banner")
async def upload_banner_image(
    request: Request,
    file: UploadFile = File(...),
    uploads_root: Path = Depends(get_uploads_root),
):
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail=f"不支持的图片类型: {file.content_type}")

    payload = await file.read(MAX_BANNER_BYTES + 1)
    if len(payload) > MAX_BANNER_BYTES:
        raise HTTPException(status_code=413, detail="图片不得超过 5MB")
    if not payload:
        raise HTTPException(status_code=422, detail="文件为空")

    try:
        with Image.open(io.BytesIO(payload)) as img:
            img.verify()
        with Image.open(io.BytesIO(payload)) as img:
            pillow_format = (img.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=415, detail="图片解析失败，可能不是有效的图片")

    ext = PILLOW_FORMAT_TO_EXT.get(pillow_format)
    if not ext:
        raise HTTPException(status_code=415, detail=f"不支持的图片格式: {pillow_format or '未知'}")

    banners_dir = uploads_root / "banners"
    banners_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    target_path = banners_dir / filename
    target_path.write_bytes(payload)

    return response_ok({"image_url": f"/uploads/banners/{filename}"})
