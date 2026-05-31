from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, SecretStr, field_validator


def _validate_asset_base_url(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        raise ValueError("asset_base_url must start with http:// or https://")
    return text.rstrip("/")


class BishengRuntimeConfig(BaseModel):
    base_url: AnyHttpUrl
    asset_base_url: str = ""
    username: str = ""
    timeout_seconds: float = 30.0
    api_token: str = ""
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
        return _validate_asset_base_url(value)


class BishengRuntimeAuthUser(BaseModel):
    account: str = ""
    name: str = ""
    role: str = ""
    external_id: str = ""


class BishengRuntimeConfigView(BaseModel):
    base_url: AnyHttpUrl
    asset_base_url: str = ""
    username: str = ""
    timeout_seconds: float = 30.0
    has_token: bool = False
    last_auth_at: str = ""
    connected: bool = False
    auth_message: str = "未验证"
    auth_user: BishengRuntimeAuthUser | None = None


class BishengRuntimeConfigUpdate(BaseModel):
    base_url: AnyHttpUrl
    asset_base_url: str = ""
    username: str = ""
    password: SecretStr | None = None
    timeout_seconds: float = 30.0

    @field_validator("timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("timeout_seconds must be positive")
        return value

    @field_validator("asset_base_url", mode="before")
    @classmethod
    def normalize_asset_base_url(cls, value: str | None) -> str:
        return _validate_asset_base_url(value)


class BishengRuntimeImportConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    base_url: AnyHttpUrl
    asset_base_url: str = ""
    username: str = ""
    timeout_seconds: float = 30.0
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
        return _validate_asset_base_url(value)


class BishengRuntimeStatus(BaseModel):
    connected: bool = False
    message: str = ""
