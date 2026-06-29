import json
from datetime import UTC, datetime
from typing import Final

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.dependencies import (
    get_bisheng_client,
    get_bisheng_runtime_service,
    get_portal_config_service,
    get_unified_auth_runtime_service,
    require_admin_session,
)
from app.clients.bisheng import BishengClient
from app.schemas.bisheng_runtime import BishengRuntimeConfigUpdate
from app.schemas.admin_config_transfer import AdminConfigExportPayload, AdminConfigImportPayload
from app.schemas.common import response_error, response_ok
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfigUpdate
from app.schemas.portal_config import (
    AgentConfig,
    AppsConfigUpdate,
    BannersConfigUpdate,
    BusinessDomainOptionsConfigUpdate,
    DisplayConfig,
    DocumentTypesConfigUpdate,
    DomainsConfigUpdate,
    IntegrationsConfig,
    PortalConfig,
    QAConfig,
    RecommendationConfig,
    SearchConfig,
    SectionsConfigUpdate,
    SiteConfig,
    SpacesConfigUpdate,
)
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.error_messages import normalize_user_facing_message
from app.services.portal_config_service import PortalConfigService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService

router = APIRouter(
    prefix="/api/v1/admin/config",
    tags=["admin-config"],
    dependencies=[Depends(require_admin_session)],
)

MAX_CONFIG_IMPORT_BYTES: Final[int] = 2 * 1024 * 1024
ALLOWED_CONFIG_IMPORT_MIME: Final[set[str]] = {
    "application/json",
    "text/json",
    "application/octet-stream",
}


async def _fetch_shougang_portal_space_info(
    bisheng_client: BishengClient,
    space_ids: list[int],
) -> dict[int, dict]:
    if not space_ids:
        return {}
    try:
        response = await bisheng_client.post_json(
            "/api/v1/knowledge/shougang-portal/spaces/info",
            json={"space_ids": space_ids},
        )
    except Exception:
        return {}
    data = response.get("data") or {}
    raw_spaces = data.get("spaces") if isinstance(data, dict) else []
    if not isinstance(raw_spaces, list):
        return {}
    live_space_data: dict[int, dict] = {}
    for item in raw_spaces:
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        item_data = item.get("data") or {}
        live_space_data[int(item["id"])] = item_data if isinstance(item_data, dict) else {}
    return live_space_data


@router.get("")
async def get_portal_config(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    config = service.get_config()
    live_space_data = await _fetch_shougang_portal_space_info(
        bisheng_client,
        [space.id for space in config.spaces],
    )
    live_config = service.with_live_space_data(config, live_space_data)
    return response_ok(live_config)


@router.get("/export")
async def export_admin_config(
    service: PortalConfigService = Depends(get_portal_config_service),
    runtime_service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
    unified_auth_service: UnifiedAuthRuntimeService = Depends(get_unified_auth_runtime_service),
):
    payload = AdminConfigExportPayload(
        exported_at=datetime.now(UTC).isoformat(),
        portal=service.get_config(),
        bisheng=runtime_service.export_importable_config(),
        unified_auth=unified_auth_service.export_importable_config(),
    )
    filename = f"portal-config-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.json"
    return JSONResponse(
        content=payload.model_dump(mode="json"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_admin_config(
    file: UploadFile = File(...),
    service: PortalConfigService = Depends(get_portal_config_service),
    runtime_service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
    unified_auth_service: UnifiedAuthRuntimeService = Depends(get_unified_auth_runtime_service),
):
    if file.content_type and file.content_type not in ALLOWED_CONFIG_IMPORT_MIME:
        return response_error(f"不支持的配置文件类型: {file.content_type}", status_code=415)

    payload_bytes = await file.read(MAX_CONFIG_IMPORT_BYTES + 1)
    if len(payload_bytes) > MAX_CONFIG_IMPORT_BYTES:
        return response_error("配置文件不得超过 2MB", status_code=413)
    if not payload_bytes:
        return response_error("配置文件为空", status_code=400)

    try:
        raw_payload = json.loads(payload_bytes.decode("utf-8"))
        payload = AdminConfigImportPayload.model_validate(raw_payload)
        if payload.version != 1:
            return response_error("配置文件格式不正确：不支持的配置版本", status_code=400)
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as err:
        return response_error(f"配置文件格式不正确：{err}", status_code=400)

    previous_portal = service.get_config()
    previous_runtime = runtime_service.snapshot_config()
    previous_unified_auth = unified_auth_service.snapshot_config()
    try:
        updated_portal = service.replace_config(payload.portal)
        updated_runtime = await runtime_service.replace_importable_config(payload.bisheng)
        updated_unified_auth = (
            unified_auth_service.replace_importable_config(payload.unified_auth)
            if payload.unified_auth is not None
            else unified_auth_service.get_public_config()
        )
    except Exception as err:
        service.replace_config(previous_portal)
        await runtime_service.restore_config(previous_runtime)
        unified_auth_service.restore_config(previous_unified_auth)
        return response_error(f"配置导入失败，已回滚：{err}", status_code=500)

    return response_ok(
        {
            "portal": updated_portal,
            "bisheng": updated_runtime,
            "unified_auth": updated_unified_auth,
            "message": "配置导入成功。BiSheng 数据源不包含令牌，必要时请重新输入密码并保存验证。",
        }
    )


@router.post("")
async def replace_portal_config(
    payload: PortalConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.replace_config(payload))


@router.get("/spaces")
async def get_spaces_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"spaces": service.get_config().spaces})


@router.post("/spaces")
async def update_spaces_config(
    payload: SpacesConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"spaces": service.update_spaces(payload).spaces})


@router.get("/space-options")
async def get_space_options(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        response = await bisheng_client.get_json(
            "/api/v1/knowledge",
            params={"page_num": 1, "page_size": 100, "type": 3},
        )
    except Exception:
        return response_ok(service.build_space_options([]))
    data = response.get("data") or {}
    raw_spaces = data.get("data") if isinstance(data, dict) else []
    if not isinstance(raw_spaces, list):
        raw_spaces = []

    live_space_data = await _fetch_shougang_portal_space_info(
        bisheng_client,
        [int(item["id"]) for item in raw_spaces if item.get("id") is not None],
    )
    enriched_spaces = []
    for item in raw_spaces:
        space_id = item.get("id")
        info = live_space_data.get(int(space_id)) if space_id is not None else None
        if not isinstance(info, dict) or not info:
            enriched_spaces.append(item)
            continue
        enriched_item = {
            **item,
            "name": info.get("name") or item.get("name"),
            "description": info.get("description") or item.get("description"),
            "file_num": info.get("file_num") or item.get("file_num") or 0,
            "space_level": info.get("space_level") or item.get("space_level") or "personal",
        }
        enriched_spaces.append(enriched_item)
    return response_ok(service.build_space_options(enriched_spaces))


@router.get("/spaces/{space_id}/files")
async def get_space_files(
    space_id: int,
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        response = await bisheng_client.get_json(
            f"/api/v1/knowledge/file_list/{space_id}",
            params={"page_num": 1, "page_size": 100},
        )
    except Exception:
        return response_ok(service.build_space_files(space_id, []))
    data = response.get("data") or {}
    raw_files = data.get("data") if isinstance(data, dict) else []
    if not isinstance(raw_files, list):
        raw_files = []
    return response_ok(service.build_space_files(space_id, raw_files))


@router.get("/spaces/{space_id}/folders")
async def get_space_folders(
    space_id: int,
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    raw_items: list[dict] = []
    page = 1
    page_size = 100
    while True:
        try:
            response = await bisheng_client.get_json(
                f"/api/v1/knowledge/space/{space_id}/search",
                params={
                    "page": page,
                    "page_size": page_size,
                    "order_field": "file_type",
                    "order_sort": "asc",
                },
            )
        except Exception:
            return response_ok(service.build_space_folders(space_id, raw_items))
        data = response.get("data") or {}
        batch = data.get("data") if isinstance(data, dict) else []
        if not isinstance(batch, list) or not batch:
            break
        raw_items.extend(item for item in batch if isinstance(item, dict))
        if len(batch) < page_size:
            break
        page += 1
    return response_ok(service.build_space_folders(space_id, raw_items))


@router.get("/domains")
async def get_domains_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"domains": service.get_config().domains})


@router.post("/domains")
async def update_domains_config(
    payload: DomainsConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"domains": service.update_domains(payload).domains})


@router.get("/sections")
async def get_sections_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"sections": service.get_config().sections})


@router.post("/sections")
async def update_sections_config(
    payload: SectionsConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"sections": service.update_sections(payload).sections})


@router.get("/document-types")
async def get_document_types_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"document_types": service.get_config().document_types})


@router.post("/document-types")
async def update_document_types_config(
    payload: DocumentTypesConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"document_types": service.update_document_types(payload).document_types})


@router.get("/business-domain-options")
async def get_business_domain_options_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"business_domain_options": service.get_config().business_domain_options})


@router.post("/business-domain-options")
async def update_business_domain_options_config(
    payload: BusinessDomainOptionsConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"business_domain_options": service.update_business_domain_options(payload).business_domain_options})


@router.get("/qa")
async def get_qa_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().qa)


@router.post("/qa")
async def update_qa_config(
    payload: QAConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_qa(payload).qa)


@router.get("/qa/model-options")
async def get_qa_model_options(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        response = await bisheng_client.get_json("/api/v1/llm")
    except Exception:
        return response_ok(service.build_qa_model_options([]))
    raw_servers = response.get("data") if isinstance(response, dict) else []
    if not isinstance(raw_servers, list):
        raw_servers = []
    return response_ok(service.build_qa_model_options(raw_servers))


@router.get("/agent-config")
async def get_agent_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().agent_config)


@router.post("/agent-config")
async def update_agent_config(
    payload: AgentConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_agent_config(payload).agent_config)


@router.get("/agent-config/workflow-options")
async def get_agent_workflow_options(
    keyword: str = "",
    cursor: str = "",
    page_size: int = 50,
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    params = {
        "page_size": max(1, min(page_size, 100)),
        "flow_type": 10,
        "status": 2,
        "permission_id": "use_app",
    }
    if keyword.strip():
        params["name"] = keyword.strip()
    if cursor.strip():
        params["cursor"] = cursor.strip()
    try:
        response = await bisheng_client.get_json("/api/v1/workflow/list", params=params)
    except Exception:
        return response_error("Bisheng workflow 候选项加载失败，请检查数据源配置或稍后重试。", status_code=502)
    return response_ok(service.build_agent_workflow_options(response))


@router.get("/search")
async def get_search_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().search)


@router.post("/search")
async def update_search_config(
    payload: SearchConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_search(payload).search)


@router.get("/search/rerank-model-options")
async def get_search_rerank_model_options(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        response = await bisheng_client.get_json("/api/v1/llm")
    except Exception:
        return response_ok(service.build_search_rerank_model_options([]))
    raw_servers = response.get("data") if isinstance(response, dict) else []
    if not isinstance(raw_servers, list):
        raw_servers = []
    return response_ok(service.build_search_rerank_model_options(raw_servers))


@router.get("/recommendation")
async def get_recommendation_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().recommendation)


@router.post("/recommendation")
async def update_recommendation_config(
    payload: RecommendationConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_recommendation(payload).recommendation)


@router.get("/display")
async def get_display_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().display)


@router.post("/display")
async def update_display_config(
    payload: DisplayConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_display(payload).display)


@router.get("/apps")
async def get_apps_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"apps": service.get_config().apps})


@router.post("/apps")
async def update_apps_config(
    payload: AppsConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"apps": service.update_apps(payload).apps})


@router.get("/banners")
async def get_banners_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"banners": service.get_config().banners})


@router.post("/banners")
async def update_banners_config(
    payload: BannersConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"banners": service.update_banners(payload).banners})


@router.get("/integrations")
async def get_integrations_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().integrations)


@router.post("/integrations")
async def update_integrations_config(
    payload: IntegrationsConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_integrations(payload).integrations)


@router.get("/site")
async def get_site_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().site)


@router.post("/site")
async def update_site_config(
    payload: SiteConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.update_site(payload).site)


@router.get("/bisheng")
async def get_bisheng_runtime_config(
    service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
):
    return response_ok(service.get_public_config())


@router.post("/bisheng")
async def update_bisheng_runtime_config(
    payload: BishengRuntimeConfigUpdate,
    service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
):
    try:
        config = await service.update_config(payload)
    except ValueError as err:
        return response_error(normalize_user_facing_message(err, status_code=400), status_code=400)
    return response_ok(config)


@router.get("/unified-auth")
async def get_unified_auth_runtime_config(
    service: UnifiedAuthRuntimeService = Depends(get_unified_auth_runtime_service),
):
    return response_ok(service.get_public_config())


@router.post("/unified-auth")
async def update_unified_auth_runtime_config(
    payload: UnifiedAuthRuntimeConfigUpdate,
    service: UnifiedAuthRuntimeService = Depends(get_unified_auth_runtime_service),
):
    try:
        config = service.update_config(payload)
    except ValueError as err:
        return response_error(normalize_user_facing_message(err, status_code=400), status_code=400)
    return response_ok(config)
