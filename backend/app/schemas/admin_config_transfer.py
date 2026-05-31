from pydantic import BaseModel, ConfigDict

from app.schemas.bisheng_runtime import BishengRuntimeImportConfig
from app.schemas.portal_config import PortalConfig


class AdminConfigExportPayload(BaseModel):
    version: int = 1
    exported_at: str
    portal: PortalConfig
    bisheng: BishengRuntimeImportConfig


class AdminConfigImportPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int
    portal: PortalConfig
    bisheng: BishengRuntimeImportConfig
