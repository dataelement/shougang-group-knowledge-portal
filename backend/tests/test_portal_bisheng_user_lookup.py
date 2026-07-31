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
        params = params or {}
        if path == "/api/v1/user/by-external-id":
            return {"status_code": 404, "status_message": "This resource does not exist", "data": None}
        assert path == "/api/v1/user/list"
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


class FakeExternalIdLookupClient(FakeLookupClient):
    async def get_json(self, path: str, params=None):
        params = params or {}
        if path == "/api/v1/user/by-external-id":
            if params.get("external_id") == "EMP-1001":
                return {
                    "status_code": 200,
                    "status_message": "SUCCESS",
                    "data": {
                        "user_name": "liuy005x",
                        "source": "local",
                        "external_id": "EMP-1001",
                    },
                }
            return {"status_code": 404, "status_message": "This resource does not exist", "data": None}
        return await super().get_json(path, params)


class FakeExternalIdRuntimeService(FakeRuntimeService):
    def get_client(self):
        return FakeExternalIdLookupClient()


def test_lookup_user_matches_external_id_via_by_external_id_endpoint():
    runtime = FakeExternalIdRuntimeService()
    lookup = PortalBishengUserLookup(runtime_service=runtime)

    user = asyncio.run(lookup._lookup_user(runtime.get_client(), "EMP-1001"))

    assert user is not None
    assert user["user_name"] == "liuy005x"
    assert user["source"] == "local"
    assert user["external_id"] == "EMP-1001"
    assert asyncio.run(lookup.resolve_user_source("EMP-1001")) == "local"


class FakeByExternalIdFallbackClient(FakeLookupClient):
    async def get_json(self, path: str, params=None):
        params = params or {}
        if path == "/api/v1/user/by-external-id":
            return {"status_code": 404, "status_message": "This resource does not exist", "data": None}
        return await super().get_json(path, params)


class FakeByExternalIdFallbackRuntimeService(FakeRuntimeService):
    def get_client(self):
        return FakeByExternalIdFallbackClient()


def test_lookup_user_falls_back_to_list_when_by_external_id_misses():
    runtime = FakeByExternalIdFallbackRuntimeService()
    lookup = PortalBishengUserLookup(runtime_service=runtime)

    user = asyncio.run(lookup._lookup_user(runtime.get_client(), "admin"))

    assert user is not None
    assert user["user_name"] == "admin"
    assert user["source"] == "local"
