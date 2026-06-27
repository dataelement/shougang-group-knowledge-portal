from pydantic import BaseModel, ConfigDict, SecretStr, field_validator


PROVIDER_OPTIONS = {"group", "stock", "custom"}
TOKEN_PARAM_STYLE_OPTIONS = {"query", "form"}


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def _validate_optional_http_url(value: str | None) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        raise ValueError("url must start with http:// or https://")
    return text


class UnifiedAuthRuntimeConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    provider: str = "group"
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = ""
    authorize_url: str = ""
    token_url: str = ""
    userinfo_url: str = ""
    token_param_style: str = "query"
    state_secret: str = ""
    state_ttl_seconds: int = 300
    http_timeout_seconds: float = 10.0
    login_sync_hmac_secret: str = ""
    login_sync_signature_header: str = "X-Signature"

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, value: str | None) -> str:
        provider = _normalize_text(value).lower() or "group"
        if provider not in PROVIDER_OPTIONS:
            raise ValueError("provider must be group, stock or custom")
        return provider

    @field_validator("token_param_style", mode="before")
    @classmethod
    def validate_token_param_style(cls, value: str | None) -> str:
        style = _normalize_text(value).lower() or "query"
        if style not in TOKEN_PARAM_STYLE_OPTIONS:
            raise ValueError("token_param_style must be query or form")
        return style

    @field_validator("redirect_uri", "authorize_url", "token_url", "userinfo_url", mode="before")
    @classmethod
    def validate_urls(cls, value: str | None) -> str:
        return _validate_optional_http_url(value)

    @field_validator(
        "client_id",
        "client_secret",
        "state_secret",
        "login_sync_hmac_secret",
        "login_sync_signature_header",
        mode="before",
    )
    @classmethod
    def normalize_strings(cls, value: str | None) -> str:
        return _normalize_text(value)

    @field_validator("state_ttl_seconds")
    @classmethod
    def validate_state_ttl(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("state_ttl_seconds must be positive")
        return value

    @field_validator("http_timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("http_timeout_seconds must be positive")
        return value


class UnifiedAuthRuntimeConfigView(BaseModel):
    enabled: bool = False
    provider: str = "group"
    client_id: str = ""
    redirect_uri: str = ""
    authorize_url: str = ""
    token_url: str = ""
    userinfo_url: str = ""
    token_param_style: str = "query"
    state_ttl_seconds: int = 300
    http_timeout_seconds: float = 10.0
    login_sync_signature_header: str = "X-Signature"
    has_client_secret: bool = False
    has_state_secret: bool = False
    has_login_sync_hmac_secret: bool = False


class UnifiedAuthRuntimeConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    provider: str = "group"
    client_id: str = ""
    client_secret: SecretStr | None = None
    redirect_uri: str = ""
    authorize_url: str = ""
    token_url: str = ""
    userinfo_url: str = ""
    token_param_style: str = "query"
    state_secret: SecretStr | None = None
    state_ttl_seconds: int = 300
    http_timeout_seconds: float = 10.0
    login_sync_hmac_secret: SecretStr | None = None
    login_sync_signature_header: str = "X-Signature"

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_provider(value)

    @field_validator("token_param_style", mode="before")
    @classmethod
    def validate_token_param_style(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_token_param_style(value)

    @field_validator("redirect_uri", "authorize_url", "token_url", "userinfo_url", mode="before")
    @classmethod
    def validate_urls(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_urls(value)

    @field_validator("client_id", "login_sync_signature_header", mode="before")
    @classmethod
    def normalize_strings(cls, value: str | None) -> str:
        return _normalize_text(value)

    @field_validator("state_ttl_seconds")
    @classmethod
    def validate_state_ttl(cls, value: int) -> int:
        return UnifiedAuthRuntimeConfig.validate_state_ttl(value)

    @field_validator("http_timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        return UnifiedAuthRuntimeConfig.validate_timeout(value)
