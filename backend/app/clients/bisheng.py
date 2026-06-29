from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Awaitable, Callable, Optional
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

AuthRefreshHandler = Callable[[str], Awaitable[str]]
AUTH_STATUS_CODES = {401}
AUTH_PAYLOAD_CODES = {401}
AUTH_MESSAGE_MARKERS = (
    "unauthorized",
    "not authenticated",
    "未登录",
    "登录已过期",
    "登录态",
    "token失效",
    "token 失效",
    "token过期",
    "token 过期",
)


class BishengAuthRefreshError(RuntimeError):
    pass


class BishengClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        api_token: Optional[str] = None,
        asset_base_url: Optional[str] = None,
        auth_refresh_handler: AuthRefreshHandler | None = None,
    ):
        self._base_url = base_url.rstrip("/") + "/"
        normalized_asset = (asset_base_url or "").strip().rstrip("/")
        self._asset_base_url = (normalized_asset + "/") if normalized_asset else self._base_url
        self._api_token = api_token or ""
        self._auth_refresh_handler = auth_refresh_handler
        headers: dict[str, str] = {}
        if self._api_token:
            headers["Authorization"] = f"Bearer {self._api_token}"
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
        if self._api_token:
            self._client.cookies.set("access_token_cookie", self._api_token)

    async def get(
        self,
        path: str,
        params: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
        *,
        retry_auth: bool = True,
    ) -> httpx.Response:
        response = await self._request(
            "GET",
            path,
            retry_auth=retry_auth,
            params=params,
            headers=headers,
        )
        response.raise_for_status()
        return response

    async def get_preview_asset(self, path_or_url: str, params: Optional[dict] = None) -> httpx.Response:
        url = self.resolve_asset_url(path_or_url)
        client = self._plain_client if self._should_bypass_auth(url) else self._client
        response = await client.get(url, params=params)
        if client is self._client and self._is_auth_status(response.status_code):
            if await self._refresh_auth_token():
                response = await client.get(url, params=params)
        response.raise_for_status()
        return response

    async def post(
        self,
        path: str,
        json: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
        *,
        retry_auth: bool = True,
    ) -> httpx.Response:
        response = await self._request(
            "POST",
            path,
            retry_auth=retry_auth,
            json=json,
            headers=headers,
        )
        response.raise_for_status()
        return response

    async def post_multipart(self, path: str, *, data: Optional[dict] = None, files: Optional[dict] = None) -> dict:
        file_positions = self._snapshot_file_positions(files)
        response = await self._request(
            "POST",
            path,
            retry_auth=True,
            data=data,
            files=files,
            file_positions=file_positions,
        )
        response.raise_for_status()
        return response.json()

    async def get_json(
        self,
        path: str,
        params: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict:
        response = await self.get(path, params=params, headers=headers)
        payload = response.json()
        if self._is_auth_payload(payload) and await self._refresh_auth_token():
            response = await self.get(path, params=params, headers=headers, retry_auth=False)
            payload = response.json()
        return payload

    async def post_json(
        self,
        path: str,
        json: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict:
        response = await self.post(path, json=json, headers=headers)
        payload = response.json()
        if self._is_auth_payload(payload) and await self._refresh_auth_token():
            response = await self.post(path, json=json, headers=headers, retry_auth=False)
            payload = response.json()
        return payload

    async def delete_json(
        self,
        path: str,
        json: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict:
        response = await self._request(
            "DELETE",
            path,
            retry_auth=True,
            json=json,
            headers=headers,
        )
        response.raise_for_status()
        payload = response.json()
        if self._is_auth_payload(payload) and await self._refresh_auth_token():
            response = await self._request(
                "DELETE",
                path,
                retry_auth=False,
                json=json,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
        return payload

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
        retried = False
        while True:
            async with self._client.stream("GET", url, params=params) as response:
                if (
                    self._is_auth_status(response.status_code)
                    and not retried
                    and await self._refresh_auth_token()
                ):
                    retried = True
                    await response.aread()
                    continue
                response.raise_for_status()
                yield response
                return

    @staticmethod
    def _should_bypass_auth(url: str) -> bool:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return False
        query_keys = {key.lower() for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
        return not PRESIGNED_QUERY_KEYS.isdisjoint(query_keys)

    async def stream_post(
        self,
        path: str,
        json: Optional[dict] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> AsyncIterator[bytes]:
        retried = False
        while True:
            async with self._client.stream("POST", path, json=json, headers=headers) as response:
                if (
                    self._is_auth_status(response.status_code)
                    and not retried
                    and await self._refresh_auth_token()
                ):
                    retried = True
                    await response.aread()
                    continue
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
                return

    async def aclose(self) -> None:
        await self._client.aclose()
        await self._plain_client.aclose()

    def set_api_token(self, api_token: str) -> None:
        self._api_token = api_token.strip()
        if self._api_token:
            self._client.headers["Authorization"] = f"Bearer {self._api_token}"
            self._client.cookies.set("access_token_cookie", self._api_token)
        else:
            self._client.headers.pop("Authorization", None)
            self._client.cookies.delete("access_token_cookie")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        retry_auth: bool,
        file_positions: dict | None = None,
        **kwargs,
    ) -> httpx.Response:
        response = await self._client.request(method, path, **kwargs)
        if (
            retry_auth
            and self._is_auth_status(response.status_code)
            and await self._refresh_auth_token()
        ):
            self._restore_file_positions(file_positions)
            response = await self._client.request(method, path, **kwargs)
        return response

    async def _refresh_auth_token(self) -> bool:
        if self._auth_refresh_handler is None:
            return False
        try:
            next_token = (await self._auth_refresh_handler(self._api_token)).strip()
        except Exception as err:
            raise BishengAuthRefreshError(f"BiSheng 数据源自动重登失败：{err}") from err
        if not next_token:
            return False
        self.set_api_token(next_token)
        return True

    @staticmethod
    def _is_auth_status(status_code: int) -> bool:
        return status_code in AUTH_STATUS_CODES

    @staticmethod
    def _is_auth_payload(payload: object) -> bool:
        if not isinstance(payload, dict):
            return False
        raw_code = payload.get("status_code", payload.get("code"))
        try:
            if int(raw_code) in AUTH_PAYLOAD_CODES:
                return True
        except (TypeError, ValueError):
            pass
        message = str(payload.get("status_message") or payload.get("message") or "").lower()
        return any(marker in message for marker in AUTH_MESSAGE_MARKERS)

    @staticmethod
    def _snapshot_file_positions(files: Optional[dict]) -> dict | None:
        if not files:
            return None
        positions = {}
        for value in files.values():
            file_obj = value[1] if isinstance(value, tuple) and len(value) > 1 else value
            if hasattr(file_obj, "tell") and hasattr(file_obj, "seek"):
                try:
                    positions[file_obj] = file_obj.tell()
                except OSError:
                    continue
        return positions or None

    @staticmethod
    def _restore_file_positions(positions: dict | None) -> None:
        if not positions:
            return
        for file_obj, position in positions.items():
            try:
                file_obj.seek(position)
            except OSError:
                continue
