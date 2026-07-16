import logging
from typing import Any, Final

from fastapi import APIRouter, Depends, HTTPException, Request
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
from app.schemas.common import response_error, response_ok
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfigUpdate
from app.schemas.portal_config import (
    AgentConfig,
    AppsConfigUpdate,
    BannersConfigUpdate,
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
from app.services.portal_admin_config_store import PortalAdminConfigValidationError
from app.services.bisheng_runtime_service import BishengRuntimeService
from app.services.error_messages import normalize_user_facing_message
from app.services.portal_config_service import PortalConfigService
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/admin/config",
    tags=["admin-config"],
    dependencies=[Depends(require_admin_session)],
)

DOMAIN_BINDABLE_SPACE_LEVELS: Final[set[str]] = {"public", "department"}
SYNC_SPACE_BUSINESS_DOMAIN_CODES_PATH: Final[str] = (
    "/api/v1/knowledge/shougang-portal/spaces/business-domain-codes"
)
DOMAIN_BINDABLE_SPACES_PATH: Final[str] = (
    "/api/v1/knowledge/shougang-portal/spaces/domain-bindable"
)


def _runtime_config_store(request: Request, runtime_service: BishengRuntimeService):
    store = getattr(request.app.state, "portal_admin_config_store", None)
    if store is None or getattr(store, "runtime_service", None) is not runtime_service:
        return None
    return store


async def _load_domain_bindable_space_rows(
    bisheng_client: BishengClient,
) -> list[dict[str, Any]]:
    response = await bisheng_client.get_json(DOMAIN_BINDABLE_SPACES_PATH)
    status_code = response.get("status_code")
    if status_code not in (None, 200):
        raise RuntimeError(str(response.get("status_message") or "业务域候选空间查询失败"))
    data = response.get("data") or {}
    raw_spaces = data.get("spaces") if isinstance(data, dict) else []
    if not isinstance(raw_spaces, list):
        return []
    return [
        space
        for space in raw_spaces
        if isinstance(space, dict)
        and (str(space.get("space_level") or "").strip().lower() in DOMAIN_BINDABLE_SPACE_LEVELS)
    ]


def _collect_domain_space_ids(domains: list[DomainConfig]) -> set[int]:
    space_ids: set[int] = set()
    for domain in domains:
        for raw_space_id in domain.space_ids:
            space_id = int(raw_space_id)
            if space_id > 0:
                space_ids.add(space_id)
    return space_ids


def _sanitize_domain_space_ids(
    domains: list[DomainConfig],
    bindable_space_ids: set[int],
) -> tuple[list[DomainConfig], set[int]]:
    sanitized_domains: list[DomainConfig] = []
    removed_space_ids: set[int] = set()
    for domain in domains:
        valid_space_ids: list[int] = []
        for raw_space_id in domain.space_ids:
            space_id = int(raw_space_id)
            if space_id > 0 and space_id in bindable_space_ids:
                valid_space_ids.append(space_id)
            else:
                removed_space_ids.add(space_id)
        sanitized_domains.append(domain.model_copy(update={"space_ids": valid_space_ids}))
    return sanitized_domains, removed_space_ids


def _collect_bound_domain_names(domains: list[DomainConfig]) -> set[str]:
    return {
        domain.name
        for domain in domains
        if _collect_domain_space_ids([domain])
    }


def _build_space_business_domain_code_bindings(
    domains: list[DomainConfig],
    sync_space_ids: set[int],
) -> list[dict[str, Any]]:
    codes_by_space_id: dict[int, list[str]] = {space_id: [] for space_id in sync_space_ids}
    for domain in domains:
        if not domain.enabled:
            continue
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
        bindable_spaces = await _load_domain_bindable_space_rows(bisheng_client)
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
        bindable_spaces = await _load_domain_bindable_space_rows(bisheng_client)
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
    sanitized_previous_domains, removed_previous_space_ids = _sanitize_domain_space_ids(
        current_config.domains,
        bindable_space_ids,
    )
    sanitized_requested_domains, removed_requested_space_ids = _sanitize_domain_space_ids(
        payload.domains,
        bindable_space_ids,
    )
    removed_space_ids = removed_previous_space_ids | removed_requested_space_ids
    if removed_space_ids:
        logger.warning(
            "stripping %d invalid/deleted knowledge space IDs from domain config before sync: %s",
            len(removed_space_ids),
            sorted(removed_space_ids),
        )

    sanitized_payload = DomainsConfigUpdate(domains=sanitized_requested_domains)
    removed_bound_domain_names = sorted(
        _collect_bound_domain_names(sanitized_previous_domains)
        - {domain.name for domain in sanitized_requested_domains}
    )
    if removed_bound_domain_names:
        return response_error(
            "业务域已绑定有效知识空间，请先解除绑定后再删除或修改名称："
            + "、".join(removed_bound_domain_names),
            status_code=409,
        )

    old_space_ids = _collect_domain_space_ids(sanitized_previous_domains)
    requested_space_ids = _collect_domain_space_ids(sanitized_requested_domains)
    sync_space_ids = old_space_ids | requested_space_ids
    new_bindings = _build_space_business_domain_code_bindings(sanitized_requested_domains, sync_space_ids)
    old_bindings = _build_space_business_domain_code_bindings(sanitized_previous_domains, sync_space_ids)

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
        updated = service.update_domains(sanitized_payload)
    except Exception as err:
        logger.exception("portal domains save failed after BiSheng sync")
        try:
            await _sync_space_business_domain_codes(bisheng_client, old_bindings)
        except Exception:
            logger.exception("failed to restore BiSheng business domain codes after portal save failure")
        return response_error(
            "门户业务域配置保存失败，已尝试恢复 BiSheng 业务域编码，请检查日志并重试",
            status_code=500,
        )

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


@router.get("/qa")
async def get_qa_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok(service.get_config().qa)


@router.post("/qa")
async def update_qa_config(
    payload: QAConfig,
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        response = await bisheng_client.get_json("/api/v1/llm")
    except Exception as err:
        logger.exception("failed to fetch qa model status while updating portal config")
        raise HTTPException(status_code=503, detail="问答模型状态暂不可确认，请稍后重试") from err
    raw_models = response.get("data") if isinstance(response, dict) else []
    if not isinstance(raw_models, list):
        raw_models = []
    try:
        service.ensure_qa_models_enabled(payload, raw_models)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
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
    try:
        config = service.update_recommendation(payload)
    except (ValidationError, PortalAdminConfigValidationError):
        return response_error(
            "推荐配置校验失败，请检查推荐总数与首页展示数量范围",
            status_code=422,
        )
    return response_ok({
        "recommendation": config.recommendation,
        "version": service.get_config_version(),
    })


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
    try:
        return response_ok(service.update_display(payload).display)
    except (ValidationError, PortalAdminConfigValidationError):
        return response_error(
            "展示配置校验失败，首页展示数量不能大于推荐总数",
            status_code=422,
        )


@router.get("/apps")
async def get_apps_config(
    service: PortalConfigService = Depends(get_portal_config_service),
):
    return response_ok({"apps": service.get_legacy_apps()})


@router.post("/apps")
async def update_apps_config(
    payload: AppsConfigUpdate,
    service: PortalConfigService = Depends(get_portal_config_service),
):
    service.update_apps(payload)
    return response_ok({"apps": service.get_legacy_apps()})


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


_DEPT_BINDING_BASE = "/api/v1/knowledge/space/department-binding"


@router.get("/dept-knowledge-binding/bindings")
async def get_dept_bindings(bisheng_client: BishengClient = Depends(get_bisheng_client)):
    try:
        resp = await bisheng_client.get_json(f"{_DEPT_BINDING_BASE}/bindings")
    except Exception as err:
        return response_error(
            normalize_user_facing_message(err, fallback="获取科室库绑定失败", status_code=502),
            status_code=502,
        )
    if resp.get("status_code") not in (None, 200):
        return response_error(
            normalize_user_facing_message(
                resp.get("status_message"), fallback="获取科室库绑定失败", status_code=502
            ),
            status_code=502,
        )
    return response_ok(resp.get("data") or [])


@router.get("/dept-knowledge-binding/bindable-spaces")
async def get_dept_bindable_spaces(
    keyword: str | None = None,
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        resp = await bisheng_client.get_json(
            f"{_DEPT_BINDING_BASE}/bindable-spaces",
            params={"keyword": keyword} if keyword else None,
        )
    except Exception as err:
        return response_error(
            normalize_user_facing_message(err, fallback="获取可绑定知识库失败", status_code=502),
            status_code=502,
        )
    if resp.get("status_code") not in (None, 200):
        return response_error(
            normalize_user_facing_message(
                resp.get("status_message"), fallback="获取可绑定知识库失败", status_code=502
            ),
            status_code=502,
        )
    return response_ok(resp.get("data") or [])


@router.get("/dept-knowledge-binding/departments")
async def get_dept_departments(bisheng_client: BishengClient = Depends(get_bisheng_client)):
    try:
        resp = await bisheng_client.get_json(f"{_DEPT_BINDING_BASE}/departments")
    except Exception as err:
        return response_error(
            normalize_user_facing_message(err, fallback="获取部门列表失败", status_code=502),
            status_code=502,
        )
    if resp.get("status_code") not in (None, 200):
        return response_error(
            normalize_user_facing_message(
                resp.get("status_message"), fallback="获取部门列表失败", status_code=502
            ),
            status_code=502,
        )
    return response_ok(resp.get("data") or [])


@router.post("/dept-knowledge-binding")
async def bind_dept_space(
    body: dict,
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        resp = await bisheng_client.post_json(
            _DEPT_BINDING_BASE,
            json={"space_id": body.get("space_id"), "department_id": body.get("department_id")},
        )
    except Exception as err:
        return response_error(
            normalize_user_facing_message(err, fallback="绑定失败", status_code=502),
            status_code=502,
        )
    if resp.get("status_code") not in (None, 200):
        return response_error(
            normalize_user_facing_message(resp.get("status_message"), fallback="绑定失败", status_code=502),
            status_code=502,
        )
    return response_ok(resp.get("data") or {})


@router.delete("/dept-knowledge-binding/{space_id}")
async def unbind_dept_space(
    space_id: int,
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    try:
        resp = await bisheng_client.delete_json(f"{_DEPT_BINDING_BASE}/{space_id}")
    except Exception as err:
        return response_error(
            normalize_user_facing_message(err, fallback="解绑失败", status_code=502),
            status_code=502,
        )
    if resp.get("status_code") not in (None, 200):
        return response_error(
            normalize_user_facing_message(resp.get("status_message"), fallback="解绑失败", status_code=502),
            status_code=502,
        )
    return response_ok(resp.get("data") or {})
