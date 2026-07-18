from __future__ import annotations

import asyncio
import io
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dependencies import get_bisheng_client
from app.api.routes.course import router as course_router
from app.clients.bisheng import (
    BishengClient,
    BishengMultipartReplayError,
)
from app.schemas.course import CourseUpdate, ProgressUpdate, VideoUpdate
from app.services.course_service import normalize_course_payload


def test_multipart_supports_a_per_request_long_timeout():
    async def run():
        client = BishengClient("http://bisheng.example", timeout_seconds=5)
        request = httpx.Request("POST", "http://bisheng.example/upload")
        client._client.request = AsyncMock(
            return_value=httpx.Response(
                200,
                request=request,
                json={"status_code": 200, "data": {"ok": True}},
            )
        )
        timeout = httpx.Timeout(connect=30, write=1800, read=1800, pool=30)
        stream = io.BytesIO(b"video")

        payload = await client.post_multipart(
            "/upload",
            files={"file": ("lesson.mp4", stream, "video/mp4")},
            timeout=timeout,
        )

        assert payload["data"]["ok"] is True
        assert client._client.request.await_args.kwargs["timeout"] is timeout
        await client.aclose()

    asyncio.run(run())


def test_multipart_rejects_non_rewindable_stream_before_sending():
    class NonRewindable:
        def read(self, _size=-1):
            return b"video"

    async def run():
        client = BishengClient("http://bisheng.example", timeout_seconds=5)
        client._client.request = AsyncMock()

        with pytest.raises(BishengMultipartReplayError):
            await client.post_multipart(
                "/upload",
                files={"file": ("lesson.mp4", NonRewindable(), "video/mp4")},
            )

        client._client.request.assert_not_awaited()
        await client.aclose()

    asyncio.run(run())


def test_course_payload_hides_storage_fields_and_rewrites_only_uploaded_media():
    payload = normalize_course_payload(
        {
            "id": "course",
            "object_name": "must-not-leak",
            "videos": [
                {
                    "id": "upload",
                    "source_type": "upload",
                    "object_name": "must-not-leak",
                    "play_url": "http://minio.internal/bisheng/video.mp4?X-Amz-Signature=abc",
                },
                {
                    "id": "url",
                    "source_type": "url",
                    "play_url": "https://media.example.com/video.mp4?token=external",
                },
            ],
        }
    )

    assert "object_name" not in payload
    assert "object_name" not in payload["videos"][0]
    assert payload["videos"][0]["play_url"] == "/bisheng/video.mp4?X-Amz-Signature=abc"
    assert payload["videos"][1]["play_url"] == (
        "https://media.example.com/video.mp4?token=external"
    )


def test_progress_schema_rejects_forged_identity():
    with pytest.raises(ValidationError):
        ProgressUpdate.model_validate(
            {
                "progress_seconds": 10,
                "completed": False,
                "user_id": 7,
            }
        )


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        pytest.param(CourseUpdate, "name", id="course-name"),
        pytest.param(CourseUpdate, "tags", id="course-tags"),
        pytest.param(CourseUpdate, "instructor", id="course-instructor"),
        pytest.param(CourseUpdate, "organization", id="course-organization"),
        pytest.param(CourseUpdate, "description", id="course-description"),
        pytest.param(CourseUpdate, "enabled", id="course-enabled"),
        pytest.param(CourseUpdate, "show_on_home", id="course-show-on-home"),
        pytest.param(CourseUpdate, "sort_order", id="course-sort-order"),
        pytest.param(VideoUpdate, "title", id="video-title"),
        pytest.param(VideoUpdate, "duration_seconds", id="video-duration"),
        pytest.param(VideoUpdate, "enabled", id="video-enabled"),
        pytest.param(VideoUpdate, "sort_order", id="video-sort-order"),
    ],
)
def test_update_schemas_reject_explicit_null_but_allow_omitted_fields(schema, field):
    assert schema.model_validate({}).model_fields_set == set()

    with pytest.raises(ValidationError):
        schema.model_validate({field: None})


def test_public_course_route_uses_service_client_without_portal_session():
    class FakeCourseClient:
        def __init__(self):
            self.calls = []

        async def get_json(self, path, params=None):
            self.calls.append((path, params))
            return {
                "status_code": 200,
                "data": {"items": [{"id": "course-1", "name": "安全课"}]},
            }

    fake = FakeCourseClient()
    app = FastAPI()
    app.include_router(course_router)
    app.dependency_overrides[get_bisheng_client] = lambda: fake

    with TestClient(app) as client:
        response = client.get("/api/v1/courses?placement=home")

    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["id"] == "course-1"
    assert fake.calls == [
        (
            "/api/v1/shougang-portal/course-catalog/courses",
            {"placement": "home"},
        )
    ]
