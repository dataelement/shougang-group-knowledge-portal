from pydantic import SecretStr

from app.schemas.rest_auth_runtime import (
    RestAuthRuntimeConfig,
    RestAuthRuntimeConfigUpdate,
    RestAuthRuntimeConfigView,
    resolve_rest_auth_urls,
)
from app.services.config_store import InMemoryConfigStore
from app.services.unified_auth_runtime_service import UnifiedAuthRuntimeService
from app.settings import Settings


class RestAuthRuntimeService:
    _TABLE_NAME = "rest_auth_runtime_config"

    def __init__(
        self,
        *,
        settings: Settings,
        store=None,
        unified_auth_runtime_service: UnifiedAuthRuntimeService | None = None,
    ):
        self._store = store or InMemoryConfigStore()
        self._settings = settings
        self._unified_auth_runtime_service = unified_auth_runtime_service
        if not getattr(self._store, "skip_startup_seed", False):
            self._ensure_seeded()

    def get_config(self) -> RestAuthRuntimeConfig:
        data = self._store.get_document(self._TABLE_NAME)
        if data is None:
            return self._default_config()
        return RestAuthRuntimeConfig.model_validate(data)

    def get_public_config(self) -> RestAuthRuntimeConfigView:
        config = self.get_config()
        return self._to_public_view(config)

    def update_config(self, payload: RestAuthRuntimeConfigUpdate) -> RestAuthRuntimeConfigView:
        current = self.get_config()
        authenticate_url, token_valid_url, user_attributes_url = resolve_rest_auth_urls(
            rest_base_url=payload.rest_base_url,
            authenticate_url=payload.authenticate_url,
            token_valid_url=payload.token_valid_url,
            user_attributes_url=payload.user_attributes_url,
        )
        updated = RestAuthRuntimeConfig(
            enabled=payload.enabled,
            rest_base_url=payload.rest_base_url,
            rest_app_id=payload.rest_app_id,
            authenticate_url=authenticate_url,
            token_valid_url=token_valid_url,
            user_attributes_url=user_attributes_url,
            rest_token_id_param=payload.rest_token_id_param or "tokenId",
            http_timeout_seconds=payload.http_timeout_seconds,
            token_check_interval_seconds=payload.token_check_interval_seconds,
            verify_tls=payload.verify_tls,
            bisheng_lookup_required=payload.bisheng_lookup_required,
            login_sync_hmac_secret=self._next_secret(payload.login_sync_hmac_secret, current.login_sync_hmac_secret),
            login_sync_signature_header=payload.login_sync_signature_header or "X-Signature",
        )
        self._write_config(updated)
        return self._to_public_view(updated)

    def get_effective_login_sync_hmac_secret(self, config: RestAuthRuntimeConfig | None = None) -> str:
        runtime = config or self.get_config()
        explicit = self._secret_value(runtime.login_sync_hmac_secret)
        if explicit:
            return explicit
        return self._settings_login_sync_secret()

    def list_missing_fields(self, config: RestAuthRuntimeConfig | None = None) -> list[str]:
        runtime = config or self.get_config()
        missing: list[str] = []
        if not runtime.enabled:
            missing.append("enabled")
            return missing
        if not runtime.rest_base_url.strip():
            missing.append("rest_base_url")
        if not runtime.rest_app_id.strip():
            missing.append("rest_app_id")
        if not self.get_effective_login_sync_hmac_secret(runtime):
            missing.append("login_sync_hmac_secret")
        return missing

    def _ensure_seeded(self) -> None:
        if self._store.get_document(self._TABLE_NAME) is not None:
            return
        self._write_config(self._default_config())

    def _default_config(self) -> RestAuthRuntimeConfig:
        login_sync_secret = self._settings_login_sync_secret()
        return RestAuthRuntimeConfig(
            enabled=self._settings.rest_auth_enabled,
            rest_base_url=self._settings.rest_auth_base_url,
            rest_app_id=self._settings.rest_auth_app_id,
            authenticate_url=self._settings.rest_auth_authenticate_url,
            token_valid_url=self._settings.rest_auth_token_valid_url,
            user_attributes_url=self._settings.rest_auth_user_attributes_url,
            rest_token_id_param=self._settings.rest_auth_token_id_param or "tokenId",
            http_timeout_seconds=self._settings.rest_auth_http_timeout_seconds,
            token_check_interval_seconds=self._settings.rest_auth_token_check_interval_seconds,
            verify_tls=self._settings.rest_auth_verify_tls,
            bisheng_lookup_required=self._settings.rest_auth_bisheng_lookup_required,
            login_sync_hmac_secret=login_sync_secret,
            login_sync_signature_header=(
                self._settings.rest_auth_login_sync_signature_header or "X-Signature"
            ),
        )

    def _settings_login_sync_secret(self) -> str:
        explicit = self._secret_value(self._settings.rest_auth_login_sync_hmac_secret)
        if explicit:
            return explicit
        if self._unified_auth_runtime_service is not None:
            unified = self._unified_auth_runtime_service.get_config()
            unified_secret = self._secret_value(unified.login_sync_hmac_secret)
            if unified_secret:
                return unified_secret
        return self._secret_value(self._settings.unified_auth_login_sync_hmac_secret) or self._secret_value(
            self._settings.unified_auth_bisheng_hmac_secret
        )

    def _write_config(self, config: RestAuthRuntimeConfig) -> None:
        self._store.upsert_document(self._TABLE_NAME, config.model_dump(mode="json"))

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

    def _to_public_view(self, config: RestAuthRuntimeConfig) -> RestAuthRuntimeConfigView:
        return RestAuthRuntimeConfigView(
            enabled=config.enabled,
            rest_base_url=config.rest_base_url,
            rest_app_id=config.rest_app_id,
            authenticate_url=config.authenticate_url,
            token_valid_url=config.token_valid_url,
            user_attributes_url=config.user_attributes_url,
            rest_token_id_param=config.rest_token_id_param or "tokenId",
            http_timeout_seconds=config.http_timeout_seconds,
            token_check_interval_seconds=config.token_check_interval_seconds,
            verify_tls=config.verify_tls,
            bisheng_lookup_required=config.bisheng_lookup_required,
            login_sync_signature_header=config.login_sync_signature_header or "X-Signature",
            has_login_sync_hmac_secret=bool(self.get_effective_login_sync_hmac_secret(config)),
            missing_fields=self.list_missing_fields(config),
        )
