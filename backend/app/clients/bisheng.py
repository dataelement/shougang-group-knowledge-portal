from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Optional
from urllib.parse import parse_qsl, urljoin, urlparse

import httpx

PRESIGNED_QUERY_KEYS = frozenset(
    {
        "x-amz-algorithm",
        "x-amz-credential",
        "x-amz-signature",
        "x-amz-date",
        "x-amz-signedheaders",
        "x-amz-expires",
    }
)


class BishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: Optional[str] = None,
        asset_base_url: Optional[str] = None,
    ):
        self._base_url = base_url.rstrip("/") + "/"
        normalized_asset = (asset_base_url or "").strip().rstrip("/")
        self._asset_base_url = (normalized_asset + "/") if normalized_asset else self._base_url
        headers: dict[str, str] = {}
        if api_token:
            headers["Authorization"] = f"Bearer {api_token}"
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
            headers=headers,
            follow_redirects=True,
        )
        self._plain_client = httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
        )
        if api_token:
            self._client.cookies.set("access_token_cookie", api_token)

    async def get(self, path: str, params: Optional[dict] = None) -> httpx.Response:
        response = await self._client.get(path, params=params)
        response.raise_for_status()
        return response

    async def get_preview_asset(self, path_or_url: str, params: Optional[dict] = None) -> httpx.Response:
        url = self.resolve_asset_url(path_or_url)
        client = self._plain_client if self._should_bypass_auth(url) else self._client
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response

    async def post(self, path: str, json: Optional[dict] = None) -> httpx.Response:
        response = await self._client.post(path, json=json)
        response.raise_for_status()
        return response

    async def post_multipart(self, path: str, *, data: Optional[dict] = None, files: Optional[dict] = None) -> dict:
        response = await self._client.post(path, data=data, files=files)
        response.raise_for_status()
        return response.json()

    async def get_json(self, path: str, params: Optional[dict] = None) -> dict:
        response = await self.get(path, params=params)
        return response.json()

    async def post_json(self, path: str, json: Optional[dict] = None) -> dict:
        response = await self.post(path, json=json)
        return response.json()

    def resolve_url(self, path_or_url: str) -> str:
        if not path_or_url:
            return ""
        return urljoin(self._base_url, path_or_url)

    def resolve_asset_url(self, path_or_url: str) -> str:
        if not path_or_url:
            return ""
        if urlparse(path_or_url).scheme:
            return path_or_url
        return urljoin(self._asset_base_url, path_or_url)

    @asynccontextmanager
    async def stream_get(self, path_or_url: str, params: Optional[dict] = None):
        url = self.resolve_url(path_or_url)
        async with self._client.stream("GET", url, params=params) as response:
            response.raise_for_status()
            yield response

    @staticmethod
    def _should_bypass_auth(url: str) -> bool:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return False
        query_keys = {key.lower() for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
        return not PRESIGNED_QUERY_KEYS.isdisjoint(query_keys)

    async def stream_post(self, path: str, json: Optional[dict] = None) -> AsyncIterator[bytes]:
        async with self._client.stream("POST", path, json=json) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk

    async def aclose(self) -> None:
        await self._client.aclose()
        await self._plain_client.aclose()
