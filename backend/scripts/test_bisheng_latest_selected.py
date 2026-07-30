#!/usr/bin/env python3
"""Directly probe BiSheng shougang-portal endpoints used by home latest_selected."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.settings import get_settings  # noqa: E402


def _summarize(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else None
    items = (data or {}).get("data") if isinstance(data, dict) else None
    counts = (data or {}).get("counts") if isinstance(data, dict) else None
    summary = {
        "status_code": payload.get("status_code"),
        "status_message": payload.get("status_message"),
        "detail": payload.get("detail"),
        "count": len(items or []),
    }
    if items:
        summary["first_title"] = str(items[0].get("title") or "")[:120]
    if counts is not None:
        summary["counts"] = counts
    return summary


async def _post(base_url: str, token: str, path: str, body: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    cookies: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        cookies["access_token_cookie"] = token
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=60.0) as client:
        response = await client.post(path, json=body, headers=headers, cookies=cookies)
        try:
            payload = response.json()
        except ValueError:
            return {"http_status": response.status_code, "raw": response.text[:500]}
        summary = _summarize(payload)
        summary["http_status"] = response.status_code
        return summary


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("PORTAL_BISHENG_BASE_URL") or str(get_settings().bisheng_base_url),
        help="BiSheng base URL, e.g. http://192.168.106.171:7860",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("BISHENG_ACCESS_TOKEN", ""),
        help="BiSheng access_token_cookie value",
    )
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()

    browse_body = {
        "discovery_scope": "public_and_department",
        "tag": None,
        "space_ids": [],
        "space_level": None,
        "file_ext": None,
        "sort": "portal_read_count_desc",
        "cursor": None,
        "limit": args.limit,
        "recommendation": "latest_selected",
    }
    search_body = {
        "discovery_scope": "public",
        "q": None,
        "tag": None,
        "space_ids": [],
        "space_level": "public",
        "file_ext": None,
        "sort": "portal_read_count_desc",
        "cursor": None,
        "limit": args.limit,
        "recommendation": "latest_selected",
        "public_only": True,
        "rerank_model_id": "",
    }
    domain_body = {
        "domains": [
            {"code": "PP", "space_ids": []},
            {"code": "SA", "space_ids": []},
            {"code": "FI", "space_ids": []},
        ]
    }

    print(f"bisheng_base_url={args.base_url}")
    print(f"token_present={bool(args.token.strip())}")

    for label, path, body in (
        ("browse_logged_in_latest_selected", "/api/v1/knowledge/shougang-portal/files/browse", browse_body),
        ("search_public_latest_selected", "/api/v1/knowledge/shougang-portal/files/search", search_body),
        ("domain_file_counts", "/api/v1/knowledge/shougang-portal/domain-file-counts", domain_body),
    ):
        result = await _post(args.base_url, args.token.strip(), path, body)
        print(f"{label}: {json.dumps(result, ensure_ascii=False)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
