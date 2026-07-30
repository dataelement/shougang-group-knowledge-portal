from app.schemas.rest_auth_runtime import (
    merge_rest_auth_into_unified_auth,
    rest_auth_document_from_unified_auth,
)


def test_merge_rest_auth_maps_to_oauth_fields():
    rest_payload = {
        "enabled": True,
        "rest_base_url": "https://iam.example.com",
        "rest_app_id": "portal-rest",
        "authenticate_url": "https://iam.example.com/idp/restful/IDPAuthenticate",
        "token_valid_url": "https://iam.example.com/idp/restful/isIDPTokenValid",
        "user_attributes_url": "https://iam.example.com/idp/restful/getIDPUserAttributes",
        "rest_token_id_param": "tokenId",
        "http_timeout_seconds": 12.0,
        "token_check_interval_seconds": 600,
        "verify_tls": False,
        "bisheng_lookup_required": True,
        "login_sync_hmac_secret": "sync-secret",
        "login_sync_signature_header": "X-Signature",
    }

    unified = merge_rest_auth_into_unified_auth({}, rest_payload)

    assert unified["enabled"] is True
    assert unified["provider"] == "custom"
    assert unified["client_id"] == "portal-rest"
    assert unified["redirect_uri"] == "https://iam.example.com"
    assert unified["authorize_url"] == "https://iam.example.com/idp/restful/IDPAuthenticate"
    assert unified["token_url"] == "https://iam.example.com/idp/restful/isIDPTokenValid"
    assert unified["userinfo_url"] == "https://iam.example.com/idp/restful/getIDPUserAttributes"
    assert unified["http_timeout_seconds"] == 12.0
    assert unified["state_ttl_seconds"] == 600
    assert unified["login_sync_hmac_secret"] == "sync-secret"
    assert unified["state_secret"].startswith("sg-rest-meta:")
    assert '"rest_base_url":"https://iam.example.com"' in unified["state_secret"]
    assert "rest_enabled" not in unified
    assert "rest_base_url" not in unified


def test_merge_rest_auth_maps_rest_base_url_to_redirect_uri():
    unified = merge_rest_auth_into_unified_auth(
        {"redirect_uri": "http://portal.example.com/api/v1/auth/unified/callback"},
        {
            "enabled": True,
            "rest_base_url": "https://iam.example.com",
            "rest_app_id": "portal-rest",
            "login_sync_hmac_secret": "sync-secret",
        },
    )

    assert unified["redirect_uri"] == "https://iam.example.com"
    assert unified["provider"] == "custom"
    assert '"rest_base_url":"https://iam.example.com"' in unified["state_secret"]


def test_rest_auth_document_survives_redacted_state_secret():
    unified = merge_rest_auth_into_unified_auth(
        {},
        {
            "enabled": True,
            "rest_base_url": "https://iam.example.com",
            "rest_app_id": "portal-rest",
            "authenticate_url": "",
            "token_valid_url": "",
            "user_attributes_url": "",
            "rest_token_id_param": "tokenId",
            "http_timeout_seconds": 10.0,
            "token_check_interval_seconds": 300,
            "verify_tls": True,
            "bisheng_lookup_required": False,
            "login_sync_hmac_secret": "sync-secret",
            "login_sync_signature_header": "X-Signature",
        },
    )
    redacted = dict(unified)
    redacted["state_secret"] = ""

    document = rest_auth_document_from_unified_auth(redacted)

    assert document["enabled"] is True
    assert document["rest_base_url"] == "https://iam.example.com"
    assert document["rest_app_id"] == "portal-rest"


def test_rest_auth_document_from_oauth_mapped_unified_auth():
    unified = merge_rest_auth_into_unified_auth(
        {},
        {
            "enabled": True,
            "rest_base_url": "https://iam.example.com",
            "rest_app_id": "portal-rest",
            "authenticate_url": "",
            "token_valid_url": "",
            "user_attributes_url": "",
            "rest_token_id_param": "tokenId",
            "http_timeout_seconds": 10.0,
            "token_check_interval_seconds": 300,
            "verify_tls": True,
            "bisheng_lookup_required": False,
            "login_sync_hmac_secret": "sync-secret",
            "login_sync_signature_header": "X-Signature",
        },
    )

    document = rest_auth_document_from_unified_auth(unified)

    assert document["enabled"] is True
    assert document["rest_base_url"] == "https://iam.example.com"
    assert document["rest_app_id"] == "portal-rest"
    assert document["login_sync_hmac_secret"] == "sync-secret"
    assert document["token_check_interval_seconds"] == 300
    assert document["verify_tls"] is True
    assert document["bisheng_lookup_required"] is False
