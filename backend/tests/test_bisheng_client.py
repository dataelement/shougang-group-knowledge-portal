import asyncio

import httpx

from app.clients.bisheng import BishengAuthRefreshError, BishengClient


class RecordingAsyncClient:
    def __init__(self, label: str):
        self.label = label
        self.calls: list[tuple[str, dict | None]] = []

    async def get(self, url: str, params=None):
        self.calls.append((url, params))
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            headers={"content-type": "application/octet-stream"},
            content=self.label.encode("utf-8"),
        )

    async def aclose(self):
        return None


class RequestSequenceClient:
    def __init__(self, responses: list[httpx.Response]):
        self.responses = responses
        self.calls: list[tuple[str, str, dict]] = []
        self.headers: dict[str, str] = {}
        self.cookies = httpx.Cookies()

    async def request(self, method: str, url: str, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if response.request is None:
            response.request = httpx.Request(method, url)
        return response

    async def aclose(self):
        return None


def test_get_preview_asset_uses_plain_client_for_presigned_urls():
    client = BishengClient("https://bisheng.example.com", 5, api_token="secret")
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    authed_client = RecordingAsyncClient("authed")
    plain_client = RecordingAsyncClient("plain")
    client._client = authed_client
    client._plain_client = plain_client

    presigned_url = (
        "https://files.example.com/demo.docx"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=demo"
    )
    try:
        response = asyncio.run(client.get_preview_asset(presigned_url))
    finally:
        asyncio.run(client.aclose())

    assert response.content == b"plain"
    assert plain_client.calls == [(presigned_url, None)]
    assert authed_client.calls == []


def test_resolve_asset_url_uses_asset_base_url_for_relative_paths():
    client = BishengClient(
        "https://bisheng.example.com",
        5,
        api_token="secret",
        asset_base_url="https://nginx.example.com:3002",
    )
    try:
        assert (
            client.resolve_asset_url("/bisheng/original/86139.pdf?signature=demo")
            == "https://nginx.example.com:3002/bisheng/original/86139.pdf?signature=demo"
        )
        # 已经是绝对 URL 时保持不变
        absolute = "https://other.example.com/foo.pdf?token=1"
        assert client.resolve_asset_url(absolute) == absolute
        # 空字符串返回空
        assert client.resolve_asset_url("") == ""
    finally:
        asyncio.run(client.aclose())


def test_resolve_asset_url_falls_back_to_base_url_when_asset_not_set():
    client = BishengClient("https://bisheng.example.com", 5)
    try:
        assert (
            client.resolve_asset_url("/bisheng/original/1.pdf?x=1")
            == "https://bisheng.example.com/bisheng/original/1.pdf?x=1"
        )
    finally:
        asyncio.run(client.aclose())


def test_get_preview_asset_keeps_authenticated_client_for_regular_urls():
    client = BishengClient("https://bisheng.example.com", 5, api_token="secret")
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    authed_client = RecordingAsyncClient("authed")
    plain_client = RecordingAsyncClient("plain")
    client._client = authed_client
    client._plain_client = plain_client

    url = "https://bisheng.example.com/api/v1/knowledge/file/info/1580"
    try:
        response = asyncio.run(client.get_preview_asset(url))
    finally:
        asyncio.run(client.aclose())

    assert response.content == b"authed"
    assert authed_client.calls == [(url, None)]
    assert plain_client.calls == []


def test_get_json_reauthenticates_and_retries_once_after_http_401():
    refresh_calls: list[str] = []

    async def refresh_token(failed_token: str) -> str:
        refresh_calls.append(failed_token)
        return "new-token"

    client = BishengClient(
        "https://bisheng.example.com",
        5,
        api_token="old-token",
        auth_refresh_handler=refresh_token,
    )
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    request_client = RequestSequenceClient(
        [
            httpx.Response(401, request=httpx.Request("GET", "https://bisheng.example.com/protected")),
            httpx.Response(200, json={"data": {"ok": True}}, request=httpx.Request("GET", "https://bisheng.example.com/protected")),
        ]
    )
    client._client = request_client
    client._plain_client = RecordingAsyncClient("plain")

    try:
        result = asyncio.run(client.get_json("/protected"))
    finally:
        asyncio.run(client.aclose())

    assert result == {"data": {"ok": True}}
    assert refresh_calls == ["old-token"]
    assert [call[1] for call in request_client.calls] == ["/protected", "/protected"]
    assert request_client.headers["Authorization"] == "Bearer new-token"
    assert request_client.cookies.get("access_token_cookie") == "new-token"


def test_get_json_reauthenticates_for_bisheng_login_expired_payload():
    refresh_calls: list[str] = []

    async def refresh_token(failed_token: str) -> str:
        refresh_calls.append(failed_token)
        return "fresh-token"

    client = BishengClient(
        "https://bisheng.example.com",
        5,
        api_token="stale-token",
        auth_refresh_handler=refresh_token,
    )
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    request_client = RequestSequenceClient(
        [
            httpx.Response(
                200,
                json={"status_code": 401, "status_message": "未登录或登录已过期"},
                request=httpx.Request("GET", "https://bisheng.example.com/protected"),
            ),
            httpx.Response(
                200,
                json={"status_code": 200, "data": {"ok": True}},
                request=httpx.Request("GET", "https://bisheng.example.com/protected"),
            ),
        ]
    )
    client._client = request_client
    client._plain_client = RecordingAsyncClient("plain")

    try:
        result = asyncio.run(client.get_json("/protected"))
    finally:
        asyncio.run(client.aclose())

    assert result == {"status_code": 200, "data": {"ok": True}}
    assert refresh_calls == ["stale-token"]
    assert len(request_client.calls) == 2


def test_get_json_does_not_retry_auth_failure_more_than_once():
    refresh_calls: list[str] = []

    async def refresh_token(failed_token: str) -> str:
        refresh_calls.append(failed_token)
        return "new-token"

    client = BishengClient(
        "https://bisheng.example.com",
        5,
        api_token="old-token",
        auth_refresh_handler=refresh_token,
    )
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    request_client = RequestSequenceClient(
        [
            httpx.Response(401, request=httpx.Request("GET", "https://bisheng.example.com/protected")),
            httpx.Response(401, request=httpx.Request("GET", "https://bisheng.example.com/protected")),
        ]
    )
    client._client = request_client
    client._plain_client = RecordingAsyncClient("plain")

    try:
        try:
            asyncio.run(client.get_json("/protected"))
        except httpx.HTTPStatusError as err:
            assert err.response.status_code == 401
        else:
            raise AssertionError("Expected HTTPStatusError")
    finally:
        asyncio.run(client.aclose())

    assert refresh_calls == ["old-token"]
    assert len(request_client.calls) == 2


def test_get_json_reports_auth_refresh_failure_clearly():
    async def refresh_token(_failed_token: str) -> str:
        raise ValueError("password expired")

    client = BishengClient(
        "https://bisheng.example.com",
        5,
        api_token="old-token",
        auth_refresh_handler=refresh_token,
    )
    original_client = client._client
    original_plain_client = client._plain_client
    asyncio.run(original_client.aclose())
    asyncio.run(original_plain_client.aclose())

    request_client = RequestSequenceClient(
        [httpx.Response(401, request=httpx.Request("GET", "https://bisheng.example.com/protected"))]
    )
    client._client = request_client
    client._plain_client = RecordingAsyncClient("plain")

    try:
        try:
            asyncio.run(client.get_json("/protected"))
        except BishengAuthRefreshError as err:
            assert "BiSheng 数据源自动重登失败" in str(err)
            assert "password expired" in str(err)
        else:
            raise AssertionError("Expected BishengAuthRefreshError")
    finally:
        asyncio.run(client.aclose())

    assert len(request_client.calls) == 1
