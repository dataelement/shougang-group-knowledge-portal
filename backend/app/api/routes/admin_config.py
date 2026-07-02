import json
import logging
from datetime import UTC, datetime
from typing import Any, Final

from fastapi import APIRouter, Depends, File, Request, UploadFile
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
    DomainConfig,
    DomainsConfigUpdate,
    IntegrationsConfig,
    PortalConfig,
    QAConfig,
    RecommendationConfig,
    SearchConfig,
    SectionsConfigUpdate,
    SiteConfig,
)
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.error_messages import normalize_user_facing_message
from app.services.knowledge_service import KnowledgeService
from app.services.portal_config_service import PortalConfigService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService

logger = logging.getLogger(__name__)

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
DOMAIN_BINDABLE_SPACE_LEVELS: Final[set[str]] = {"public", "department"}
SYNC_SPACE_BUSINESS_DOMAIN_CODES_PATH: Final[str] = (
    "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes"
)


def _runtime_config_store(request: Request, runtime_service: BishengRuntimeService):
    store = getattr(request.app.state, "portal_admin_config_store", None)
    if store is None or getattr(store, "runtime_service", None) is not runtime_service:
        return None
    return store


async def _load_domain_bindable_space_rows(
    service: PortalConfigService,
    bisheng_client: BishengClient,
) -> list[dict[str, Any]]:
    knowledge_service = KnowledgeService(
        bisheng_client=bisheng_client,
        portal_config_service=service,
    )
    spaces = await knowledge_service.list_visible_spaces()
    return [
        space.model_dump()
        for space in spaces.data
        if (space.space_level or "").strip().lower() in DOMAIN_BINDABLE_SPACE_LEVELS
    ]


def _collect_domain_space_ids(domains: list[DomainConfig]) -> set[int]:
    space_ids: set[int] = set()
    for domain in domains:
        for raw_space_id in domain.space_ids:
            space_id = int(raw_space_id)
            if space_id > 0:
                space_ids.add(space_id)
    return space_ids


def _build_space_business_domain_code_bindings(
    domains: list[DomainConfig],
    sync_space_ids: set[int],
) -> list[dict[str, Any]]:
    codes_by_space_id: dict[int, list[str]] = {space_id: [] for space_id in sync_space_ids}
    for domain in domains:
        code = (domain.code or "").strip().upper()
        if not code:
            continue
        for raw_space_id in domain.space_ids:
            space_id = int(raw_space_id)
            if space_id not in codes_by_space_id:
                continue
            if code not in codes_by_space_id[space_id]:
                codes_by_space_id[space_id].append(code)
    return [
        {"space_id": space_id, "business_domain_codes": codes}
        for space_id, codes in sorted(codes_by_space_id.items())
    ]


async def _sync_space_business_domain_codes(
    bisheng_client: BishengClient,
    bindings: list[dict[str, Any]],
) -> None:
    if not bindings:
        return
    response = await bisheng_client.put_json(
        SYNC_SPACE_BUSINESS_DOMAIN_CODES_PATH,
        json={"bindings": bindings},
    )
    status_code = response.get("status_code")
    if status_code not in (None, 200):
        raise RuntimeError(str(response.get("status_message") or "BiSheng 空间业务域同步失败"))


@router.get("")
async def get_portal_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config())


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
    request: Request,
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
        store = _runtime_config_store(request, runtime_service)
        if store is not None:
            store.upsert_document(
                "bisheng_runtime_config",
                runtime_service.get_persistent_config().model_dump(mode="json"),
            )
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


@router.post("/migrate-sqlite")
async def migrate_sqlite_admin_config(request: Request, overwrite: bool = False):
    store = getattr(request.app.state, "portal_admin_config_store", None)
    if store is None or not hasattr(store, "migrate_from_sqlite"):
        return response_error("门户远程配置存储未初始化", status_code=500)

    try:
        result = store.migrate_from_sqlite(overwrite=overwrite)
    except Exception as err:
        logger.exception("portal sqlite config migration failed")
        return response_error(f"配置迁移失败：{err}", status_code=500)
    return response_ok(result)


@router.post("")
async def replace_portal_config(
    payload: PortalConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.replace_config(payload))


@router.get("/space-options")
async def get_space_options(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        bindable_spaces = await _load_domain_bindable_space_rows(service, bisheng_client)
    except Exception:
        return response_ok(service.build_space_options([]))
    return response_ok(service.build_space_options(bindable_spaces))


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
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    current_config = service.get_config()
    try:
        bindable_spaces = await _load_domain_bindable_space_rows(service, bisheng_client)
    except Exception as err:
        return response_error(
            normalize_user_facing_message(
                err,
                fallback="绑定空间同步失败，请检查 BiSheng 数据源后重试",
                status_code=502,
            ),
            status_code=502,
        )

    bindable_space_ids = {int(space["id"]) for space in bindable_spaces if space.get("id") is not None}
    requested_space_ids = _collect_domain_space_ids(payload.domains)
    invalid_space_ids = sorted(requested_space_ids - bindable_space_ids)
    if invalid_space_ids:
        return response_error(
            f"绑定空间必须是公共或部门知识空间：{', '.join(str(space_id) for space_id in invalid_space_ids)}",
            status_code=400,
        )

    old_space_ids = _collect_domain_space_ids(current_config.domains)
    sync_space_ids = old_space_ids | requested_space_ids
    new_bindings = _build_space_business_domain_code_bindings(payload.domains, sync_space_ids)
    old_bindings = _build_space_business_domain_code_bindings(current_config.domains, sync_space_ids)

    try:
        await _sync_space_business_domain_codes(bisheng_client, new_bindings)
    except Exception as err:
        return response_error(
            normalize_user_facing_message(
                err,
                fallback="BiSheng 知识空间业务域同步失败，业务域配置未保存",
                status_code=502,
            ),
            status_code=502,
        )

    try:
        updated = service.update_domains(payload)
    except Exception as err:
        logger.exception("portal domains save failed after BiSheng sync")
        try:
            await _sync_space_business_domain_codes(bisheng_client, old_bindings)
        except Exception:
            logger.exception("failed to restore BiSheng business domain codes after portal save failure")
        return response_error(f"业务域配置保存失败，已阻止保存：{err}", status_code=500)

    return response_ok({"domains": updated.domains})


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
    request: Request,
    payload: BishengRuntimeConfigUpdate,
    service: BishengRuntimeService = Depends(get_bisheng_runtime_service),
):
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
