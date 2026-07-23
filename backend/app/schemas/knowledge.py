from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class FileTag(BaseModel):
    tag_name: str
    resource_type: str


class KnowledgeFileItem(BaseModel):
    id: int
    space_id: int
    space_level: str = ""
    title: str
    summary: str
    source: str
    updated_at: str
    tag_infos: list[Any] = Field(default_factory=list)
    file_ext: str = ""
    file_size: str = ""
    file_encoding: str = ""
    file_subcategory_code: str = ""
    folder_path: str = ""
    source_path: str = ""
    # Whether the current user may download this file. Forwarded from bisheng's
    # per-space effective download permission so the portal can hide the download
    # entry for view-only users.
    can_download: bool = False


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


class CursorKnowledgeFileData(BaseModel):
    data: list[KnowledgeFileItem] = Field(default_factory=list)
    has_more: bool = False
    next_cursor: Optional[str] = None


class RelatedKnowledgeFileData(BaseModel):
    data: list[KnowledgeFileItem] = Field(default_factory=list)
    total: int = 0


class HomeKnowledgeData(BaseModel):
    sections: dict[str, list[KnowledgeFileItem]] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class HomeStatsData(BaseModel):
    total_documents: int = 0
    read_count: int = 0
    favorite_count: int = 0
    qa_count: int = 0


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
    business_domain_codes: list[str] = Field(default_factory=list)


class KnowledgeSpaceListData(BaseModel):
    data: list[KnowledgeSpaceItem] = Field(default_factory=list)
    total: int = 0


class QaKnowledgeTreeNode(BaseModel):
    id: int
    space_id: int
    parent_id: int | None = None
    type: Literal["folder", "file"]
    name: str
    path: str = ""
    file_ext: str = ""
    selectable: bool = True
    disabled_reason: str = ""
    has_children: bool = False
    resolved_file_count: int = 0


class QaKnowledgeTreeNodeData(BaseModel):
    data: list[QaKnowledgeTreeNode] = Field(default_factory=list)
    page_size: int = 10
    has_more: bool = False
    next_cursor: str | None = None


class QaKnowledgeFolderStatsRequest(BaseModel):
    folder_ids: list[Annotated[int, Field(gt=0)]] = Field(
        ...,
        min_length=1,
        max_length=200,
    )


class QaKnowledgeFolderStatsItem(BaseModel):
    folder_id: int
    resolved_file_count: int = 0


class QaKnowledgeFolderStatsData(BaseModel):
    stats: list[QaKnowledgeFolderStatsItem] = Field(default_factory=list)


class PersonalKnowledgeSpaceItem(BaseModel):
    id: int
    name: str
    description: str = ""
    file_count: int = 0
    updated_at: str = ""
    is_favorite: bool = False


class PersonalKnowledgeSpaceListData(BaseModel):
    data: list[PersonalKnowledgeSpaceItem] = Field(default_factory=list)
    total: int = 0


class FavoriteDocumentRequest(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class FavoriteDocumentData(BaseModel):
    favorite_file_id: int = 0
    space_id: int = 0
    source_space_id: int = 0
    source_file_id: int = 0
    title: str = ""


class FavoriteRemoveRequest(BaseModel):
    source_space_id: int = Field(..., gt=0)
    source_file_id: int = Field(..., gt=0)


class FavoriteRemoveData(BaseModel):
    removed: bool = False


class FavoriteStatusItem(BaseModel):
    space_id: int = Field(..., gt=0)
    file_id: int = Field(..., gt=0)


class FavoriteStatusRequest(BaseModel):
    items: list[FavoriteStatusItem] = Field(default_factory=list)


class FavoriteStatusResultItem(BaseModel):
    space_id: int
    file_id: int
    favorited: bool = False


class FavoriteStatusData(BaseModel):
    data: list[FavoriteStatusResultItem] = Field(default_factory=list)


class FavoriteFileItem(BaseModel):
    favorite_file_id: int
    source_space_id: int
    source_file_id: int
    title: str = ""
    file_name: str = ""
    status: Literal["valid", "invalid"] = "valid"
    updated_at: str = ""


class FavoriteFilesData(BaseModel):
    data: list[FavoriteFileItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


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


class ShareDocumentAccessInternalData(ShareDocumentAccessData):
    download_grant: str = ""
    download_grant_expires_at: int | None = None


class DocumentFileChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    model: str = ""


class FilePreviewData(BaseModel):
    original_url: str
    preview_url: str
    # PDF rendition of a Word preview (LibreOffice-rendered by bisheng). Empty when
    # conversion failed or the file predates it — callers fall back to preview_url.
    pdf_preview_url: str = ""


class PortalHotSearchItem(BaseModel):
    rank: int = Field(ge=1, le=5)
    query: str = Field(min_length=1)


PortalSearchEntryPoint = Literal["search_page", "home_hot_keyword"]
PortalPreviewEntryPoint = Literal[
    "home_recommendation",
    "recommendation_list",
    "search",
    "knowledge_space",
    "direct",
    "favorite",
    "other",
]
PortalDownloadEntryPoint = Literal[
    "search",
    "knowledge_list",
    "detail",
    "home_recommendation",
    "favorite",
    "share",
    "expert_qa",
    "qa_citation",
    "other",
]
PortalRecommendationScene = Literal["personalized_v1", "latest_selected"]


class PortalSearchTelemetryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    entry_point: PortalSearchEntryPoint

    @field_validator("query", mode="before")
    @classmethod
    def normalize_query_whitespace(cls, value: Any) -> str:
        return " ".join(str(value or "").split())


FilePreviewMode = Literal["pdf", "docx", "spreadsheet", "markdown", "html", "text", "image", "unsupported", "chunks"]
FilePreviewSourceKind = Literal["pdf_preview_url", "preview_url", "original_url", "preview_task", "none"]


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


class DomainRef(BaseModel):
    code: str
    name: str


class PublishPrecheckRequest(BaseModel):
    file_encoding: str = ""
    target_space_id: int


class PublishPrecheckResult(BaseModel):
    allowed: bool
    reason_code: str
    message: str
    file_domain: Optional[DomainRef] = None
    space_domains: list[DomainRef] = Field(default_factory=list)
