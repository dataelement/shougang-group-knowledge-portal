import asyncio

from fastapi import APIRouter, Depends

from app.api.dependencies import get_bisheng_client, get_bisheng_runtime_service, get_portal_config_service
from app.clients.bisheng import BishengClient
from app.schemas.bisheng_runtime import BishengRuntimeConfigUpdate
from app.schemas.common import response_error, response_ok
from app.schemas.portal_config import (
    AppsConfigUpdate,
    BannersConfigUpdate,
    DomainsConfigUpdate,
    IntegrationsConfig,
    PortalConfig,
    QAConfig,
    RecommendationConfig,
    SectionsConfigUpdate,
    SiteConfig,
    SpacesConfigUpdate,
    DisplayConfig,
)
from app.services.portal_config_service import PortalConfigService
from app.services.bisheng_runtime_service import BishengRuntimeService

router = APIRouter(prefix="/api/v1/admin/config", tags=["admin-config"])


@router.get("")
async def get_portal_config(
    service: PortalConfigService = Depends(get_portal_config_service),
    bisheng_client: BishengClient = Depends(get_bisheng_client),
):
    config = service.get_config()

    async def fetch_space_info(space_id: int):
        try:
            response = await bisheng_client.get_json(f"/api/v1/knowledge/space/{space_id}/info")
        except Exception:
            return space_id, {}
        data = response.get("data") or {}
        return space_id, data if isinstance(data, dict) else {}

    results = await asyncio.gather(*(fetch_space_info(space.id) for space in config.spaces))
    live_space_data = {space_id: data for space_id, data in results}
    live_config = service.with_live_space_data(config, live_space_data)
    return response_ok(live_config)


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

    async def enrich_space(item: dict):
        space_id = item.get("id")
        if space_id is None:
            return item
        try:
            info_response = await bisheng_client.get_json(f"/api/v1/knowledge/space/{space_id}/info")
        except Exception:
            return item
        info = info_response.get("data") or {}
        if not isinstance(info, dict):
            return item
        return {
            **item,
            "name": info.get("name") or item.get("name"),
            "description": info.get("description") or item.get("description"),
            "file_num": info.get("file_num") or item.get("file_num") or 0,
        }

    enriched_spaces = await asyncio.gather(*(enrich_space(item) for item in raw_spaces))
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
        response = await bisheng_client.get_json("/api/v1/workstation/config/daily")
    except Exception:
        return response_ok(service.build_qa_model_options([]))
    data = response.get("data") or {}
    raw_models = data.get("models") if isinstance(data, dict) else []
    if not isinstance(raw_models, list):
        raw_models = []
    return response_ok(service.build_qa_model_options(raw_models))


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
        return response_error(str(err), status_code=400)
    return response_ok(config)
