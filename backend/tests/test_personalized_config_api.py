from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dependencies import require_admin_session
from app.config.portal_config import DEFAULT_PORTAL_CONFIG
from app.main import app
from app.schemas.auth import PortalUserView
from app.schemas.portal_config import PortalConfig, RecommendationConfig
from app.services.config_store import ConfigStoreWriteResult, InMemoryConfigStore
from app.services.portal_config_service import PortalConfigService


class VersionedConfigStore(InMemoryConfigStore):
    """Small test store that mirrors the remote aggregate's monotonic version."""

    def __init__(self) -> None:
        super().__init__()
        self.version = 0

    def upsert_document(
        self,
        table_name: str,
        payload: dict,
    ) -> ConfigStoreWriteResult:
        result = super().upsert_document(table_name, payload)
        if table_name == "portal_config":
            self.version += 1
        return ConfigStoreWriteResult(document=result.document, version=self.version)


def _admin_session():
    return SimpleNamespace(
        user=PortalUserView(
            account="portal-admin",
            name="门户管理员",
            initial="门",
            role="管理员",
            external_id="",
            login_at=1,
        )
    )


@pytest.fixture(autouse=True)
def allow_admin_access():
    app.dependency_overrides[require_admin_session] = _admin_session
    yield
    app.dependency_overrides.pop(require_admin_session, None)


def _recommendation_payload(**updates) -> dict:
    payload = deepcopy(DEFAULT_PORTAL_CONFIG["recommendation"])
    payload.update(updates)
    return payload


def test_recommendation_config_backfills_personalization_defaults(tmp_path: Path):
    store = InMemoryConfigStore()
    legacy = deepcopy(DEFAULT_PORTAL_CONFIG)
    legacy["recommendation"] = {
        "provider": "tag_feed",
        "home_strategy": "tag+updated_at",
        "detail_strategy": "shared_tags+updated_at",
    }
    store.upsert_document("portal_config", legacy)

    config = PortalConfigService(
        config_path=tmp_path / "portal_config.json",
        store=store,
    ).get_config()

    assert config.recommendation.model_dump() == DEFAULT_PORTAL_CONFIG["recommendation"]
    assert all(domain.department_ids == [] for domain in config.domains)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("home_total_count", 0),
        ("home_total_count", 51),
        ("hot_half_life_days", 0),
        ("hot_half_life_days", 91),
        ("home_entry_source_weight", -0.01),
        ("home_entry_source_weight", 1.01),
        ("stable_shuffle_score_gap", -0.01),
        ("stable_shuffle_score_gap", 100.01),
        ("stable_shuffle_cycle_days", 0),
        ("stable_shuffle_cycle_days", 31),
        ("personalized_rollout_percent", -1),
        ("personalized_rollout_percent", 101),
    ],
)
def test_recommendation_config_rejects_out_of_range_values(field: str, value: float):
    with pytest.raises(ValidationError):
        RecommendationConfig.model_validate(_recommendation_payload(**{field: value}))


def test_recommendation_config_accepts_documented_boundaries():
    minimum = RecommendationConfig.model_validate(
        _recommendation_payload(
            home_total_count=1,
            hot_half_life_days=1,
            home_entry_source_weight=0,
            stable_shuffle_score_gap=0,
            stable_shuffle_cycle_days=1,
            personalized_rollout_percent=0,
        )
    )
    maximum = RecommendationConfig.model_validate(
        _recommendation_payload(
            home_total_count=50,
            hot_half_life_days=90,
            home_entry_source_weight=1,
            stable_shuffle_score_gap=100,
            stable_shuffle_cycle_days=30,
            personalized_rollout_percent=100,
        )
    )

    assert minimum.home_total_count == 1
    assert maximum.personalized_rollout_percent == 100


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("home_total_count", "20"),
        ("hot_half_life_days", True),
        ("stable_shuffle_cycle_days", 7.0),
        ("personalized_rollout_percent", "10"),
        ("personalized_shadow_enabled", 1),
        ("home_entry_source_weight", float("nan")),
        ("stable_shuffle_score_gap", float("inf")),
    ],
)
def test_recommendation_config_rejects_coerced_or_non_finite_values(field: str, value):
    with pytest.raises(ValidationError):
        RecommendationConfig.model_validate(_recommendation_payload(**{field: value}))


def test_portal_config_requires_section_page_size_not_exceed_top_n():
    payload = deepcopy(DEFAULT_PORTAL_CONFIG)
    payload["display"]["home"]["section_page_size"] = 7
    payload["recommendation"]["home_total_count"] = 6

    with pytest.raises(ValidationError, match="home_total_count"):
        PortalConfig.model_validate(payload)

    payload["recommendation"]["home_total_count"] = 7
    assert PortalConfig.model_validate(payload).recommendation.home_total_count == 7


def test_recommendation_post_returns_version_and_rejects_top_n_below_home_section(
    tmp_path: Path,
):
    store = VersionedConfigStore()
    service = PortalConfigService(
        config_path=tmp_path / "portal_config.json",
        store=store,
    )

    with TestClient(app) as client:
        client.app.state.portal_config_service = service
        invalid = client.post(
            "/api/v1/admin/config/recommendation",
            json=_recommendation_payload(home_total_count=5),
        )
        previous_version = service.get_config_version()
        valid = client.post(
            "/api/v1/admin/config/recommendation",
            json=_recommendation_payload(
                home_total_count=30,
                personalized_shadow_enabled=True,
                personalized_rollout_percent=25,
            ),
        )

    assert invalid.status_code == 422
    assert valid.status_code == 200
    assert valid.json()["data"]["recommendation"]["home_total_count"] == 30
    assert valid.json()["data"]["recommendation"]["personalized_shadow_enabled"] is True
    assert valid.json()["data"]["recommendation"]["personalized_rollout_percent"] == 25
    assert valid.json()["data"]["version"] == previous_version + 1
