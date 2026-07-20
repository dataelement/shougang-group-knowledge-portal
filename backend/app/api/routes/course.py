from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from app.api.dependencies import (
    get_bisheng_client,
    get_portal_auth_service,
    require_admin_session,
)
from app.clients.bisheng import BishengClient, BishengMultipartReplayError
from app.schemas.common import response_error, response_ok
from app.schemas.course import (
    CourseCreate,
    CourseUpdate,
    OrderUpdate,
    ProgressUpdate,
    UrlVideoCreate,
    VideoUpdate,
)
from app.services.course_service import (
    CourseBffService,
    CourseUpstreamError,
    CourseUploadTooLarge,
)
from app.services.portal_auth_service import (
    PortalAuthError,
    PortalAuthService,
    PortalSession,
    require_portal_session,
)

router = APIRouter(tags=["courses"])

CATALOG_BASE = "/api/v1/shougang-portal/course-catalog"
ADMIN_BASE = "/api/v1/shougang-portal/course-admin"
LEARNING_BASE = "/api/v1/shougang-portal/course-learning"


async def require_course_session(
    request: Request,
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
) -> PortalSession:
    try:
        return await require_portal_session(auth_service, request)
    except PortalAuthError as err:
        raise HTTPException(status_code=err.status_code, detail=err.message) from err


async def _respond(awaitable: Awaitable):
    try:
        return response_ok(await awaitable)
    except CourseUpstreamError as err:
        return JSONResponse(status_code=err.http_status, content=err.payload)
    except CourseUploadTooLarge:
        return response_error("视频文件不能超过 1 GiB", status_code=413)
    except BishengMultipartReplayError as err:
        return response_error(str(err), status_code=502)
    except httpx.TimeoutException:
        return response_error("课程服务请求超时，请稍后重试", status_code=504)
    except httpx.HTTPError:
        return response_error("课程服务暂时不可用，请稍后重试", status_code=502)


async def _with_session_client(
    *,
    session: PortalSession,
    auth_service: PortalAuthService,
    operation: Callable[[CourseBffService], Awaitable],
):
    client = auth_service.create_bisheng_client(session)
    try:
        return await _respond(operation(CourseBffService(client)))
    finally:
        await client.aclose()


@router.get("/api/v1/courses")
async def list_public_courses(
    placement: str = Query(default="all", pattern="^(all|home)$"),
    client: BishengClient = Depends(get_bisheng_client),
):
    return await _respond(
        CourseBffService(client).get(
            f"{CATALOG_BASE}/courses",
            params={"placement": placement},
        )
    )


@router.get("/api/v1/courses/{course_id}")
async def get_public_course(
    course_id: str,
    client: BishengClient = Depends(get_bisheng_client),
):
    return await _respond(CourseBffService(client).get(f"{CATALOG_BASE}/courses/{course_id}"))


@router.get("/api/v1/courses/{course_id}/progress")
async def get_course_progress(
    course_id: str,
    session: PortalSession = Depends(require_course_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.get(
            f"{LEARNING_BASE}/courses/{course_id}/progress"
        ),
    )


@router.put("/api/v1/course-videos/{video_id}/progress")
async def report_video_progress(
    video_id: str,
    payload: ProgressUpdate,
    session: PortalSession = Depends(require_course_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{LEARNING_BASE}/videos/{video_id}/progress",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.get("/api/v1/admin/courses")
async def list_admin_courses(
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.get(f"{ADMIN_BASE}/courses"),
    )


@router.post("/api/v1/admin/courses")
async def create_admin_course(
    payload: CourseCreate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.post(
            f"{ADMIN_BASE}/courses",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.put("/api/v1/admin/courses/order")
async def order_admin_courses(
    payload: OrderUpdate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{ADMIN_BASE}/courses/order",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.put("/api/v1/admin/courses/{course_id}")
async def update_admin_course(
    course_id: str,
    payload: CourseUpdate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{ADMIN_BASE}/courses/{course_id}",
            payload=payload.model_dump(mode="json", exclude_unset=True),
        ),
    )


@router.delete("/api/v1/admin/courses/{course_id}")
async def delete_admin_course(
    course_id: str,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.delete(f"{ADMIN_BASE}/courses/{course_id}"),
    )


@router.post("/api/v1/admin/courses/{course_id}/videos/url")
async def create_admin_url_video(
    course_id: str,
    payload: UrlVideoCreate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.post(
            f"{ADMIN_BASE}/courses/{course_id}/videos/url",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.post("/api/v1/admin/courses/{course_id}/videos/upload")
async def create_admin_upload_video(
    course_id: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    enabled: bool = Form(False),
    sort_order: int = Form(0),
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.upload(
            f"{ADMIN_BASE}/courses/{course_id}/videos/upload",
            upload=file,
            data={
                "title": title,
                "enabled": str(enabled).lower(),
                "sort_order": str(sort_order),
            },
        ),
    )


@router.put("/api/v1/admin/courses/{course_id}/videos/order")
async def order_admin_videos(
    course_id: str,
    payload: OrderUpdate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{ADMIN_BASE}/courses/{course_id}/videos/order",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.put("/api/v1/admin/course-videos/{video_id}")
async def update_admin_video(
    video_id: str,
    payload: VideoUpdate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{ADMIN_BASE}/videos/{video_id}",
            payload=payload.model_dump(mode="json", exclude_unset=True),
        ),
    )


@router.delete("/api/v1/admin/course-videos/{video_id}")
async def delete_admin_video(
    video_id: str,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.delete(f"{ADMIN_BASE}/videos/{video_id}"),
    )


@router.put("/api/v1/admin/course-videos/{video_id}/source/url")
async def replace_admin_video_url(
    video_id: str,
    payload: UrlVideoCreate,
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.put(
            f"{ADMIN_BASE}/videos/{video_id}/source/url",
            payload=payload.model_dump(mode="json"),
        ),
    )


@router.post("/api/v1/admin/course-videos/{video_id}/source/upload")
async def replace_admin_video_upload(
    video_id: str,
    file: UploadFile = File(...),
    title: str = Form(...),
    enabled: bool = Form(False),
    sort_order: int = Form(0),
    session: PortalSession = Depends(require_admin_session),
    auth_service: PortalAuthService = Depends(get_portal_auth_service),
):
    return await _with_session_client(
        session=session,
        auth_service=auth_service,
        operation=lambda service: service.upload(
            f"{ADMIN_BASE}/videos/{video_id}/source/upload",
            upload=file,
            data={
                "title": title,
                "enabled": str(enabled).lower(),
                "sort_order": str(sort_order),
            },
        ),
    )
