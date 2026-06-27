import secrets
from pathlib import Path
from typing import Callable

from pydantic import SecretStr

from app.schemas.unified_auth_runtime import (
    UnifiedAuthRuntimeConfig,
    UnifiedAuthRuntimeConfigUpdate,
    UnifiedAuthRuntimeConfigView,
)
from app.services.config_store import SQLiteConfigStore
from app.settings import Settings


class UnifiedAuthRuntimeService:
    _TABLE_NAME = "unified_auth_runtime_config"

    def __init__(
        self,
        *,
        database_path: Path,
        settings: Settings,
        state_secret_factory: Callable[[], str] | None = None,
    ):
        self._store = SQLiteConfigStore(database_path)
        self._settings = settings
        self._state_secret_factory = state_secret_factory or (lambda: secrets.token_urlsafe(32))
        self._ensure_seeded()

    def get_config(self) -> UnifiedAuthRuntimeConfig:
        data = self._store.get_document(self._TABLE_NAME)
        if data is None:
            return self._default_config()
        return UnifiedAuthRuntimeConfig.model_validate(data)

    def get_public_config(self) -> UnifiedAuthRuntimeConfigView:
        return self._to_public_view(self.get_config())

    def export_importable_config(self) -> UnifiedAuthRuntimeConfig:
        return self.get_config()

    def snapshot_config(self) -> UnifiedAuthRuntimeConfig:
        return self.get_config()

    def restore_config(self, config: UnifiedAuthRuntimeConfig) -> UnifiedAuthRuntimeConfigView:
        self._write_config(config)
        return self._to_public_view(config)

    def replace_importable_config(self, payload: UnifiedAuthRuntimeConfig) -> UnifiedAuthRuntimeConfigView:
        self._write_config(payload)
        return self._to_public_view(payload)

    def update_config(self, payload: UnifiedAuthRuntimeConfigUpdate) -> UnifiedAuthRuntimeConfigView:
        current = self.get_config()
        updated = UnifiedAuthRuntimeConfig(
            enabled=payload.enabled,
            provider=payload.provider,
            client_id=payload.client_id,
            client_secret=self._next_secret(payload.client_secret, current.client_secret),
            redirect_uri=payload.redirect_uri,
            authorize_url=payload.authorize_url,
            token_url=payload.token_url,
            userinfo_url=payload.userinfo_url,
            token_param_style=payload.token_param_style,
            state_secret=self._next_state_secret(payload.state_secret, current.state_secret),
            state_ttl_seconds=payload.state_ttl_seconds,
            http_timeout_seconds=payload.http_timeout_seconds,
            login_sync_hmac_secret=self._next_secret(
                payload.login_sync_hmac_secret,
                current.login_sync_hmac_secret,
            ),
            login_sync_signature_header=payload.login_sync_signature_header or "X-Signature",
        )
        self._write_config(updated)
        return self._to_public_view(updated)

    def _ensure_seeded(self) -> None:
        if self._store.get_document(self._TABLE_NAME) is not None:
            return
        self._write_config(self._default_config())

    def _default_config(self) -> UnifiedAuthRuntimeConfig:
        state_secret = self._secret_value(self._settings.unified_auth_state_secret)
        if not state_secret:
            state_secret = self._state_secret_factory()
        return UnifiedAuthRuntimeConfig(
            enabled=self._settings.unified_auth_enabled,
            provider=self._settings.unified_auth_provider,
            client_id=self._settings.unified_auth_client_id,
            client_secret=self._secret_value(self._settings.unified_auth_client_secret),
            redirect_uri=self._settings.unified_auth_redirect_uri,
            authorize_url=self._settings.unified_auth_authorize_url,
            token_url=self._settings.unified_auth_token_url,
            userinfo_url=self._settings.unified_auth_userinfo_url,
            token_param_style=self._settings.unified_auth_token_param_style,
            state_secret=state_secret,
            state_ttl_seconds=self._settings.unified_auth_state_ttl_seconds,
            http_timeout_seconds=self._settings.unified_auth_http_timeout_seconds,
            login_sync_hmac_secret=self._settings_login_sync_secret(),
            login_sync_signature_header=(
                self._settings.unified_auth_login_sync_signature_header
                or self._settings.unified_auth_bisheng_signature_header
                or "X-Signature"
            ),
        )

    def _settings_login_sync_secret(self) -> str:
        return self._secret_value(
            self._settings.unified_auth_login_sync_hmac_secret,
        ) or self._secret_value(self._settings.unified_auth_bisheng_hmac_secret)

    def _write_config(self, config: UnifiedAuthRuntimeConfig) -> None:
        self._store.upsert_document(self._TABLE_NAME, config.model_dump(mode="json"))

    def _next_state_secret(self, value: SecretStr | None, current: str) -> str:
        explicit = self._secret_value(value)
        if explicit:
            return explicit
        return current or self._state_secret_factory()

    @classmethod
    def _next_secret(cls, value: SecretStr | None, current: str) -> str:
        explicit = cls._secret_value(value)
        return explicit or current

    @staticmethod
    def _secret_value(value: object | None) -> str:
        if value is None:
            return ""
        if hasattr(value, "get_secret_value"):
            return str(value.get_secret_value()).strip()
        return str(value).strip()

    @staticmethod
    def _to_public_view(config: UnifiedAuthRuntimeConfig) -> UnifiedAuthRuntimeConfigView:
        return UnifiedAuthRuntimeConfigView(
            enabled=config.enabled,
            provider=config.provider,
            client_id=config.client_id,
            redirect_uri=config.redirect_uri,
            authorize_url=config.authorize_url,
            token_url=config.token_url,
            userinfo_url=config.userinfo_url,
            token_param_style=config.token_param_style,
            state_ttl_seconds=config.state_ttl_seconds,
            http_timeout_seconds=config.http_timeout_seconds,
            login_sync_signature_header=config.login_sync_signature_header or "X-Signature",
            has_client_secret=bool(config.client_secret),
            has_state_secret=bool(config.state_secret),
            has_login_sync_hmac_secret=bool(config.login_sync_hmac_secret),
        )
