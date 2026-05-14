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
    bisheng_api_token: Optional[str] = None
    bisheng_username: Optional[str] = None
    bisheng_password: Optional[SecretStr] = None
    bisheng_default_model: Optional[str] = None
    bisheng_page_size_limit: int = 100
    portal_session_cookie_name: str = "sg_portal_session"
    portal_session_ttl_seconds: int = 7 * 24 * 60 * 60
    portal_session_cookie_secure: bool = False
    bisheng_runtime_config_path: Path = Field(
        default=Path(__file__).resolve().parent / "config" / "data" / "bisheng_runtime.json"
    )
    portal_config_path: Path = Field(
        default=Path(__file__).resolve().parent / "config" / "data" / "portal_config.json"
    )
    portal_database_path: Path = Field(
        default=Path(__file__).resolve().parent / "config" / "data" / "portal.sqlite3"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
