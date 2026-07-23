from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PORTAL_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Shougang Knowledge Portal Backend"
    app_env: str = "development"
    bisheng_base_url: AnyHttpUrl = Field(default="http://localhost:7860")
    bisheng_asset_base_url: str = ""
    bisheng_timeout_seconds: float = 30.0
    bisheng_download_timeout_seconds: float = 370.0
    bisheng_api_token: Optional[str] = None
    bisheng_username: Optional[str] = None
    bisheng_password: Optional[SecretStr] = None
    bisheng_default_model: Optional[str] = None
    bisheng_page_size_limit: int = 100
    redis_url: Optional[str] = None
    portal_session_cookie_name: str = "sg_portal_session"
    portal_session_ttl_seconds: int = 7 * 24 * 60 * 60
    portal_session_cookie_secure: bool = False
    unified_auth_enabled: bool = False
    unified_auth_provider: str = "group"
    unified_auth_client_id: str = ""
    unified_auth_client_secret: Optional[SecretStr] = None
    unified_auth_redirect_uri: str = ""
    unified_auth_authorize_url: str = ""
    unified_auth_token_url: str = ""
    unified_auth_userinfo_url: str = ""
    unified_auth_token_param_style: str = "query"
    unified_auth_state_secret: Optional[SecretStr] = None
    unified_auth_state_ttl_seconds: int = 300
    unified_auth_http_timeout_seconds: float = 10.0
    unified_auth_login_sync_hmac_secret: Optional[SecretStr] = None
    unified_auth_login_sync_signature_header: str = "X-Signature"
    unified_auth_bisheng_hmac_secret: Optional[SecretStr] = None
    unified_auth_bisheng_signature_header: str = "X-Signature"
    unified_auth_glo_url: str = ""
    unified_auth_glo_entity_id: str = ""
    unified_auth_glo_redirect_to_url: str = ""
    unified_auth_glo_redirect_to_login: bool = True
    rest_auth_enabled: bool = False
    rest_auth_base_url: str = ""
    rest_auth_app_id: str = ""
    rest_auth_authenticate_url: str = ""
    rest_auth_token_valid_url: str = ""
    rest_auth_user_attributes_url: str = ""
    rest_auth_token_id_param: str = "tokenId"
    rest_auth_http_timeout_seconds: float = 10.0
    rest_auth_token_check_interval_seconds: int = 300
    rest_auth_verify_tls: bool = True
    rest_auth_bisheng_lookup_required: bool = False
    rest_auth_login_sync_hmac_secret: Optional[SecretStr] = None
    rest_auth_login_sync_signature_header: str = "X-Signature"
    bisheng_runtime_config_path: Path = Field(
        default=Path(__file__).resolve().parent / "config" / "data" / "bisheng_runtime.json"
    )
    portal_config_path: Path = Field(
        default=Path(__file__).resolve().parent / "config" / "data" / "portal_config.json"
    )

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
