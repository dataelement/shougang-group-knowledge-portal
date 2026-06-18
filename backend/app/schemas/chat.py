from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.knowledge import KnowledgeFileItem


class KnowledgeScopeFileRef(BaseModel):
    knowledge_space_id: int = Field(..., gt=0)
    file_id: int = Field(..., gt=0)


class KnowledgeScopeFolderRef(BaseModel):
    knowledge_space_id: int = Field(..., gt=0)
    folder_id: int = Field(..., gt=0)


class KnowledgeScopeParam(BaseModel):
    mode: Literal["none", "knowledge_space", "files"] = "none"
    knowledge_space_id: Optional[int] = Field(default=None, gt=0)
    folder_refs: list[KnowledgeScopeFolderRef] = Field(default_factory=list)
    file_refs: list[KnowledgeScopeFileRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_scope_shape(self):
        if self.mode == "knowledge_space" and not self.knowledge_space_id:
            raise ValueError("knowledge_space scope requires knowledge_space_id")
        return self


class UseKnowledgeBaseParam(BaseModel):
    personal_knowledge_enabled: bool = False
    organization_knowledge_ids: list[int] = Field(default_factory=list)
    knowledge_space_ids: list[int] = Field(default_factory=list)
    knowledge_scope: Optional[KnowledgeScopeParam] = None

    @field_validator("organization_knowledge_ids", "knowledge_space_ids", mode="before")
    @classmethod
    def normalize_id_list(cls, value):
        if value is None:
            return []
        return value


class PortalChatCompletionRequest(BaseModel):
    clientTimestamp: str
    model: str = ""
    scene: str = "qa"
    entry_point: str = ""
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
