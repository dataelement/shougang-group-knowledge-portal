import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_config import (
    AgentConfig,
    AppConfig,
    AgentWorkflowOption,
    AgentWorkflowOptionsResponse,
    AppsConfigUpdate,
    BannersConfigUpdate,
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
    DisplayConfig,
    SiteConfig,
)
from app.services.config_store import InMemoryConfigStore


TYPICAL_CASE_SECTION_KEY = "typical_case"
TYPICAL_CASE_SECTION_TAG = "行业情报"
TYPICAL_CASE_SECTION_LINK = "/list?tag=行业情报"
BUILTIN_SECTION_KEYS = ("latest_selected", TYPICAL_CASE_SECTION_KEY)
LATEST_SELECTED_SECTION_LINK = "/list?recommendation=latest_selected"


class PortalConfigService:
    _TABLE_NAME = "portal_config"
    _DOMAIN_COUNT_CACHE_TABLE = "domain_count_cache"
    _LEGACY_CONFIG_KEY = "portal_config"
    QA_MODEL_DISABLED_MESSAGE = "当前问答模型已停用，请联系管理员"
    QA_MODEL_UNAVAILABLE_MESSAGE = "当前问答模型不可用，请联系管理员"

    def __init__(self, config_path: Path, store: Any | None = None):
        self._config_path = config_path
        self._store = store or InMemoryConfigStore()
        if not getattr(self._store, "skip_startup_seed", False):
            self._ensure_seeded()

    def get_config(self) -> PortalConfig:
        data = self._read_data()
        legacy_missing_home_total = not isinstance(data.get("recommendation"), dict) or (
            "home_total_count" not in data["recommendation"]
        )
        qa_model_changed = self._ensure_qa_model_compat(data)
        qa_templates_changed = self._ensure_qa_templates_compat(data)
        agent_config_changed = self._ensure_agent_config_compat(data)
        sections_changed = self._ensure_sections_compat(data)
        if qa_model_changed or qa_templates_changed or agent_config_changed or sections_changed:
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
        # 注意:banners 为空时不再自动补回默认。管理员全删/全停用后,后台如实显示为空;
        # 首页的兜底(空时展示第一张默认图)在公开配置接口 /knowledge/config 里做。
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
        if "recommendation" not in data:
            data["recommendation"] = dict(DEFAULT_PORTAL_CONFIG.get("recommendation") or {})
            self._write_data(data)
        else:
            default_recommendation = DEFAULT_PORTAL_CONFIG.get("recommendation") or {}
            missing_recommendation_keys = [
                key for key in default_recommendation
                if key not in data["recommendation"]
            ]
            if missing_recommendation_keys:
                data["recommendation"] = {
                    **default_recommendation,
                    **data["recommendation"],
                }
                self._write_data(data)
        if "display" not in data:
            data["display"] = dict(DEFAULT_PORTAL_CONFIG.get("display") or {})
            self._write_data(data)
        else:
            default_display = DEFAULT_PORTAL_CONFIG.get("display") or {}
            missing_display_keys = [
                key for key in default_display
                if key not in data["display"]
            ]
            if missing_display_keys:
                data["display"] = {
                    **default_display,
                    **data["display"],
                }
                self._write_data(data)
        if legacy_missing_home_total:
            raw_home = data.get("display", {}).get("home", {})
            try:
                legacy_section_page_size = int(raw_home.get("section_page_size") or 0)
            except (TypeError, ValueError):
                legacy_section_page_size = 0
            if 1 <= legacy_section_page_size <= 50:
                data["recommendation"]["home_total_count"] = max(
                    int(data["recommendation"].get("home_total_count") or 20),
                    legacy_section_page_size,
                )
                self._write_data(data)
        config = PortalConfig.model_validate(data)
        normalized_data = config.model_dump(mode="json")
        if normalized_data != data:
            self._write_data(normalized_data)
        return config

    def replace_config(self, payload: PortalConfig) -> PortalConfig:
        data = payload.model_dump(mode="json")
        self._ensure_sections_compat(data)
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
        data["sections"] = self._normalize_sections_update(
            current_sections=data.get("sections") or [],
            next_sections=payload.model_dump()["sections"],
        )
        return self._write_config(PortalConfig.model_validate(data))

    def update_document_types(self, payload: DocumentTypesConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["document_types"] = payload.model_dump()["document_types"]
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
                if not self._is_model_online(item):
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
                        remark=str(item.get("remark") or ""),
                    )
                )
        qa_config = self._refresh_qa_model_display_names(qa_config, models)
        return QAModelOptionsResponse(
            selected_model=qa_config.selected_model,
            general_model=qa_config.general_model,
            reasoning_model=qa_config.reasoning_model,
            general_model_display_name=qa_config.general_model_display_name,
            reasoning_model_display_name=qa_config.reasoning_model_display_name,
            models=models,
        )

    def ensure_qa_models_enabled(self, payload: QAConfig, raw_models: list[dict[str, Any]]) -> None:
        model_ids = {
            (payload.general_model or payload.selected_model).strip(),
            payload.reasoning_model.strip(),
        }
        for model_id in model_ids:
            if model_id:
                self.ensure_qa_model_enabled(model_id, raw_models)

    def ensure_qa_model_enabled(self, model_id: str, raw_models: list[dict[str, Any]]) -> None:
        normalized_model_id = str(model_id or "").strip()
        for server in raw_models:
            if not isinstance(server, dict):
                continue
            server_models = server.get("models")
            if not isinstance(server_models, list):
                continue
            for item in server_models:
                if not isinstance(item, dict) or str(item.get("id") or "").strip() != normalized_model_id:
                    continue
                if str(item.get("model_type") or "").lower() != "llm":
                    raise ValueError(self.QA_MODEL_UNAVAILABLE_MESSAGE)
                if not self._is_model_online(item):
                    raise ValueError(self.QA_MODEL_DISABLED_MESSAGE)
                return
        raise ValueError(self.QA_MODEL_UNAVAILABLE_MESSAGE)

    @staticmethod
    def _is_model_online(item: dict[str, Any]) -> bool:
        online = item.get("online", True)
        if isinstance(online, str):
            return online.strip().lower() not in {"0", "false", "offline", "disabled", "no"}
        return bool(online)

    def _refresh_qa_model_display_names(self, qa_config: QAConfig, models: list[QAModelOption]) -> QAConfig:
        if not models:
            return qa_config
        option_by_id = {model.id: model for model in models}
        updates: dict[str, str] = {}

        general_model = (qa_config.general_model or qa_config.selected_model).strip()
        if general_model in option_by_id:
            display_name = self._qa_model_display_name(option_by_id[general_model])
            if display_name and display_name != qa_config.general_model_display_name:
                updates["general_model_display_name"] = display_name

        reasoning_model = qa_config.reasoning_model.strip()
        if reasoning_model in option_by_id:
            display_name = self._qa_model_display_name(option_by_id[reasoning_model])
            if display_name and display_name != qa_config.reasoning_model_display_name:
                updates["reasoning_model_display_name"] = display_name

        if not updates:
            return qa_config
        return self.update_qa(qa_config.model_copy(update=updates)).qa

    @staticmethod
    def _qa_model_display_name(model: QAModelOption) -> str:
        return model.name or model.display_name or ""

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
                        remark=str(item.get("remark") or ""),
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
        if "general_model_display_name" not in qa_data:
            qa_data["general_model_display_name"] = ""
            changed = True
        if "reasoning_model_display_name" not in qa_data:
            qa_data["reasoning_model_display_name"] = ""
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
        default_agent_config = DEFAULT_PORTAL_CONFIG.get("agent_config") or {"categories": [], "applications": []}
        agent_config = data.get("agent_config")
        if not isinstance(agent_config, dict):
            data["agent_config"] = dict(default_agent_config)
            return True
        changed = False
        if "categories" not in agent_config or not isinstance(agent_config.get("categories"), list):
            agent_config["categories"] = list(default_agent_config.get("categories") or [])
            changed = True
        if "applications" not in agent_config or not isinstance(agent_config.get("applications"), list):
            legacy_agents = agent_config.get("agents")
            agent_config["applications"] = list(legacy_agents) if isinstance(legacy_agents, list) else []
            changed = True
        if "agents" in agent_config:
            agent_config.pop("agents", None)
            changed = True
        return changed

    @staticmethod
    def _ensure_sections_compat(data: dict[str, Any]) -> bool:
        sections = data.get("sections")
        if not isinstance(sections, list):
            data["sections"] = deepcopy(DEFAULT_PORTAL_CONFIG.get("sections") or [])
            return True
        normalized = PortalConfigService._normalize_sections_update(
            current_sections=sections,
            next_sections=sections,
        )
        if normalized == sections:
            return False
        data["sections"] = normalized
        return True

    @staticmethod
    def _normalize_sections_update(
        *,
        current_sections: list[dict[str, Any]],
        next_sections: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        current = [
            dict(section)
            for section in current_sections
            if isinstance(section, dict)
        ]
        result = [
            dict(section)
            for section in next_sections
            if isinstance(section, dict)
        ]
        defaults = [
            dict(section)
            for section in (DEFAULT_PORTAL_CONFIG.get("sections") or [])
            if isinstance(section, dict)
        ]
        result_has_builtin_key = any(
            str(section.get("builtin_key") or "") in BUILTIN_SECTION_KEYS
            for section in result
        )

        # 旧配置没有内置标识时，按现有前两个分区绑定系统身份；标题保留，内置查询语义在下方统一。
        for index, builtin_key in enumerate(BUILTIN_SECTION_KEYS):
            if any(str(section.get("builtin_key") or "") == builtin_key for section in result):
                continue
            replacement = PortalConfigService._find_section_by_builtin_key(current, builtin_key)
            if not result_has_builtin_key and index < len(result):
                result[index]["builtin_key"] = builtin_key
                continue
            if replacement is None and index < len(defaults):
                replacement = dict(defaults[index])
            if replacement is not None:
                replacement["builtin_key"] = builtin_key
                result.insert(min(index, len(result)), replacement)

        normalized: list[dict[str, Any]] = []
        seen_builtin_keys: set[str] = set()
        for section in result:
            builtin_key = str(section.get("builtin_key") or "")
            if builtin_key in BUILTIN_SECTION_KEYS:
                if builtin_key in seen_builtin_keys:
                    continue
                seen_builtin_keys.add(builtin_key)
                if builtin_key == "latest_selected":
                    section["link"] = LATEST_SELECTED_SECTION_LINK
                elif builtin_key == TYPICAL_CASE_SECTION_KEY:
                    section["tag"] = TYPICAL_CASE_SECTION_TAG
                    section["link"] = TYPICAL_CASE_SECTION_LINK
            normalized.append(section)
        return normalized

    @staticmethod
    def _find_section_by_builtin_key(sections: list[dict[str, Any]], builtin_key: str) -> dict[str, Any] | None:
        for section in sections:
            if str(section.get("builtin_key") or "") == builtin_key:
                return dict(section)
        return None

    @staticmethod
    def build_space_options(raw_spaces: list[dict[str, Any]]) -> SpaceOptionsResponse:
        options = [
            SpaceOption(
                id=int(item["id"]),
                name=str(item.get("name") or ""),
                description=str(item.get("description") or ""),
                file_count=int(item.get("file_count") or item.get("file_num") or 0),
                space_level=str(item.get("space_level") or "personal"),
                business_domain_codes=[
                    str(code).strip().upper()
                    for code in (item.get("business_domain_codes") or item.get("businessDomainCodes") or [])
                    if str(code).strip()
                ],
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

    def get_config_version(self) -> int:
        raw_version = getattr(self._store, "version", None)
        return raw_version if isinstance(raw_version, int) and raw_version > 0 else 1

    def update_display(self, payload: DisplayConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["display"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def update_apps(self, payload: AppsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        agent_config = dict(data.get("agent_config") or {})
        applications = agent_config.get("applications")
        agent_config["applications"] = [
            application
            for application in applications
            if isinstance(application, dict) and application.get("type") != "url"
        ] if isinstance(applications, list) else []
        data["agent_config"] = agent_config
        data["apps"] = payload.model_dump()["apps"]
        return self._write_config(PortalConfig.model_validate(data))

    def get_legacy_apps(self) -> list[AppConfig]:
        result: list[AppConfig] = []
        for index, application in enumerate(self.get_config().agent_config.applications, start=1):
            if application.type != "url":
                continue
            raw_suffix = application.id.removeprefix("url-app-")
            legacy_id = int(raw_suffix) if raw_suffix.isdigit() else index
            result.append(AppConfig(
                id=legacy_id,
                name=application.name,
                icon=application.icon,
                desc=application.desc,
                color=application.color,
                bg=application.bg,
                url=application.url,
                enabled=application.enabled,
            ))
        return result

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
        self._store.upsert_document(self._TABLE_NAME, deepcopy(DEFAULT_PORTAL_CONFIG))

    def _read_data(self) -> dict[str, Any]:
        data = self._store.get_document(self._TABLE_NAME, legacy_key=self._LEGACY_CONFIG_KEY)
        if data is not None:
            return data
        if getattr(self._store, "skip_startup_seed", False):
            return deepcopy(DEFAULT_PORTAL_CONFIG)
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
        result = self._write_data(data)
        normalized = getattr(result, "document", data)
        return PortalConfig.model_validate(normalized)

    def _write_data(self, data: dict[str, Any]) -> Any:
        return self._store.upsert_document(self._TABLE_NAME, data)
