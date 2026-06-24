from pydantic import BaseModel, ConfigDict

from app.schemas.bisheng_runtime import BishengRuntimeImportConfig
from app.schemas.portal_config import PortalConfig
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig


class AdminConfigExportPayload(BaseModel):
    version: int = 1
    exported_at: str
    portal: PortalConfig
    bisheng: BishengRuntimeImportConfig
    unified_auth: UnifiedAuthRuntimeConfig


class AdminConfigImportPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int
    portal: PortalConfig
    bisheng: BishengRuntimeImportConfig
    unified_auth: UnifiedAuthRuntimeConfig | None = None
