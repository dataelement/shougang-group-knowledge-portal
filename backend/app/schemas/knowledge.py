from typing import Literal

from pydantic import BaseModel, Field


class FileTag(BaseModel):
    tag_name: str
    resource_type: str


class KnowledgeFileItem(BaseModel):
    id: int
    space_id: int
    title: str
    summary: str
    source: str
    updated_at: str
    tags: list[FileTag] = Field(default_factory=list)
    file_ext: str = ""
    file_size: str = ""
    file_encoding: str = ""
    folder_path: str = ""
    source_path: str = ""


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
    space_level: str = ""
    department_name: str = ""
    file_count: int = 0
    member_count: int = 0
    is_pinned: bool = False
    updated_at: str = ""
    sources: list[str] = Field(default_factory=list)


class KnowledgeSpaceListData(BaseModel):
    data: list[KnowledgeSpaceItem] = Field(default_factory=list)
    total: int = 0


class PersonalKnowledgeSpaceItem(BaseModel):
    id: int
    name: str
    description: str = ""
    file_count: int = 0
    updated_at: str = ""


class PersonalKnowledgeSpaceListData(BaseModel):
    data: list[PersonalKnowledgeSpaceItem] = Field(default_factory=list)
    total: int = 0


class FavoriteDocumentRequest(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)
    target_space_id: int = Field(..., gt=0)


class FavoriteDocumentData(BaseModel):
    file_id: int
    space_id: int
    title: str = ""


ShareDocumentType = Literal["link", "invite_code"]
ShareDocumentVisibility = Literal["department", "public"]


class ShareDocumentPermissions(BaseModel):
    view: bool = True
    download: bool = False
    upload: bool = False


class ShareDocumentRequest(BaseModel):
    space_id: int = Field(..., gt=0)
    file_id: int = Field(..., gt=0)
    share_type: ShareDocumentType = "link"
    visibility: ShareDocumentVisibility = "department"
    allow_download: bool = False
    password: str = Field(default="", max_length=128)
    expire_seconds: int = Field(default=0, ge=0, le=31_536_000)


class ShareDocumentData(BaseModel):
    share_token: str
    link: str
    invite_code: str = ""
    expire_seconds: int = 0


class ShareDocumentMeta(BaseModel):
    share_token: str
    file_name: str = ""
    share_type: ShareDocumentType = "link"
    visibility: ShareDocumentVisibility = "department"
    permissions: ShareDocumentPermissions = Field(default_factory=ShareDocumentPermissions)
    requires_password: bool = False
    requires_invite_code: bool = False
    expired: bool = False


class ShareDocumentAccessRequest(BaseModel):
    password: str = Field(default="", max_length=128)
    invite_code: str = Field(default="", max_length=32)


class ShareDocumentAccessData(BaseModel):
    share_token: str
    space_id: int
    file_id: int
    allow_download: bool = False


class DocumentFileChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    model: str = ""


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
