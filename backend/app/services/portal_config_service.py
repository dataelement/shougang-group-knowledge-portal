import json
from pathlib import Path
from typing import Any

from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.schemas.portal_config import (
    AppsConfigUpdate,
    BannersConfigUpdate,
    DomainsConfigUpdate,
    IntegrationsConfig,
    PortalConfig,
    QAModelOption,
    QAModelOptionsResponse,
    QAConfig,
    RecommendationConfig,
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
    _LEGACY_CONFIG_KEY = "portal_config"

    def __init__(self, config_path: Path, database_path: Path | None = None):
        self._config_path = config_path
        self._store = SQLiteConfigStore(database_path or config_path.parent / "portal.sqlite3")
        self._ensure_seeded()

    def get_config(self) -> PortalConfig:
        data = self._read_data()
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

    def update_sections(self, payload: SectionsConfigUpdate) -> PortalConfig:
        data = self.get_config().model_dump()
        data["sections"] = payload.model_dump()["sections"]
        return self._write_config(PortalConfig.model_validate(data))

    def update_qa(self, payload: QAConfig) -> PortalConfig:
        data = self.get_config().model_dump()
        data["qa"] = payload.model_dump()
        return self._write_config(PortalConfig.model_validate(data))

    def build_qa_model_options(self, raw_models: list[dict[str, Any]]) -> QAModelOptionsResponse:
        qa_config = self.get_config().qa
        models = [
            QAModelOption(
                key=str(item.get("key") or ""),
                id=str(item.get("id") or ""),
                name=str(item.get("name") or ""),
                display_name=str(item.get("displayName") or ""),
                visual=bool(item.get("visual") or False),
            )
            for item in raw_models
            if item.get("id") is not None
        ]
        return QAModelOptionsResponse(
            selected_model=qa_config.selected_model,
            models=models,
        )

    @staticmethod
    def build_space_options(raw_spaces: list[dict[str, Any]]) -> SpaceOptionsResponse:
        options = [
            SpaceOption(
                id=int(item["id"]),
                name=str(item.get("name") or ""),
                description=str(item.get("description") or ""),
                file_count=int(item.get("file_num") or 0),
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
