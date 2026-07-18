from __future__ import annotations

from copy import deepcopy
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.clients.bisheng import BishengClient

MAX_COURSE_MEDIA_BYTES = 1024 * 1024 * 1024
COURSE_UPLOAD_TIMEOUT = httpx.Timeout(connect=30, write=1800, read=1800, pool=30)
_FORBIDDEN_RESPONSE_KEYS = {
    "object_name",
    "access_key",
    "secret_key",
    "api_token",
}


class CourseUpstreamError(RuntimeError):
    def __init__(self, payload: dict):
        self.payload = payload
        try:
            self.code = int(payload.get("status_code", 502))
        except (TypeError, ValueError):
            self.code = 502
        super().__init__(str(payload.get("status_message") or "课程服务请求失败"))

    @property
    def http_status(self) -> int:
        if self.code in {25001, 25002}:
            return 404
        if self.code == 25004:
            return 413
        if self.code in {25005, 25006, 25007, 25008}:
            return 422
        if self.code in {25003, 25009}:
            return 409
        return 502


class CourseUploadTooLarge(RuntimeError):
    pass


def _same_origin_upload_url(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.scheme or not parsed.netloc:
        return value
    return urlunsplit(("", "", parsed.path, parsed.query, parsed.fragment))


def normalize_course_payload(payload):
    """Remove storage internals and normalize signed upload URLs for the browser."""

    value = deepcopy(payload)

    def visit(node):
        if isinstance(node, list):
            return [visit(item) for item in node]
        if not isinstance(node, dict):
            return node
        normalized = {
            key: visit(item)
            for key, item in node.items()
            if key not in _FORBIDDEN_RESPONSE_KEYS
        }
        if normalized.get("source_type") == "upload" and isinstance(
            normalized.get("play_url"), str
        ):
            normalized["play_url"] = _same_origin_upload_url(normalized["play_url"])
        return normalized

    return visit(value)


class CourseBffService:
    def __init__(self, client: BishengClient):
        self.client = client

    @staticmethod
    def _unwrap(payload: dict):
        raw_code = payload.get("status_code", 200)
        try:
            code = int(raw_code)
        except (TypeError, ValueError):
            code = 502
        if code != 200:
            raise CourseUpstreamError(payload)
        return normalize_course_payload(payload.get("data"))

    async def get(self, path: str, *, params: dict | None = None):
        return self._unwrap(await self.client.get_json(path, params=params))

    async def post(self, path: str, *, payload: dict):
        return self._unwrap(await self.client.post_json(path, json=payload))

    async def put(self, path: str, *, payload: dict):
        return self._unwrap(await self.client.put_json(path, json=payload))

    async def delete(self, path: str):
        return self._unwrap(await self.client.delete_json(path))

    async def upload(self, path: str, *, upload, data: dict):
        size = getattr(upload, "size", None)
        if size is not None and int(size) > MAX_COURSE_MEDIA_BYTES:
            raise CourseUploadTooLarge()
        payload = await self.client.post_multipart(
            path,
            data=data,
            files={
                "file": (
                    upload.filename or "video",
                    upload.file,
                    upload.content_type or "application/octet-stream",
                )
            },
            timeout=COURSE_UPLOAD_TIMEOUT,
        )
        return self._unwrap(payload)
