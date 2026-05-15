from typing import Literal

from pydantic import BaseModel, Field


class KnowledgeFileItem(BaseModel):
    id: int
    space_id: int
    title: str
    summary: str
    source: str
    updated_at: str
    tags: list[str] = Field(default_factory=list)
    file_ext: str = ""
    file_size: str = ""
    file_encoding: str = ""


class KnowledgeFileSpace(BaseModel):
    id: int
    name: str


class KnowledgeFileDetail(KnowledgeFileItem):
    space: KnowledgeFileSpace


class PagedKnowledgeFileData(BaseModel):
    data: list[KnowledgeFileItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class RelatedKnowledgeFileData(BaseModel):
    data: list[KnowledgeFileItem] = Field(default_factory=list)
    total: int = 0


class HomeKnowledgeData(BaseModel):
    sections: dict[str, list[KnowledgeFileItem]] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class KnowledgeSpaceItem(BaseModel):
    id: int
    name: str
    description: str = ""
    auth_type: str = ""
    user_role: str = ""
    space_kind: str = "normal"
    department_name: str = ""
    file_count: int = 0
    member_count: int = 0
    is_pinned: bool = False
    updated_at: str = ""
    sources: list[str] = Field(default_factory=list)


class KnowledgeSpaceListData(BaseModel):
    data: list[KnowledgeSpaceItem] = Field(default_factory=list)
    total: int = 0


class FilePreviewData(BaseModel):
    original_url: str
    preview_url: str


FilePreviewMode = Literal["pdf", "docx", "spreadsheet", "markdown", "html", "text", "image", "unsupported", "chunks"]
FilePreviewSourceKind = Literal["preview_url", "original_url", "preview_task", "none"]


class FilePreviewManifest(BaseModel):
    mode: FilePreviewMode
    download_url: str = ""
    viewer_url: str = ""
    source_kind: FilePreviewSourceKind = "none"
    reason: str = ""
    supports_chunks_fallback: bool = False


class FileChunkItem(BaseModel):
    chunk_index: int
    text: str
