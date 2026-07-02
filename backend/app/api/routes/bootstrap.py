from fastapi import APIRouter, Depends, Request

from app.api.dependencies import get_bisheng_runtime_service
from app.schemas.bisheng_runtime import BishengRuntimeConfigUpdate
from app.schemas.common import response_error, response_ok
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.error_messages import normalize_user_facing_message

router = APIRouter(prefix="/api/v1/bootstrap/bisheng", tags=["bootstrap"])


def _runtime_config_store(request: Request, runtime_service: BishengRuntimeService):
    store = getattr(request.app.state, "portal_admin_config_store", None)
    if store is None or getattr(store, "runtime_service", None) is not runtime_service:
        return None
    return store


@router.get("/status")
async def get_bisheng_bootstrap_status(
    service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
):
    config = await service.refresh_connection_status()
    return response_ok(
        {
            "required": service.is_bootstrap_required(),
            "connected": config.connected,
            "message": config.auth_message,
        }
    )


@router.post("")
async def bootstrap_bisheng_runtime_config(
    request: Request,
    payload: BishengRuntimeConfigUpdate,
    service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
):
    await service.refresh_connection_status()
    if not service.is_bootstrap_required():
        return response_error("BiSheng 初始化已完成，入口已关闭", status_code=409)

    if not payload.username.strip():
        return response_error("请输入 BiSheng 登录账号", status_code=400)
    if payload.password is None or not payload.password.get_secret_value().strip():
        return response_error("首次初始化必须输入 BiSheng 登录密码", status_code=400)

    try:
        config = await service.update_config(payload)
        store = _runtime_config_store(request, service)
        if store is not None:
            store.upsert_document(
                "bisheng_runtime_config",
                service.get_persistent_config().model_dump(mode="json"),
            )
    except ValueError as err:
        return response_error(normalize_user_facing_message(err, status_code=400), status_code=400)
    return response_ok(config)
