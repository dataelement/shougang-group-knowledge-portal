#!/usr/bin/env python3
"""Probe BiSheng user source lookup (same path as REST login local/IAM routing).

Call chain in production:
  POST /api/v1/auth/rest/login
    -> PortalRestAuthService.login_with_password()
    -> PortalRestAuthService._resolve_user_source()
    -> PortalBishengUserLookup.resolve_user_source(account)
    -> GET /api/v1/user/list (name / keyword / user_name)
    -> is_local_bisheng_user(source)  # source == "local" => BiSheng password

Usage:
  cd backend
  PORTAL_BISHENG_BASE_URL=http://192.168.106.171:7860 \\
  PORTAL_REDIS_URL=redis://192.168.106.171:6379 \\
  ./.venv/bin/python scripts/test_bisheng_user_source_lookup.py --account admin

  # optional explicit token (skip runtime login refresh)
  BISHENG_ACCESS_TOKEN=... ./.venv/bin/python scripts/test_bisheng_user_source_lookup.py -a admin -v
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.bisheng_auth_state_store import RedisBishengAuthStateStore  # noqa: E402
from app.services.bisheng_runtime_service import BishengRuntimeService  # noqa: E402
from app.services.config_store import RuntimeSnapshotConfigStore  # noqa: E402
from app.services.portal_bisheng_user_lookup import (  # noqa: E402
    PortalBishengUserLookup,
    is_local_bisheng_user,
)
from app.settings import get_settings  # noqa: E402


_LOOKUP_QUERY_KEYS = ("name", "keyword", "user_name")


def _summarize_row(row: dict[str, Any]) -> dict[str, Any]:
    nested = row.get("user") if isinstance(row.get("user"), dict) else {}
    flat = {**row, **nested} if nested else row
    return {
        "user_name": flat.get("user_name"),
        "external_id": flat.get("external_id"),
        "external_code": flat.get("external_code"),
        "source": flat.get("source"),
        "user_id": flat.get("user_id"),
        "nested_user_object": bool(nested),
        "top_level_keys": sorted(row.keys())[:12],
    }


def _match_account_preview(rows: list[dict[str, Any]], account: str) -> dict[str, Any] | None:
    target = account.strip().casefold()
    for row in rows:
        nested = row.get("user") if isinstance(row.get("user"), dict) else {}
        flat = {**row, **nested} if nested else row
        for key in ("user_name", "username", "account", "login_name", "external_id", "external_code"):
            text = str(flat.get(key) or "").strip()
            if text and text.casefold() == target:
                return _summarize_row(row)
        # current portal code only checks top-level fields (no nested flatten)
        for key in ("user_name", "username", "account", "login_name", "external_id", "external_code"):
            text = str(row.get(key) or "").strip()
            if text and text.casefold() == target:
                return {**_summarize_row(row), "matched_on": f"top_level.{key}"}
    return None


async def _build_runtime_service(settings):
    redis_client = None
    auth_state_store = None
    if settings.redis_url:
        import redis.asyncio as redis_asyncio

        redis_client = redis_asyncio.from_url(settings.redis_url, decode_responses=True)
        try:
            await redis_client.ping()
            auth_state_store = RedisBishengAuthStateStore(redis_client)
        except Exception:
            await redis_client.aclose()
            redis_client = None

    runtime = BishengRuntimeService(
        config_path=settings.bisheng_runtime_config_path,
        default_base_url=str(settings.bisheng_base_url),
        default_timeout_seconds=settings.bisheng_timeout_seconds,
        default_api_token=settings.bisheng_api_token,
        default_username=settings.bisheng_username,
        default_password=(
            settings.bisheng_password.get_secret_value() if settings.bisheng_password else None
        ),
        default_asset_base_url=settings.bisheng_asset_base_url,
        store=RuntimeSnapshotConfigStore(),
        auth_state_store=auth_state_store,
    )
    await runtime.initialize()
    if not (settings.bisheng_api_token or "").strip():
        await runtime.refresh_connection_status()
    return runtime, redis_client


async def _probe_raw_list_queries(client, account: str) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for key in _LOOKUP_QUERY_KEYS:
        params = {key: account, "page_num": 1, "page_size": 20}
        response = await client.get_json("/api/v1/user/list", params=params)
        data = response.get("data") if isinstance(response, dict) else None
        rows = []
        if isinstance(data, dict):
            for list_key in ("data", "list", "items", "records", "users"):
                raw_rows = data.get(list_key)
                if isinstance(raw_rows, list):
                    rows = [row for row in raw_rows if isinstance(row, dict)]
                    break
        elif isinstance(data, list):
            rows = [row for row in data if isinstance(row, dict)]

        portal_match = PortalBishengUserLookup._match_account(rows, account)
        preview_match = _match_account_preview(rows, account)
        attempts.append(
            {
                "params": params,
                "status_code": response.get("status_code") if isinstance(response, dict) else None,
                "row_count": len(rows),
                "first_row": _summarize_row(rows[0]) if rows else None,
                "portal_match": _summarize_row(portal_match) if portal_match else None,
                "match_if_nested_flattened": preview_match,
            }
        )
    return attempts


def _predict_auth_path(source: str | None) -> str:
    if is_local_bisheng_user(source):
        return "bisheng_local_password (auth_source=local)"
    if source:
        return f"iam_rest (auth_source=rest_auth, source={source})"
    return "iam_rest (auth_source=rest_auth, lookup_miss)"


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--account", "-a", default="admin", help="Login account to probe (default: admin)")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("PORTAL_BISHENG_BASE_URL") or "",
        help="Override PORTAL_BISHENG_BASE_URL",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("BISHENG_ACCESS_TOKEN") or "",
        help="BiSheng access token (or set BISHENG_ACCESS_TOKEN)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print raw /api/v1/user/list attempts (portal + nested-aware preview)",
    )
    args = parser.parse_args()

    settings = get_settings()
    overrides: dict[str, Any] = {}
    if args.base_url.strip():
        overrides["bisheng_base_url"] = args.base_url.strip()
    if args.token.strip():
        overrides["bisheng_api_token"] = args.token.strip()
    if overrides:
        settings = settings.model_copy(update=overrides)

    account = args.account.strip()
    if not account:
        print("account is required", file=sys.stderr)
        return 2

    runtime, redis_client = await _build_runtime_service(settings)
    source: str | None = None
    try:
        snap = runtime.get_runtime_config_snapshot()
        connected = bool((snap.api_token or "").strip())
        print(f"bisheng_base_url={snap.base_url}")
        print(f"runtime_token_present={connected}")
        print(f"account={account!r}")
        print()

        lookup = PortalBishengUserLookup(runtime_service=runtime)
        try:
            source = await lookup.resolve_user_source(account)
            lookup_error = None
        except Exception as err:
            source = None
            lookup_error = f"{type(err).__name__}: {err}"

        print("=== PortalBishengUserLookup.resolve_user_source (production path) ===")
        if lookup_error:
            print(f"error: {lookup_error}")
        print(f"source: {source!r}")
        print(f"is_local_bisheng_user: {is_local_bisheng_user(source)}")
        print(f"predicted_login_path: {_predict_auth_path(source)}")
        print()

        if args.verbose:
            client = runtime.get_client()
            attempts = await _probe_raw_list_queries(client, account)
            print("=== Raw GET /api/v1/user/list probes ===")
            print(json.dumps(attempts, ensure_ascii=False, indent=2))
            print()

        user = await lookup._lookup_user(runtime.get_client(), account)
        if user:
            print("=== Matched user record (normalized) ===")
            print(
                json.dumps(
                    {
                        "user_name": user.get("user_name"),
                        "external_id": user.get("external_id"),
                        "source": user.get("source"),
                        "user_id": user.get("user_id"),
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        elif not lookup_error:
            print("=== No user matched (_lookup_user returned None) ===")
            print(
                "Hint: BiSheng may return nested {user:{...}} rows; portal currently matches top-level fields only."
            )
    finally:
        await runtime.aclose()
        if redis_client is not None:
            await redis_client.aclose()

    return 0 if is_local_bisheng_user(source) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
