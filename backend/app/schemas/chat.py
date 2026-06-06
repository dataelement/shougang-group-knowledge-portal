from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.knowledge import KnowledgeFileItem


class UseKnowledgeBaseParam(BaseModel):
    personal_knowledge_enabled: bool = False
    organization_knowledge_ids: list[int] = Field(default_factory=list)
    knowledge_space_ids: list[int] = Field(default_factory=list)


class PortalChatCompletionRequest(BaseModel):
    clientTimestamp: str
    model: str = ""
    scene: str = "qa"
    space_level: Optional[str] = None
    answer_mode: Literal["quick", "normal", "expert"] = "normal"
    conversationId: Optional[str] = None
    error: bool = False
    generation: str = ""
    isCreatedByUser: bool = False
    isContinued: bool = False
    text: str = ""
    search_enabled: bool = False
    use_knowledge_base: Optional[UseKnowledgeBaseParam] = None
    search_results: list[KnowledgeFileItem] = Field(default_factory=list)
    files: list[dict[str, Any]] = Field(default_factory=list)
    parentMessageId: Optional[str] = None
    overrideParentMessageId: Optional[str] = None
    responseMessageId: Optional[str] = None
