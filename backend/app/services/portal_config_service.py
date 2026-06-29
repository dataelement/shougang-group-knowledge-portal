import json
from pathlib import Path
from typing import Any

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_config import (
    AgentConfig,
    AgentWorkflowOption,
    AgentWorkflowOptionsResponse,
    AppsConfigUpdate,
    BannersConfigUpdate,
    BusinessDomainOptionsConfigUpdate,
    DocumentTypesConfigUpdate,
    DomainsConfigUpdate,
    IntegrationsConfig,
    PortalConfig,
    DEFAULT_EXPERT_MODE_SYSTEM_PROMPT,
    DEFAULT_NORMAL_MODE_SYSTEM_PROMPT,
    DEFAULT_QUICK_MODE_SYSTEM_PROMPT,
    QAModelOption,
    QAModelOptionsResponse,
    QAConfig,
    RecommendationConfig,
    SearchConfig,
    SearchRerankModelOptionsResponse,
    SectionsConfigUpdate,
    SpaceFileItem,
    SpaceFilesResponse,
    SpaceFolderItem,
    SpaceFoldersResponse,
    SpaceOption,
    SpaceOptionsResponse,
    SpacesConfigUpdate,
    DisplayConfig,
    SiteConfig,
    SpaceConfig,
)
from app.services.config_store import SQLiteConfigStore


class PortalConfigService:
    _TABLE_NAME = "portal_config"
    _DOMAIN_COUNT_CACHE_TABLE = "domain_count_cache"
    _LEGACY_CONFIG_KEY = "portal_config"

    def __init__(self, config_path: Path, database_path: Path | None = None):
        self._config_path = config_path
        self._store = SQLiteConfigStore(database_path or config_path.parent / "portal.sqlite3")
        self._ensure_seeded()

    def get_config(self) -> PortalConfig:
        data = self._read_data()
        qa_model_changed = self._ensure_qa_model_compat(data)
        qa_templates_changed = self._ensure_qa_templates_compat(data)
        agent_config_changed = self._ensure_agent_config_compat(data)
        if qa_model_changed or qa_templates_changed or agent_config_changed:
            self._write_data(data)
        if "search" not in data or not isinstance(data.get("search"), dict):
            data["search"] = dict(DEFAULT_PORTAL_CONFIG.get("search") or {"rerank_model_id": ""})
            self._write_data(data)
        else:
            default_search = DEFAULT_PORTAL_CONFIG.get("search") or {"rerank_model_id": ""}
            missing_search_keys = [
                key for key in default_search
                if key not in data["search"]
            ]
            if missing_search_keys:
                data["search"] = {
                    **default_search,
                    **data["search"],
                }
                self._write_data(data)
        if not data.get("banners"):
            data["banners"] = list(DEFAULT_PORTAL_CONFIG.get("banners") or [])
            if data["banners"]:
                self._write_data(data)
        if "integrations" not in data:
            data["integrations"] = dict(
                DEFAULT_PORTAL_CONFIG.get("integrations") or {
                    "bisheng_admin_entry_url": "",
                    "bisheng_knowledge_entry_url": "",
                }
            )
            self._write_data(data)
        else:
            default_integrations = DEFAULT_PORTAL_CONFIG.get("integrations") or {}
            missing_integration_keys = [
                key for key in default_integrations
                if key not in data["integrations"]
            ]
            if missing_integration_keys:
                data["integrations"] = {
                    **default_integrations,
                    **data["integrations"],
                }
                self._write_data(data)
        if "site" not in data:
            data["site"] = dict(DEFAULT_PORTAL_CONFIG.get("site") or {})
            self._write_data(data)
        else:
            default_site = DEFAULT_PORTAL_CONFIG.get("site") or {}
            missing_site_keys = [
                key for key in default_site
                if key not in data["site"]
            ]
            if missing_site_keys:
                data["site"] = {
                    **default_site,
                    **data["site"],
                }
                self._write_data(data)
        return PortalConfig.model_validate(data)

    def with_live_space_data(
        self,
        config: PortalConfig,
        space_data: dict[int, dict[str, Any]],
    ) -> PortalConfig:
        updated_spaces = [
            SpaceConfig(
                **{
                    **space.model_dump(),
                    "name": str(space_data.get(space.id, {}).get("name") or space.name),
                    "file_count": int(space_data.get(space.id, {}).get("file_num") or space.file_count),
                    "space_level": str(space_data.get(space.id, {}).get("space_level") or space.space_level),
                }
            )
            for space in config.spaces
        ]
        return config.model_copy(update={"spaces": updated_spaces})

    def replace_config(self, payload: PortalConfig) -> PortalConfig:
        return self._write_config(payload)

    def update_spaces(self, payload: SpacesConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["spaces"] = payload.model_dump()["spaces"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_domains(self, payload: DomainsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["domains"] = payload.model_dump()["domains"]
        return self._write_config(PortalConfig.model_validate(data))

    def read_domain_count_cache(self) -> dict[str, Any]:
        return self._store.get_document(self._DOMAIN_COUNT_CACHE_TABLE) or {}

    def write_domain_count_cache(self, doc: dict[str, Any]) -> None:
        self._store.upsert_document(self._DOMAIN_COUNT_CACHE_TABLE, doc)

    def update_sections(self, payload: SectionsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["sections"] = payload.model_dump()["sections"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_document_types(self, payload: DocumentTypesConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["document_types"] = payload.model_dump()["document_types"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_business_domain_options(self, payload: BusinessDomainOptionsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["business_domain_options"] = payload.model_dump()["business_domain_options"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_qa(self, payload: QAConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        qa_data = payload.model_dump()
        if qa_data.get("general_model"):
            qa_data["selected_model"] = qa_data["general_model"]
        data["qa"] = qa_data
        return self._write_config(PortalConfig.model_validate(data))

    def update_search(self, payload: SearchConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["search"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def update_agent_config(self, payload: AgentConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["agent_config"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def build_qa_model_options(self, raw_models: list[dict[str, Any]]) -> QAModelOptionsResponse:
        qa_config = self.get_config().qa
        models: list[QAModelOption] = []
        seen_ids: set[str] = set()
        for server in raw_models:
            if not isinstance(server, dict):
                continue
            provider_name = str(server.get("name") or "")
            server_models = server.get("models")
            if not isinstance(server_models, list):
                continue
            for item in server_models:
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                if str(item.get("model_type") or "").lower() != "llm":
                    continue
                if item.get("online") is False:
                    continue
                model_id = str(item["id"])
                if model_id in seen_ids:
                    continue
                seen_ids.add(model_id)
                display_name = str(
                    item.get("displayName")
                    or item.get("display_name")
                    or item.get("name")
                    or item.get("model_name")
                    or model_id
                )
                models.append(
                    QAModelOption(
                        key=str(item.get("key") or model_id),
                        id=model_id,
                        name=str(item.get("model_name") or item.get("name") or ""),
                        display_name=display_name,
                        visual=bool(item.get("visual") or False),
                        provider_name=provider_name,
                        status=int(item.get("status") or 0),
                    )
                )
        return QAModelOptionsResponse(
            selected_model=qa_config.selected_model,
            general_model=qa_config.general_model,
            reasoning_model=qa_config.reasoning_model,
            models=models,
        )

    def build_search_rerank_model_options(self, raw_models: list[dict[str, Any]]) -> SearchRerankModelOptionsResponse:
        search_config = self.get_config().search
        models: list[QAModelOption] = []
        seen_ids: set[str] = set()
        for server in raw_models:
            if not isinstance(server, dict):
                continue
            provider_name = str(server.get("name") or "")
            server_models = server.get("models")
            if not isinstance(server_models, list):
                continue
            for item in server_models:
                if not isinstance(item, dict) or item.get("id") is None:
                    continue
                if str(item.get("model_type") or "").lower() != "rerank":
                    continue
                if item.get("online") is False:
                    continue
                model_id = str(item["id"])
                if model_id in seen_ids:
                    continue
                seen_ids.add(model_id)
                display_name = str(
                    item.get("displayName")
                    or item.get("display_name")
                    or item.get("name")
                    or item.get("model_name")
                    or model_id
                )
                models.append(
                    QAModelOption(
                        key=str(item.get("key") or model_id),
                        id=model_id,
                        name=str(item.get("model_name") or item.get("name") or ""),
                        display_name=display_name,
                        visual=bool(item.get("visual") or False),
                        provider_name=provider_name,
                        status=int(item.get("status") or 0),
                    )
                )
        return SearchRerankModelOptionsResponse(
            rerank_model_id=search_config.rerank_model_id,
            models=models,
        )

    @staticmethod
    def build_agent_workflow_options(raw_payload: Any) -> AgentWorkflowOptionsResponse:
        data = raw_payload.get("data") if isinstance(raw_payload, dict) else raw_payload
        raw_workflows = data.get("data") if isinstance(data, dict) else data
        if not isinstance(raw_workflows, list):
            raw_workflows = []
        workflows: list[AgentWorkflowOption] = []
        seen_ids: set[str] = set()
        for item in raw_workflows:
            if not isinstance(item, dict):
                continue
            workflow_id = str(item.get("id") or item.get("workflow_id") or "").strip()
            name = str(item.get("name") or item.get("flow_name") or item.get("title") or "").strip()
            if not workflow_id or not name or workflow_id in seen_ids:
                continue
            seen_ids.add(workflow_id)
            workflows.append(
                AgentWorkflowOption(
                    workflow_id=workflow_id,
                    name=name,
                    desc=str(item.get("description") or item.get("desc") or ""),
                    flow_type=int(item.get("flow_type") or 10),
                    status=int(item.get("status") or 2),
                )
            )
        return AgentWorkflowOptionsResponse(
            workflows=workflows,
            has_more=bool(data.get("has_more")) if isinstance(data, dict) else False,
            next_cursor=str(data.get("next_cursor") or data.get("cursor") or "") if isinstance(data, dict) else "",
        )

    @staticmethod
    def _ensure_qa_model_compat(data: dict[str, Any]) -> bool:
        qa_data = data.get("qa")
        if not isinstance(qa_data, dict):
            return False
        changed = False
        selected_model = str(qa_data.get("selected_model") or "")
        if "general_model" not in qa_data:
            qa_data["general_model"] = selected_model
            changed = True
        if "reasoning_model" not in qa_data:
            qa_data["reasoning_model"] = ""
            changed = True
        if "selected_model" not in qa_data:
            qa_data["selected_model"] = str(qa_data.get("general_model") or "")
            changed = True
        if not qa_data.get("general_model") and selected_model:
            qa_data["general_model"] = selected_model
            changed = True
        prompt_defaults = {
            "quick_mode_system_prompt": DEFAULT_QUICK_MODE_SYSTEM_PROMPT,
            "normal_mode_system_prompt": DEFAULT_NORMAL_MODE_SYSTEM_PROMPT,
            "expert_mode_system_prompt": DEFAULT_EXPERT_MODE_SYSTEM_PROMPT,
        }
        for key, default_value in prompt_defaults.items():
            if key not in qa_data:
                qa_data[key] = default_value
                changed = True
        return changed

    @staticmethod
    def _ensure_qa_templates_compat(data: dict[str, Any]) -> bool:
        qa_data = data.get("qa")
        if not isinstance(qa_data, dict):
            return False
        default_qa = DEFAULT_PORTAL_CONFIG.get("qa") or {}
        changed = False
        if "template_categories" not in qa_data or not isinstance(qa_data.get("template_categories"), list):
            qa_data["template_categories"] = list(default_qa.get("template_categories") or [])
            changed = True
        if "templates" not in qa_data or not isinstance(qa_data.get("templates"), list):
            qa_data["templates"] = list(default_qa.get("templates") or [])
            changed = True
        return changed

    @staticmethod
    def _ensure_agent_config_compat(data: dict[str, Any]) -> bool:
        default_agent_config = DEFAULT_PORTAL_CONFIG.get("agent_config") or {"categories": [], "agents": []}
        agent_config = data.get("agent_config")
        if not isinstance(agent_config, dict):
            data["agent_config"] = dict(default_agent_config)
            return True
        changed = False
        for key in ("categories", "agents"):
            if key not in agent_config or not isinstance(agent_config.get(key), list):
                agent_config[key] = list(default_agent_config.get(key) or [])
                changed = True
        return changed

    @staticmethod
    def build_space_options(raw_spaces: list[dict[str, Any]]) -> SpaceOptionsResponse:
        options = [
            SpaceOption(
                id=int(item["id"]),
                name=str(item.get("name") or ""),
                description=str(item.get("description") or ""),
                file_count=int(item.get("file_num") or 0),
                space_level=str(item.get("space_level") or "personal"),
            )
            for item in raw_spaces
            if item.get("id") is not None and item.get("name")
        ]
        return SpaceOptionsResponse(options=options)

    @staticmethod
    def build_space_files(space_id: int, raw_files: list[dict[str, Any]]) -> SpaceFilesResponse:
        files = [
            SpaceFileItem(
                id=int(item["id"]),
                name=str(item.get("file_name") or item.get("title") or ""),
            )
            for item in raw_files
            if item.get("id") is not None and (item.get("file_name") or item.get("title"))
        ]
        return SpaceFilesResponse(space_id=space_id, files=files)

    @staticmethod
    def build_space_folders(space_id: int, raw_items: list[dict[str, Any]]) -> SpaceFoldersResponse:
        folder_rows = [
            item
            for item in raw_items
            if item.get("id") is not None and int(item.get("file_type") or -1) == 0
        ]
        folder_name_by_id = {
            int(item["id"]): str(item.get("file_name") or item.get("title") or item.get("name") or item["id"])
            for item in folder_rows
        }

        def build_path(item: dict[str, Any]) -> str:
            raw_path = str(item.get("file_level_path") or "").strip("/")
            names = []
            for part in raw_path.split("/"):
                if not part:
                    continue
                try:
                    folder_id = int(part)
                except ValueError:
                    continue
                names.append(folder_name_by_id.get(folder_id, str(folder_id)))
            current_name = str(item.get("file_name") or item.get("title") or item.get("name") or "")
            if current_name:
                names.append(current_name)
            return " / ".join(names)

        folders = [
            SpaceFolderItem(
                id=int(item["id"]),
                name=str(item.get("file_name") or item.get("title") or item.get("name") or ""),
                path=build_path(item),
            )
            for item in folder_rows
        ]
        return SpaceFoldersResponse(space_id=space_id, folders=folders)

    def update_recommendation(self, payload: RecommendationConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["recommendation"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def update_display(self, payload: DisplayConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["display"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def update_apps(self, payload: AppsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["apps"] = payload.model_dump()["apps"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_banners(self, payload: BannersConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["banners"] = payload.model_dump()["banners"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_integrations(self, payload: IntegrationsConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["integrations"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def update_site(self, payload: SiteConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["site"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def _ensure_seeded(self) -> None:
        if self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY) is not None:
            return
        if self._config_path.exists():
            self._store.upsert_document(self._TABLE_NAME, self._read_legacy_json())
            return
        self._store.upsert_document(self._TABLE_NAME, DEFAULT_PORTAL_CONFIG)

    def _read_data(self) -> dict[str, Any]:
        data = self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY)
        if data is not None:
            return data
        self._ensure_seeded()
        data = self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY)
        if data is None:
            raise RuntimeError("Portal config is not initialized")
        return data

    def _read_legacy_json(self) -> dict[str, Any]:
        with self._config_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _write_config(self, payload: PortalConfig) -> PortalConfig:
        data = payload.model_dump(mode="json")
        self._write_data(data)
        return PortalConfig.model_validate(data)

    def _write_data(self, data: dict[str, Any]) -> None:
        self._store.upsert_document(self._TABLE_NAME, data)
