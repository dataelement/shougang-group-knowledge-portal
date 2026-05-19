from collections.abc import AsyncIterator

from app.clients.bisheng import BishengClient
from app.schemas.chat import PortalChatCompletionRequest, UseKnowledgeBaseParam
from app.services.knowledge_service import KnowledgeService
from app.services.portal_config_service import PortalConfigService


class ChatProxyService:
    _QA_MODE_PROMPT_FIELDS = {
        "quick": "quick_mode_system_prompt",
        "normal": "normal_mode_system_prompt",
        "expert": "expert_mode_system_prompt",
    }

    def __init__(
        self,
        bisheng_client: BishengClient,
        portal_config_service: PortalConfigService,
        default_model: str | None = None,
    ):
        self._bisheng = bisheng_client
        self._config_service = portal_config_service
        self._default_model = default_model or ""

    async def stream_chat_completion(self, payload: PortalChatCompletionRequest) -> AsyncIterator[bytes]:
        path, request_body = await self.build_chat_request(payload)
        async for chunk in self.stream_prepared_chat_completion(path, request_body):
            yield chunk

    async def stream_prepared_chat_completion(self, path: str, request_body: dict) -> AsyncIterator[bytes]:
        async for chunk in self._bisheng.stream_post(path, json=request_body):
            yield chunk

    async def build_chat_request(self, payload: PortalChatCompletionRequest) -> tuple[str, dict]:
        config = self._config_service.get_config()
        enabled_space_ids = {space.id for space in config.spaces if space.enabled}
        allowed_knowledge_space_ids = [
            space_id
            for space_id in config.qa.knowledge_space_ids
            if space_id in enabled_space_ids
        ]
        scene = payload.scene if payload.scene in {"search", "qa"} else "qa"
        use_knowledge_base = payload.use_knowledge_base or UseKnowledgeBaseParam()
        request_body = payload.model_dump(exclude={"scene", "answer_mode"}, mode="json")
        request_body["use_knowledge_base"] = {
            "personal_knowledge_enabled": use_knowledge_base.personal_knowledge_enabled,
            "organization_knowledge_ids": use_knowledge_base.organization_knowledge_ids,
            "knowledge_space_ids": allowed_knowledge_space_ids,
        }

        if scene == "search":
            selected_model = payload.model or config.qa.selected_model or self._default_model
            request_body["model"] = selected_model
            request_body["text"] = self._build_final_prompt(
                config.qa.ai_search_system_prompt,
                payload.text,
            )
            return "/api/v1/workstation/chat/completions", request_body

        requested_space_ids = self._normalize_space_ids(use_knowledge_base.knowledge_space_ids)
        has_chat_files = self._has_chat_files(payload.files)
        if not requested_space_ids and not has_chat_files:
            raise ValueError("请至少选择一个知识库")
        if requested_space_ids:
            visible_space_ids = await self._get_current_user_visible_space_ids()
            invisible_space_ids = [space_id for space_id in requested_space_ids if space_id not in visible_space_ids]
            if invisible_space_ids:
                raise PermissionError("包含无权限或不存在的知识库")
        request_body["use_knowledge_base"] = {
            "personal_knowledge_enabled": use_knowledge_base.personal_knowledge_enabled,
            "organization_knowledge_ids": use_knowledge_base.organization_knowledge_ids,
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
        return "/api/v1/workstation/shougang-portal/chat/completions", request_body

    async def _get_current_user_visible_space_ids(self) -> set[int]:
        service = KnowledgeService(
            bisheng_client=self._bisheng,
            portal_config_service=self._config_service,
        )
        spaces = await service.list_visible_spaces()
        return {space.id for space in spaces.data}

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

    @staticmethod
    def _has_chat_files(files: list[dict]) -> bool:
        return any(
            isinstance(item, dict)
            and (item.get("filepath") or item.get("file_id") or item.get("temp_file_id"))
            for item in files
        )

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
