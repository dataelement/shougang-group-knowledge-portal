import json
import re

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


REST_STATE_SECRET_PREFIX = "sg-rest-meta:"
REST_PROVIDER = "rest"
REST_PERSIST_PROVIDER = "custom"


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def _normalize_optional_rest_url(value: str | None, *, base_url: str = "") -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    if re.search(r"\{[^}]+\}", text):
        return ""
    if text.lower().startswith(("http://", "https://")):
        return text

    base = _normalize_text(base_url).rstrip("/")
    if text.startswith("/"):
        return f"{base}{text}" if base else text
    if base and text.lower().startswith("idp/"):
        return f"{base}/{text.lstrip('/')}"
    if re.match(r"^[\w.-]+/", text) or re.match(r"^[\w.-]+\.[a-z]{2,}", text, re.I):
        return f"https://{text.lstrip('/')}"
    if base and text.lower().startswith("getidp"):
        return f"{base}/idp/restful/{text}"
    return text


def _validate_optional_http_url(value: str | None) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    if re.search(r"\{[^}]+\}", text):
        return ""
    if text.lower().startswith(("http://", "https://")):
        return text
    if text.startswith("/") or text.lower().startswith("idp/") or text.lower().startswith("getidp"):
        return text
    if re.match(r"^[\w.-]+/", text) or re.match(r"^[\w.-]+\.[a-z]{2,}", text, re.I):
        return f"https://{text.lstrip('/')}"
    raise ValueError("url must start with http:// or https://")


def resolve_rest_auth_urls(
    *,
    rest_base_url: str,
    authenticate_url: str = "",
    token_valid_url: str = "",
    user_attributes_url: str = "",
) -> tuple[str, str, str]:
    base_url = rest_base_url
    return (
        _resolve_optional_http_url(authenticate_url, base_url=base_url),
        _resolve_optional_http_url(token_valid_url, base_url=base_url),
        _resolve_optional_http_url(user_attributes_url, base_url=base_url),
    )


def _resolve_optional_http_url(value: str, *, base_url: str) -> str:
    text = _normalize_optional_rest_url(value, base_url=base_url)
    if not text:
        return ""
    if text.lower().startswith(("http://", "https://")):
        return text
    raise ValueError("url must start with http:// or https://")


class RestAuthRuntimeConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    rest_base_url: str = ""
    rest_app_id: str = ""
    authenticate_url: str = ""
    token_valid_url: str = ""
    user_attributes_url: str = ""
    rest_token_id_param: str = "tokenId"
    http_timeout_seconds: float = 10.0
    token_check_interval_seconds: int = 300
    verify_tls: bool = True
    bisheng_lookup_required: bool = False
    login_sync_hmac_secret: str = ""
    login_sync_signature_header: str = "X-Signature"

    @field_validator(
        "rest_base_url",
        "authenticate_url",
        "token_valid_url",
        "user_attributes_url",
        mode="before",
    )
    @classmethod
    def validate_urls(cls, value: str | None) -> str:
        return _validate_optional_http_url(value)

    @field_validator("rest_app_id", "rest_token_id_param", "login_sync_signature_header", mode="before")
    @classmethod
    def normalize_strings(cls, value: str | None) -> str:
        return _normalize_text(value)

    @field_validator("http_timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("http_timeout_seconds must be positive")
        return value

    @field_validator("token_check_interval_seconds")
    @classmethod
    def validate_check_interval(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("token_check_interval_seconds must be positive")
        return value


def rest_auth_payload_has_content(payload: dict[str, object]) -> bool:
    if payload.get("enabled"):
        return True
    for key in (
        "rest_base_url",
        "rest_app_id",
        "authenticate_url",
        "token_valid_url",
        "user_attributes_url",
        "rest_authenticate_url",
        "rest_token_valid_url",
        "rest_user_attributes_url",
    ):
        if str(payload.get(key) or "").strip():
            return True
    return False


def unified_auth_has_rest_content(unified_auth: dict[str, object]) -> bool:
    if is_rest_oauth_unified_auth(unified_auth):
        return True
    if unified_auth.get("rest_enabled"):
        return True
    for key in ("rest_base_url", "rest_app_id", "rest_authenticate_url", "rest_token_valid_url", "rest_user_attributes_url"):
        if str(unified_auth.get(key) or "").strip():
            return True
    return False


def is_rest_oauth_unified_auth(unified_auth: dict[str, object]) -> bool:
    state_secret = str(unified_auth.get("state_secret") or "").strip()
    if state_secret.startswith(REST_STATE_SECRET_PREFIX):
        return True
    return str(unified_auth.get("provider") or "").strip().lower() == REST_PROVIDER


def _default_rest_endpoint_urls(rest_base_url: str) -> tuple[str, str, str]:
    base = rest_base_url.rstrip("/")
    if not base:
        return "", "", ""
    return (
        f"{base}/idp/restful/IDPAuthenticate",
        f"{base}/idp/restful/isIDPTokenValid",
        f"{base}/idp/restful/getIDPUserAttributes",
    )


def _encode_rest_meta(rest: RestAuthRuntimeConfig) -> str:
    payload = {
        "rest_base_url": rest.rest_base_url,
        "rest_token_id_param": rest.rest_token_id_param or "tokenId",
        "token_check_interval_seconds": rest.token_check_interval_seconds,
        "verify_tls": rest.verify_tls,
        "bisheng_lookup_required": rest.bisheng_lookup_required,
    }
    return REST_STATE_SECRET_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _decode_rest_meta(state_secret: object) -> dict[str, object]:
    text = str(state_secret or "").strip()
    if not text.startswith(REST_STATE_SECRET_PREFIX):
        return {}
    try:
        payload = json.loads(text[len(REST_STATE_SECRET_PREFIX) :])
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _rest_document_from_oauth_fields(unified_auth: dict[str, object]) -> dict[str, object]:
    meta = _decode_rest_meta(unified_auth.get("state_secret"))
    login_sync_secret = str(unified_auth.get("login_sync_hmac_secret") or "").strip()
    login_sync_header = str(unified_auth.get("login_sync_signature_header") or "X-Signature").strip()
    rest_base_url = str(meta.get("rest_base_url") or unified_auth.get("redirect_uri") or "").strip()
    return RestAuthRuntimeConfig(
        enabled=bool(unified_auth.get("enabled")),
        rest_base_url=rest_base_url,
        rest_app_id=str(unified_auth.get("client_id") or ""),
        authenticate_url=str(unified_auth.get("authorize_url") or ""),
        token_valid_url=str(unified_auth.get("token_url") or ""),
        user_attributes_url=str(unified_auth.get("userinfo_url") or ""),
        rest_token_id_param=str(meta.get("rest_token_id_param") or "tokenId"),
        http_timeout_seconds=float(unified_auth.get("http_timeout_seconds") or 10.0),
        token_check_interval_seconds=int(meta.get("token_check_interval_seconds") or unified_auth.get("state_ttl_seconds") or 300),
        verify_tls=bool(meta.get("verify_tls") if "verify_tls" in meta else True),
        bisheng_lookup_required=bool(meta.get("bisheng_lookup_required") or False),
        login_sync_hmac_secret=login_sync_secret,
        login_sync_signature_header=login_sync_header or "X-Signature",
    ).model_dump(mode="json")


def rest_auth_document_from_unified_auth(unified_auth: dict[str, object]) -> dict[str, object]:
    nested = unified_auth.get("rest_auth")
    if isinstance(nested, dict) and rest_auth_payload_has_content(nested):
        return RestAuthRuntimeConfig.model_validate(nested).model_dump(mode="json")

    if is_rest_oauth_unified_auth(unified_auth):
        return _rest_document_from_oauth_fields(unified_auth)

    login_sync_secret = str(unified_auth.get("rest_login_sync_hmac_secret") or unified_auth.get("login_sync_hmac_secret") or "").strip()
    login_sync_header = str(
        unified_auth.get("rest_login_sync_signature_header")
        or unified_auth.get("login_sync_signature_header")
        or "X-Signature"
    ).strip()

    return RestAuthRuntimeConfig(
        enabled=bool(unified_auth.get("rest_enabled")),
        rest_base_url=str(unified_auth.get("rest_base_url") or ""),
        rest_app_id=str(unified_auth.get("rest_app_id") or ""),
        authenticate_url=str(unified_auth.get("rest_authenticate_url") or unified_auth.get("authenticate_url") or ""),
        token_valid_url=str(unified_auth.get("rest_token_valid_url") or unified_auth.get("token_valid_url") or ""),
        user_attributes_url=str(
            unified_auth.get("rest_user_attributes_url") or unified_auth.get("user_attributes_url") or ""
        ),
        rest_token_id_param=str(unified_auth.get("rest_token_id_param") or "tokenId"),
        http_timeout_seconds=float(unified_auth.get("rest_http_timeout_seconds") or unified_auth.get("http_timeout_seconds") or 10.0),
        token_check_interval_seconds=int(
            unified_auth.get("rest_token_check_interval_seconds") or unified_auth.get("state_ttl_seconds") or 300
        ),
        verify_tls=bool(
            unified_auth.get("rest_verify_tls") if "rest_verify_tls" in unified_auth else unified_auth.get("verify_tls", True)
        ),
        bisheng_lookup_required=bool(unified_auth.get("rest_bisheng_lookup_required") or False),
        login_sync_hmac_secret=login_sync_secret,
        login_sync_signature_header=login_sync_header or "X-Signature",
    ).model_dump(mode="json")


def merge_rest_auth_into_unified_auth(
    unified_auth: dict[str, object],
    rest_payload: dict[str, object],
) -> dict[str, object]:
    rest = RestAuthRuntimeConfig.model_validate(rest_payload)
    next_data = dict(unified_auth)
    next_data.pop("rest_auth", None)
    for key in list(next_data):
        if key.startswith("rest_"):
            next_data.pop(key)

    login_sync_secret = rest.login_sync_hmac_secret or str(next_data.get("login_sync_hmac_secret") or "").strip()
    authenticate_url, token_valid_url, user_attributes_url = resolve_rest_auth_urls(
        rest_base_url=rest.rest_base_url,
        authenticate_url=rest.authenticate_url,
        token_valid_url=rest.token_valid_url,
        user_attributes_url=rest.user_attributes_url,
    )
    default_auth_url, default_token_url, default_user_url = _default_rest_endpoint_urls(rest.rest_base_url)
    next_data.update(
        {
            "enabled": rest.enabled,
            "provider": REST_PERSIST_PROVIDER,
            "client_id": rest.rest_app_id,
            "authorize_url": authenticate_url or default_auth_url,
            "token_url": token_valid_url or default_token_url,
            "userinfo_url": user_attributes_url or default_user_url,
            "http_timeout_seconds": rest.http_timeout_seconds,
            "login_sync_hmac_secret": login_sync_secret,
            "login_sync_signature_header": rest.login_sync_signature_header or "X-Signature",
            "state_ttl_seconds": rest.token_check_interval_seconds,
            "state_secret": _encode_rest_meta(rest),
        }
    )
    return next_data


class RestAuthRuntimeConfigView(BaseModel):
    enabled: bool = False
    rest_base_url: str = ""
    rest_app_id: str = ""
    authenticate_url: str = ""
    token_valid_url: str = ""
    user_attributes_url: str = ""
    rest_token_id_param: str = "tokenId"
    http_timeout_seconds: float = 10.0
    token_check_interval_seconds: int = 300
    verify_tls: bool = True
    bisheng_lookup_required: bool = False
    login_sync_signature_header: str = "X-Signature"
    has_login_sync_hmac_secret: bool = False
    missing_fields: list[str] = Field(default_factory=list)


class RestAuthRuntimeConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = False
    rest_base_url: str = ""
    rest_app_id: str = ""
    authenticate_url: str = ""
    token_valid_url: str = ""
    user_attributes_url: str = ""
    rest_token_id_param: str = "tokenId"
    http_timeout_seconds: float = 10.0
    token_check_interval_seconds: int = 300
    verify_tls: bool = True
    bisheng_lookup_required: bool = False
    login_sync_hmac_secret: SecretStr | None = None
    login_sync_signature_header: str = "X-Signature"

    @field_validator(
        "rest_base_url",
        "authenticate_url",
        "token_valid_url",
        "user_attributes_url",
        mode="before",
    )
    @classmethod
    def validate_urls(cls, value: str | None) -> str:
        return RestAuthRuntimeConfig.validate_urls(value)

    @field_validator("rest_app_id", "rest_token_id_param", "login_sync_signature_header", mode="before")
    @classmethod
    def normalize_strings(cls, value: str | None) -> str:
        return RestAuthRuntimeConfig.normalize_strings(value)

    @field_validator("http_timeout_seconds")
    @classmethod
    def validate_timeout(cls, value: float) -> float:
        return RestAuthRuntimeConfig.validate_timeout(value)

    @field_validator("token_check_interval_seconds")
    @classmethod
    def validate_check_interval(cls, value: int) -> int:
        return RestAuthRuntimeConfig.validate_check_interval(value)
