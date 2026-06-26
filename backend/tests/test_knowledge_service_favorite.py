import pytest
from unittest.mock import AsyncMock
from app.services.knowledge_service import KnowledgeService
from app.schemas.knowledge import (
    FavoriteDocumentRequest, FavoriteRemoveRequest, FavoriteStatusRequest,
)


def _svc(payload):
    svc = KnowledgeService.__new__(KnowledgeService)
    svc._bisheng = AsyncMock()
    svc._bisheng.post_json = AsyncMock(return_value={"status_code": 200, "data": payload})
    svc._bisheng.get_json = AsyncMock(return_value={"status_code": 200, "data": payload})
    return svc


@pytest.mark.asyncio
async def test_create_favorite_maps_response():
    svc = _svc({"favorite_file_id": 9, "space_id": 200, "source_space_id": 1,
                "source_file_id": 2, "title": "doc"})
    out = await svc.create_favorite(FavoriteDocumentRequest(source_space_id=1, source_file_id=2))
    assert out.favorite_file_id == 9 and out.space_id == 200 and out.title == "doc"


@pytest.mark.asyncio
async def test_favorite_status_maps_response():
    svc = _svc({"data": [{"space_id": 1, "file_id": 2, "favorited": True}]})
    out = await svc.favorite_status(FavoriteStatusRequest(items=[{"space_id": 1, "file_id": 2}]))
    assert out.data[0].favorited is True


@pytest.mark.asyncio
async def test_remove_favorite_maps_response():
    svc = _svc({"removed": True})
    out = await svc.remove_favorite(FavoriteRemoveRequest(source_space_id=1, source_file_id=2))
    assert out.removed is True


@pytest.mark.asyncio
async def test_list_favorites_maps_response():
    svc = _svc({"data": [{"favorite_file_id": 9, "source_space_id": 1, "source_file_id": 2,
                          "title": "doc", "file_name": "doc.pdf", "status": "invalid", "updated_at": ""}],
                "total": 1, "page": 1, "page_size": 20})
    out = await svc.list_favorites(page=1, page_size=20)
    assert out.total == 1 and out.data[0].status == "invalid"
