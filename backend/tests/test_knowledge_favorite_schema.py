import pytest
from pydantic import ValidationError
from app.schemas.knowledge import (
    FavoriteDocumentRequest, FavoriteStatusRequest, FavoriteFileItem, PersonalKnowledgeSpaceItem,
)


def test_request_has_no_target_space_id():
    req = FavoriteDocumentRequest(source_space_id=1, source_file_id=2)
    assert not hasattr(req, "target_space_id")


def test_status_request_parses():
    req = FavoriteStatusRequest(items=[{"space_id": 1, "file_id": 2}])
    assert req.items[0].space_id == 1


def test_personal_space_has_is_favorite_default_false():
    item = PersonalKnowledgeSpaceItem(id=1, name="x")
    assert item.is_favorite is False


def test_file_item_rejects_bad_status():
    with pytest.raises(ValidationError):
        FavoriteFileItem(favorite_file_id=1, source_space_id=1, source_file_id=2,
                         title="t", file_name="t", status="nope", updated_at="")
