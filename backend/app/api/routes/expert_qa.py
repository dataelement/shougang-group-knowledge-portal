from __future__ import annotations

import logging
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_bisheng_client
from app.clients.bisheng import BishengClient
from app.schemas.common import response_error, response_ok

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/expert-qa", tags=["expert-qa"])

EXPERT_QUESTIONS_PATH = "/api/v1/qa_experts/questions"


class ExpertQaUpstreamError(RuntimeError):
    """BiSheng 返回无法安全转换的专家问题响应。"""


def _public_question_items(payload: Any) -> list[dict[str, int | str]]:
    if not isinstance(payload, dict):
        raise ExpertQaUpstreamError("upstream response is not an object")
    if payload.get("status_code") != 200:
        raise ExpertQaUpstreamError("upstream business response failed")

    data = payload.get("data")
    if not isinstance(data, dict):
        raise ExpertQaUpstreamError("upstream data is not an object")

    raw_questions = data.get("questions")
    if not isinstance(raw_questions, list):
        raise ExpertQaUpstreamError("upstream questions is not a list")

    questions: list[dict[str, int | str]] = []
    for item in raw_questions:
        if not isinstance(item, dict):
            continue
        question_id = item.get("id")
        title = item.get("title")
        if isinstance(question_id, bool) or not isinstance(question_id, int):
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        questions.append({"id": question_id, "title": title})
    return questions


@router.get("/home-questions")
async def list_public_home_questions(
    client: Annotated[BishengClient, Depends(get_bisheng_client)],
    limit: Annotated[int, Query(ge=1, le=100)] = 8,
):
    try:
        payload = await client.get_json(
            EXPERT_QUESTIONS_PATH,
            params={
                "page": 1,
                "page_size": limit,
                "sort_by": "latest",
            },
        )
        return response_ok({"questions": _public_question_items(payload)})
    except httpx.TimeoutException:
        logger.warning("expert QA home request timed out", exc_info=True)
        return response_error("专家问答服务请求超时，请稍后重试", status_code=504)
    except httpx.HTTPError:
        logger.warning("expert QA home request failed", exc_info=True)
        return response_error("专家问答服务暂时不可用，请稍后重试", status_code=502)
    except ExpertQaUpstreamError:
        logger.warning("expert QA home response is invalid", exc_info=True)
        return response_error("专家问答服务暂时不可用，请稍后重试", status_code=502)
