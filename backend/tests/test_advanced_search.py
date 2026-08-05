import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.schemas.knowledge import KnowledgeSpaceItem
from app.services.knowledge_service import KnowledgeService


def _mock_allowed_spaces(service: KnowledgeService, space_ids: list[int], *, space_level: str = "public") -> None:
    async def fake_allowed_spaces(**kwargs):
        return [
            KnowledgeSpaceItem(id=space_id, name=f"space-{space_id}", space_level=space_level)
            for space_id in space_ids
        ]

    service._allowed_spaces = fake_allowed_spaces  # type: ignore[method-assign]


def test_advanced_search_calls_dedicated_bisheng_endpoint():
    service = KnowledgeService.__new__(KnowledgeService)
    service._bisheng = AsyncMock()
    _mock_allowed_spaces(service, [12], space_level="department")
    service._bisheng.post_json = AsyncMock(
        return_value={
            "status_code": 200,
            "data": {
                "data": [],
                "has_more": False,
                "next_cursor": None,
            },
        }
    )

    result = asyncio.run(
        service.advanced_search_files(
            tag="振动",
            requested_space_ids=[12],
            space_level="department",
            file_ext="pdf",
            document_type="RPT",
            file_subcategory_code="RPT-A",
            business_domain_code="PM",
            all_keywords="轧机 振动",
            exact_phrase="故障排查",
            any_keywords="轴承 松动",
            exclude_keywords="招标",
            search_field="file_name",
            updated_from="2025-01-01",
            updated_to="2025-12-31",
            sort="updated_at_desc",
            cursor=None,
            limit=20,
            extra_space_ids=[12],
            discovery_scope="public_and_department",
        )
    )

    service._bisheng.post_json.assert_awaited_once()
    path, = service._bisheng.post_json.await_args.args
    body = service._bisheng.post_json.await_args.kwargs["json"]
    assert path == "/api/v1/knowledge/shougang-portal/files/advanced-search"
    assert body["all_keywords"] == "轧机 振动"
    assert body["search_field"] == "file_name"
    assert body["updated_to"] == "2025-12-31"
    assert result.data == []
    assert result.has_more is False


def test_ordinary_keyword_search_keeps_using_rag_endpoint():
    service = KnowledgeService.__new__(KnowledgeService)
    service._bisheng = AsyncMock()
    _mock_allowed_spaces(service, [12], space_level="department")
    service._config_service = SimpleNamespace(
        get_config=lambda: SimpleNamespace(
            search=SimpleNamespace(rerank_model_id=""),
        )
    )
    service._bisheng.post_json = AsyncMock(
        return_value={
            "status_code": 200,
            "data": {
                "data": [],
                "has_more": False,
                "next_cursor": None,
            },
        }
    )

    asyncio.run(
        service.search_keyword_files(
            q="轧机振动",
            tag=None,
            base_tag=None,
            requested_space_ids=[12],
            space_level="department",
            file_ext=None,
            document_type=None,
            file_subcategory_code=None,
            business_domain_code=None,
            sort="relevance",
            cursor=None,
            limit=50,
            extra_space_ids=[12],
            discovery_scope="public_and_department",
        )
    )

    path, = service._bisheng.post_json.await_args.args
    assert path == "/api/v1/knowledge/shougang-portal/files/search"


def test_discovery_scope_space_ids_intersect_requested_with_visible_spaces():
    service = KnowledgeService.__new__(KnowledgeService)
    _mock_allowed_spaces(service, [12, 18], space_level="public")

    resolved = asyncio.run(
        service._resolve_discovery_scope_space_ids(
            requested_space_ids=[12, 99],
            space_level=None,
            extra_space_ids=[12, 18, 7103],
        )
    )

    assert resolved == [12]


def test_discovery_scope_space_ids_returns_empty_when_no_overlap():
    service = KnowledgeService.__new__(KnowledgeService)
    _mock_allowed_spaces(service, [12], space_level="public")

    resolved = asyncio.run(
        service._resolve_discovery_scope_space_ids(
            requested_space_ids=[99],
            space_level=None,
            extra_space_ids=[12],
        )
    )

    assert resolved == []
