import asyncio

import pytest

from app.services.portal_bisheng_user_lookup import PortalBishengUserLookup, is_local_bisheng_user


class FakeRuntimeService:
    async def sync_shared_auth_state(self):
        return None

    def get_client(self):
        return FakeLookupClient()


class FakeLookupClient:
    async def get_json(self, path: str, params=None):
        assert path == "/api/v1/user/list"
        params = params or {}
        if params.get("name") == "admin":
            return {
                "status_code": 200,
                "data": {
                    "data": [
                        {"user_name": "admin", "source": "local"},
                    ],
                    "total": 1,
                },
            }
        return {"status_code": 200, "data": {"data": [], "total": 0}}


def test_resolve_user_source_uses_bisheng_name_param():
    lookup = PortalBishengUserLookup(runtime_service=FakeRuntimeService())

    source = asyncio.run(lookup.resolve_user_source("admin"))

    assert source == "local"
    assert is_local_bisheng_user(source) is True
