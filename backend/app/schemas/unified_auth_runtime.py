from pydantic import BaseModel, ConfigDict, SecretStr, field_validator

from app.schemas.rest_auth_runtime import _validate_optional_http_url as _validate_rest_url


PROVIDER_OPTIONS = {"group", "stock", "custom", "rest"}
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
    glo_url: str = ""
    glo_entity_id: str = ""
    glo_redirect_to_url: str = ""
    glo_redirect_to_login: bool = True
    rest_enabled: bool = False
    rest_base_url: str = ""
    rest_app_id: str = ""
    rest_authenticate_url: str = ""
    rest_token_valid_url: str = ""
    rest_user_attributes_url: str = ""
    rest_token_id_param: str = "tokenId"
    rest_http_timeout_seconds: float = 10.0
    rest_token_check_interval_seconds: int = 300
    rest_verify_tls: bool = True
    rest_bisheng_lookup_required: bool = False
    rest_login_sync_hmac_secret: str = ""
    rest_login_sync_signature_header: str = ""

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, value: str | None) -> str:
        provider = _normalize_text(value).lower() or "group"
        if provider not in PROVIDER_OPTIONS:
            raise ValueError("provider must be group, stock, custom or rest")
        return provider

    @field_validator("token_param_style", mode="before")
    @classmethod
    def validate_token_param_style(cls, value: str | None) -> str:
        style = _normalize_text(value).lower() or "query"
        if style not in TOKEN_PARAM_STYLE_OPTIONS:
            raise ValueError("token_param_style must be query or form")
        return style

    @field_validator(
        "redirect_uri",
        "authorize_url",
        "token_url",
        "userinfo_url",
        "glo_url",
        "glo_redirect_to_url",
        mode="before",
    )
    @classmethod
    def validate_oauth_urls(cls, value: str | None) -> str:
        return _validate_optional_http_url(value)

    @field_validator(
        "rest_authenticate_url",
        "rest_token_valid_url",
        "rest_user_attributes_url",
        mode="before",
    )
    @classmethod
    def validate_rest_urls(cls, value: str | None) -> str:
        return _validate_rest_url(value)

    @field_validator("rest_base_url", mode="before")
    @classmethod
    def validate_rest_base_url(cls, value: str | None) -> str:
        return _validate_rest_url(value)

    @field_validator(
        "client_id",
        "client_secret",
        "state_secret",
        "login_sync_hmac_secret",
        "login_sync_signature_header",
        "glo_entity_id",
        "rest_app_id",
        "rest_token_id_param",
        "rest_login_sync_hmac_secret",
        "rest_login_sync_signature_header",
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

    @field_validator("http_timeout_seconds", "rest_http_timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("http_timeout_seconds must be positive")
        return value

    @field_validator("rest_token_check_interval_seconds")
    @classmethod
    def validate_rest_check_interval(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("rest_token_check_interval_seconds must be positive")
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
    glo_url: str = ""
    glo_entity_id: str = ""
    glo_redirect_to_url: str = ""
    glo_redirect_to_login: bool = True
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
    glo_url: str = ""
    glo_entity_id: str = ""
    glo_redirect_to_url: str = ""
    glo_redirect_to_login: bool = True

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_provider(value)

    @field_validator("token_param_style", mode="before")
    @classmethod
    def validate_token_param_style(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_token_param_style(value)

    @field_validator(
        "redirect_uri",
        "authorize_url",
        "token_url",
        "userinfo_url",
        "glo_url",
        "glo_redirect_to_url",
        mode="before",
    )
    @classmethod
    def validate_urls(cls, value: str | None) -> str:
        return UnifiedAuthRuntimeConfig.validate_oauth_urls(value)

    @field_validator("client_id", "login_sync_signature_header", "glo_entity_id", mode="before")
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
