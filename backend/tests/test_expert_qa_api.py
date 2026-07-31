from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_bisheng_client
from app.api.router import api_router
from app.api.routes.expert_qa import router as expert_qa_router


class FakeExpertQaClient:
    def __init__(self, payload: dict):
        self.payload = payload
        self.calls: list[tuple[str, dict | None]] = []

    async def get_json(self, path: str, params: dict | None = None) -> dict:
        self.calls.append((path, params))
        return self.payload


def _build_client(fake: FakeExpertQaClient) -> TestClient:
    app = FastAPI()
    app.include_router(expert_qa_router)
    app.dependency_overrides[get_bisheng_client] = lambda: fake
    return TestClient(app)


def test_expert_qa_home_route_is_registered():
    assert any(
        route.path == "/api/v1/expert-qa/home-questions" for route in api_router.routes
    )


def test_anonymous_home_questions_return_only_public_fields():
    fake = FakeExpertQaClient(
        {
            "status_code": 200,
            "data": {
                "questions": [
                    {
                        "id": 7,
                        "title": "高炉检修有哪些注意事项？",
                        "user_id": 998,
                        "description": "不得公开",
                        "vote_count": 10,
                    },
                    {"id": 8, "title": "能源数据如何核验？"},
                ],
                "total": 2,
            },
        }
    )

    with _build_client(fake) as client:
        response = client.get("/api/v1/expert-qa/home-questions?limit=2")

    assert response.status_code == 200
    assert response.json()["data"] == {
        "questions": [
            {"id": 7, "title": "高炉检修有哪些注意事项？"},
            {"id": 8, "title": "能源数据如何核验？"},
        ]
    }
    assert fake.calls == [
        (
            "/api/v1/qa_experts/questions",
            {"page": 1, "page_size": 2, "sort_by": "latest"},
        )
    ]


def test_home_questions_reject_invalid_limit_before_upstream_call():
    fake = FakeExpertQaClient({"status_code": 200, "data": {"questions": []}})

    with _build_client(fake) as client:
        response = client.get("/api/v1/expert-qa/home-questions?limit=101")

    assert response.status_code == 422
    assert fake.calls == []


def test_home_questions_hide_upstream_business_error():
    fake = FakeExpertQaClient(
        {
            "status_code": 403,
            "status_message": "internal permission details",
            "data": {"secret": "must-not-leak"},
        }
    )

    with _build_client(fake) as client:
        response = client.get("/api/v1/expert-qa/home-questions")

    assert response.status_code == 502
    body = response.json()
    assert body["status_message"] == "专家问答服务暂时不可用，请稍后重试"
    assert "internal permission details" not in response.text
    assert "must-not-leak" not in response.text
