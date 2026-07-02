from pydantic import AnyHttpUrl, BaseModel, Field, field_validator

from app.schemas.portal_config import PortalConfig
from app.schemas.unified_auth_runtime import UnifiedAuthRuntimeConfig


def _normalize_asset_base_url(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        raise ValueError("asset_base_url must start with http:// or https://")
    return text.rstrip("/")


class PortalBishengPersistentConfig(BaseModel):
    base_url: AnyHttpUrl
    asset_base_url: str = ""
    username: str = ""
    timeout_seconds: float = 30.0
    saved_password: str = ""
    last_auth_at: str = ""

    @field_validator("timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("timeout_seconds must be positive")
        return value

    @field_validator("asset_base_url", mode="before")
    @classmethod
    def normalize_asset_base_url(cls, value: str | None) -> str:
        return _normalize_asset_base_url(value)


class PortalAdminAggregateConfig(BaseModel):
    version: int = 1
    portal: PortalConfig
    bisheng: PortalBishengPersistentConfig
    unified_auth: UnifiedAuthRuntimeConfig = Field(default_factory=UnifiedAuthRuntimeConfig)
