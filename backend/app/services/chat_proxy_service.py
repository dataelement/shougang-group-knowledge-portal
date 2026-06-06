import json
from collections.abc import AsyncIterator

from app.clients.bisheng import BishengClient
from app.schemas.chat import PortalChatCompletionRequest, UseKnowledgeBaseParam
from app.schemas.knowledge import KnowledgeFileItem
from app.services.portal_config_service import PortalConfigService


class ChatProxyService:
    _QA_MODE_PROMPT_FIELDS = {
        "quick": "quick_mode_system_prompt",
        "normal": "normal_mode_system_prompt",
        "expert": "expert_mode_system_prompt",
    }
    # 搜索助手：基于检索到的前 N 个文件摘要进行总结
    _SEARCH_SUMMARY_FILE_LIMIT = 10

    def __init__(
        self,
        bisheng_client: BishengClient,
        portal_config_service: PortalConfigService,
        default_model: str | None = None,
        is_anonymous: bool = False,
    ):
        self._bisheng = bisheng_client
        self._config_service = portal_config_service
        self._default_model = default_model or ""
        self._is_anonymous = is_anonymous

    async def stream_chat_completion(self, payload: PortalChatCompletionRequest) -> AsyncIterator[bytes]:
        path, request_body, trailing_events = await self.build_chat_request(payload)
        async for chunk in self.stream_prepared_chat_completion(path, request_body):
            yield chunk
        for event in trailing_events:
            yield event

    async def stream_prepared_chat_completion(self, path: str, request_body: dict) -> AsyncIterator[bytes]:
        async for chunk in self._bisheng.stream_post(path, json=request_body):
            yield chunk

    async def build_chat_request(
        self, payload: PortalChatCompletionRequest
    ) -> tuple[str, dict, list[bytes]]:
        config = self._config_service.get_config()
        scene = payload.scene if payload.scene in {"search", "qa"} else "qa"
        use_knowledge_base = payload.use_knowledge_base or UseKnowledgeBaseParam()
        request_body = payload.model_dump(exclude={"scene", "answer_mode", "space_level", "search_results"}, mode="json")

        if scene == "search":
            docs = payload.search_results[: self._SEARCH_SUMMARY_FILE_LIMIT]
            space_name_map = self._get_config_space_name_map()

            request_body["use_knowledge_base"] = {
                "personal_knowledge_enabled": False,
                "organization_knowledge_ids": [],
                "knowledge_space_ids": [],  # 关闭 RAG，仅依据给定摘要做归纳
            }
            request_body["search_enabled"] = False
            request_body["model"] = payload.model or config.qa.selected_model or self._default_model
            request_body["text"] = self._build_search_summary_prompt(
                config.qa.ai_search_system_prompt,
                payload.text,
                docs,
            )
            trailing_events = self._build_citation_events(docs, space_name_map)
            return "/api/v1/workstation/chat/completions", request_body, trailing_events

        requested_space_ids = self._normalize_space_ids(use_knowledge_base.knowledge_space_ids)
        if requested_space_ids:
            visible_space_ids = (
                self._get_anonymous_public_space_ids()
                if self._is_anonymous
                else await self._get_current_user_visible_space_ids()
            )
            invisible_space_ids = [space_id for space_id in requested_space_ids if space_id not in visible_space_ids]
            if invisible_space_ids:
                if self._is_anonymous:
                    raise PermissionError("未登录仅可使用公共知识库")
                raise PermissionError("包含无权限或不存在的知识库")
        request_body["use_knowledge_base"] = {
            "personal_knowledge_enabled": False if self._is_anonymous else use_knowledge_base.personal_knowledge_enabled,
            "organization_knowledge_ids": [] if self._is_anonymous else use_knowledge_base.organization_knowledge_ids,
            "knowledge_space_ids": requested_space_ids,
        }

        answer_mode = payload.answer_mode if payload.answer_mode in self._QA_MODE_PROMPT_FIELDS else "normal"
        if answer_mode == "expert":
            selected_model = config.qa.reasoning_model.strip()
            if not selected_model:
                raise ValueError("请先在后台配置推理模型")
        else:
            selected_model = (
                config.qa.general_model
                or config.qa.selected_model
                or self._default_model
            ).strip()

        prompt_field = self._QA_MODE_PROMPT_FIELDS[answer_mode]
        request_body["model"] = selected_model
        request_body["text"] = payload.text
        request_body["system_prompt"] = str(getattr(config.qa, prompt_field) or "")
        return "/api/v1/workstation/shougang-portal/chat/completions", request_body, []

    @staticmethod
    def _build_search_summary_prompt(
        instruction: str,
        query: str,
        docs: list[KnowledgeFileItem],
    ) -> str:
        base = (instruction or "").strip() or "你是知识库搜索助手，请基于检索到的资料进行归纳总结。"
        if docs:
            docs_block = "\n".join(
                f"{idx}. 《{doc.title}》：{(doc.summary or '').strip() or '（无摘要）'}"
                for idx, doc in enumerate(docs, start=1)
            )
        else:
            docs_block = "（未检索到相关文档）"
        common_rules = (
            "总结正文控制在 350 字以内；直接输出总结内容即可，"
            "不要输出字数统计，也不要附加任何与总结正文无关的说明。"
        )
        normalized_query = query.strip()
        if normalized_query:
            instruction_body = (
                "请仅依据下列检索到的文档摘要，对用户的搜索意图进行整体归纳总结，"
                "不要编造资料之外的内容；若资料不足以回答，请直接说明未找到相关内容。"
                f"{common_rules}\n\n"
                f"【用户搜索】{normalized_query}\n\n"
            )
        else:
            # 无用户问题（浏览模式）：对检索到的文档内容做整体概述
            instruction_body = (
                "请仅依据下列检索到的文档摘要，对这些文档的主要内容做整体概述与要点提炼，"
                "不要编造资料之外的内容。"
                f"{common_rules}\n\n"
            )
        return f"{base}\n\n{instruction_body}【检索到的文档摘要】\n{docs_block}"

    @staticmethod
    def _build_citation_events(
        docs: list[KnowledgeFileItem],
        space_name_map: dict[int, str],
    ) -> list[bytes]:
        if not docs:
            return []
        citations = [
            {
                "key": f"doc:{doc.id}",
                "itemId": str(doc.id),
                "sourcePayload": {
                    "knowledgeId": doc.space_id,
                    "knowledgeName": space_name_map.get(doc.space_id, doc.source),
                    "documentId": doc.id,
                    "documentName": doc.title,
                    "fileType": doc.file_ext,
                    "snippet": (doc.summary or "")[:200],
                },
            }
            for doc in docs
        ]
        payload = {"category": "stream", "type": "end", "citations": citations}
        event = f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
        return [event]

    def _get_config_space_name_map(self) -> dict[int, str]:
        config = self._config_service.get_config()
        return {space.id: space.name for space in config.spaces}

    async def _get_current_user_visible_space_ids(self) -> set[int]:
        from app.services.knowledge_service import KnowledgeService

        service = KnowledgeService(
            bisheng_client=self._bisheng,
            portal_config_service=self._config_service,
        )
        spaces = await service.list_visible_spaces()
        return {space.id for space in spaces.data}

    def _get_anonymous_public_space_ids(self) -> set[int]:
        config = self._config_service.get_config()
        return {
            space.id
            for space in config.spaces
            if space.enabled and (space.space_level or "").strip().lower() == "public"
        }

    @staticmethod
    def _normalize_space_ids(space_ids: list[int]) -> list[int]:
        normalized: list[int] = []
        seen: set[int] = set()
        for raw_id in space_ids:
            try:
                space_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            if space_id <= 0 or space_id in seen:
                continue
            normalized.append(space_id)
            seen.add(space_id)
        return normalized

    async def list_conversations(self, page: int = 1, limit: int = 20):
        payload = await self._bisheng.get_json(
            "/api/v1/chat/list",
            params={"page": page, "limit": limit},
        )
        return self._unwrap_bisheng_data(payload)

    async def get_conversation_messages(self, conversation_id: str):
        payload = await self._bisheng.get_json(
            f"/api/v1/workstation/messages/{conversation_id}/agent",
        )
        return self._unwrap_bisheng_data(payload)

    @staticmethod
    def _build_final_prompt(system_prompt: str, user_text: str) -> str:
        if not system_prompt.strip():
            return user_text
        return f"{system_prompt.strip()}\n\n用户问题：\n{user_text.strip()}"

    @staticmethod
    def _unwrap_bisheng_data(payload):
        if isinstance(payload, dict) and payload.get("status_code") not in (None, 200):
            raise ValueError(str(payload.get("status_message") or "BiSheng 请求失败"))
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload
