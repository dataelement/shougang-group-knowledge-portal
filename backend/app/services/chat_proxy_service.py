import json
from collections.abc import AsyncIterator

from app.clients.bisheng import BishengClient
from app.schemas.chat import KnowledgeScopeParam, PortalChatCompletionRequest, UseKnowledgeBaseParam
from app.schemas.knowledge import KnowledgeFileItem
from app.services.error_messages import normalize_user_facing_message
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
        request_body = payload.model_dump(
            exclude={"scene", "entry_point", "answer_mode", "space_level", "search_results"},
            mode="json",
        )

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

        requested_space_ids, normalized_scope = self._normalize_qa_knowledge_scope(use_knowledge_base)
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
        if normalized_scope is not None:
            request_body["use_knowledge_base"]["knowledge_scope"] = normalized_scope.model_dump(mode="json")

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

    def _normalize_qa_knowledge_scope(
        self,
        use_knowledge_base: UseKnowledgeBaseParam,
    ) -> tuple[list[int], KnowledgeScopeParam | None]:
        scope = use_knowledge_base.knowledge_scope
        requested_space_ids = self._normalize_space_ids(use_knowledge_base.knowledge_space_ids)
        if scope is None:
            return requested_space_ids, None
        if scope.mode == "none":
            return [], scope
        if scope.mode == "knowledge_space":
            scope_space_id = int(scope.knowledge_space_id or 0)
            if scope_space_id <= 0:
                raise ValueError("一次最多可选择1个库进行问答。")
            if requested_space_ids and requested_space_ids != [scope_space_id]:
                raise ValueError("一次最多可选择1个库进行问答。")
            return [scope_space_id], scope
        if scope.mode != "files":
            return requested_space_ids, scope

        folder_refs = self._dedupe_scope_refs(scope.folder_refs, id_field="folder_id")
        file_refs = self._dedupe_scope_refs(scope.file_refs, id_field="file_id")
        if len(file_refs) > 20:
            raise ValueError("一次最多可选择20个文件进行问答。")
        scoped_space_ids = sorted(
            {
                *[ref.knowledge_space_id for ref in folder_refs],
                *[ref.knowledge_space_id for ref in file_refs],
            }
        )
        normalized_scope = scope.model_copy(update={"folder_refs": folder_refs, "file_refs": file_refs})
        return scoped_space_ids, normalized_scope

    @staticmethod
    def _dedupe_scope_refs(refs: list, id_field: str) -> list:
        normalized = []
        seen: set[tuple[int, int]] = set()
        for ref in refs:
            space_id = int(getattr(ref, "knowledge_space_id", 0) or 0)
            target_id = int(getattr(ref, id_field, 0) or 0)
            key = (space_id, target_id)
            if space_id <= 0 or target_id <= 0 or key in seen:
                continue
            normalized.append(ref)
            seen.add(key)
        return normalized

    async def list_conversations(self, page: int = 1, limit: int = 20):
        payload = await self._bisheng.get_json(
            "/api/v1/chat/list",
            params={"page": page, "limit": limit},
        )
        return self._unwrap_bisheng_data(payload)

    async def list_agent_workflow_conversations(self, page: int = 1, limit: int = 20):
        agents = await self.list_agent_workflows()
        if not agents:
            return []

        conversations: list[dict] = []
        seen_chat_ids: set[str] = set()
        for agent in agents:
            workflow_id = str(agent.get("workflow_id") or "").strip()
            if not workflow_id:
                continue
            payload = await self._bisheng.get_json(
                "/api/v1/workstation/app/conversations",
                params={"flow_id": workflow_id, "page": page, "limit": limit},
            )
            data = self._unwrap_bisheng_data(payload)
            raw_items = data.get("list") if isinstance(data, dict) else data
            if not isinstance(raw_items, list):
                continue
            for item in raw_items:
                if not isinstance(item, dict):
                    continue
                chat_id = str(item.get("chat_id") or item.get("conversationId") or "").strip()
                if not chat_id or chat_id in seen_chat_ids:
                    continue
                seen_chat_ids.add(chat_id)
                conversations.append(
                    {
                        "agent_id": agent.get("id"),
                        "agent_name": agent.get("name"),
                        "workflow_id": workflow_id,
                        "chat_id": chat_id,
                        "name": item.get("name") or item.get("title") or agent.get("name"),
                        "flow_id": item.get("flow_id") or workflow_id,
                        "flow_name": item.get("flow_name") or agent.get("name"),
                        "flow_type": item.get("flow_type") or 10,
                        "logo": item.get("logo") or "",
                        "latest_message": item.get("latest_message"),
                        "create_time": item.get("create_time") or item.get("createdAt") or "",
                        "update_time": item.get("update_time") or item.get("updateAt") or item.get("create_time") or "",
                    }
                )
        return conversations

    async def list_agent_workflows(self):
        config = self._config_service.get_config()
        configured_agents = [agent for agent in config.agent_config.agents if agent.enabled]
        workflow_ids = []
        seen_workflow_ids: set[str] = set()
        for agent in configured_agents:
            workflow_id = agent.workflow_id.strip()
            if not workflow_id or workflow_id in seen_workflow_ids:
                continue
            seen_workflow_ids.add(workflow_id)
            workflow_ids.append(workflow_id)
        if not workflow_ids:
            return []

        payload = await self._bisheng.post_json(
            "/api/v1/workstation/app/portal-agent-workflows",
            json={"workflow_ids": workflow_ids},
        )
        data = self._unwrap_bisheng_data(payload)
        raw_workflows = data.get("workflows") if isinstance(data, dict) else data
        if not isinstance(raw_workflows, list):
            return []

        visible_workflows: dict[str, dict] = {}
        for item in raw_workflows:
            if not isinstance(item, dict):
                continue
            workflow_id = str(item.get("id") or item.get("workflow_id") or "").strip()
            if workflow_id:
                visible_workflows[workflow_id] = item

        result = []
        for agent in configured_agents:
            workflow = visible_workflows.get(agent.workflow_id)
            if not workflow:
                continue
            agent_data = agent.model_dump()
            agent_data["tags"] = self._normalize_agent_workflow_tags(workflow.get("tags"))
            result.append(agent_data)
        return result

    async def get_conversation_messages(self, conversation_id: str):
        payload = await self._bisheng.get_json(
            f"/api/v1/workstation/messages/{conversation_id}/agent",
        )
        return self._unwrap_bisheng_data(payload)

    async def list_agent_favorite_workflow_ids(self) -> dict[str, list[str]]:
        payload = await self._bisheng.get_json("/api/v1/workstation/app/portal-agent-favorites")
        data = self._unwrap_bisheng_data(payload)
        raw_ids = data.get("workflow_ids") if isinstance(data, dict) else []
        workflow_ids: list[str] = []
        seen: set[str] = set()
        if isinstance(raw_ids, list):
            for raw_id in raw_ids:
                workflow_id = str(raw_id or "").strip()
                if not workflow_id or workflow_id in seen:
                    continue
                seen.add(workflow_id)
                workflow_ids.append(workflow_id)
        return {"workflow_ids": workflow_ids}

    async def add_agent_favorite_workflow(self, workflow_id: str):
        safe_workflow_id = workflow_id.strip()
        if not safe_workflow_id:
            raise ValueError("workflow_id 不能为空")
        payload = await self._bisheng.post_json(
            "/api/v1/workstation/app/portal-agent-favorites",
            json={"workflow_id": safe_workflow_id},
        )
        return self._unwrap_bisheng_data(payload)

    async def delete_agent_favorite_workflow(self, workflow_id: str):
        safe_workflow_id = workflow_id.strip()
        if not safe_workflow_id:
            raise ValueError("workflow_id 不能为空")
        payload = await self._bisheng.delete_json(
            "/api/v1/workstation/app/portal-agent-favorites",
            json={"workflow_id": safe_workflow_id},
        )
        return self._unwrap_bisheng_data(payload)

    @staticmethod
    def _normalize_agent_workflow_tags(raw_tags) -> list[str]:
        if not isinstance(raw_tags, list):
            return []
        normalized = []
        seen = set()
        for raw_tag in raw_tags:
            if isinstance(raw_tag, str):
                tag_name = raw_tag.strip()
            elif isinstance(raw_tag, dict):
                tag_name = str(raw_tag.get("name") or raw_tag.get("tag_name") or "").strip()
            else:
                tag_name = str(getattr(raw_tag, "name", "") or "").strip()
            if not tag_name or tag_name in seen:
                continue
            seen.add(tag_name)
            normalized.append(tag_name)
        return normalized

    @staticmethod
    def _build_final_prompt(system_prompt: str, user_text: str) -> str:
        if not system_prompt.strip():
            return user_text
        return f"{system_prompt.strip()}\n\n用户问题：\n{user_text.strip()}"

    @staticmethod
    def _unwrap_bisheng_data(payload):
        if isinstance(payload, dict) and payload.get("status_code") not in (None, 200):
            status_code = payload.get("status_code")
            raise ValueError(
                normalize_user_facing_message(
                    payload.get("status_message"),
                    fallback="BiSheng 请求失败",
                    status_code=int(status_code) if isinstance(status_code, int) else None,
                )
            )
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload
