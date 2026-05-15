from pydantic import BaseModel, Field


class SpaceConfig(BaseModel):
    id: int
    name: str
    file_count: int = 0
    tag_count: int = 0
    space_level: str = "personal"
    enabled: bool = True


class DomainConfig(BaseModel):
    name: str
    space_ids: list[int] = Field(default_factory=list)
    color: str
    bg: str
    icon: str
    background_image: str = ""
    enabled: bool = True


class SectionConfig(BaseModel):
    title: str
    tag: str
    link: str
    icon: str
    color: str = "#2563eb"
    bg: str = "#eff6ff"
    enabled: bool = True


class QAConfig(BaseModel):
    knowledge_space_ids: list[int] = Field(default_factory=list)
    welcome_message: str = "你好，我是首钢股份知库智能助手，请问有什么可以帮您？"
    hot_questions: list[str] = Field(default_factory=list)
    ai_search_system_prompt: str = ""
    qa_system_prompt: str = ""
    selected_model: str = ""


class QAModelOption(BaseModel):
    key: str = ""
    id: str
    name: str = ""
    display_name: str = ""
    visual: bool = False


class QAModelOptionsResponse(BaseModel):
    selected_model: str = ""
    models: list[QAModelOption] = Field(default_factory=list)


class SpaceOption(BaseModel):
    id: int
    name: str
    description: str = ""
    file_count: int = 0
    space_level: str = "personal"


class SpaceOptionsResponse(BaseModel):
    options: list[SpaceOption] = Field(default_factory=list)


class SpaceFileItem(BaseModel):
    id: int
    name: str


class SpaceFilesResponse(BaseModel):
    space_id: int
    files: list[SpaceFileItem] = Field(default_factory=list)


class SpaceFolderItem(BaseModel):
    id: int
    name: str
    path: str = ""


class SpaceFoldersResponse(BaseModel):
    space_id: int
    folders: list[SpaceFolderItem] = Field(default_factory=list)


class RecommendationConfig(BaseModel):
    provider: str
    home_strategy: str
    detail_strategy: str


class DisplayHomeConfig(BaseModel):
    section_page_size: int = 6
    hot_tags_count: int = 8
    qa_hot_count: int = 4
    domain_count: int = 6
    spaces_count: int = 6
    apps_count: int = 6


class DisplayListConfig(BaseModel):
    page_size: int = 10
    visible_tag_count: int = 2


class DisplaySearchConfig(BaseModel):
    page_size: int = 10
    visible_tag_count: int = 2


class DisplayDetailConfig(BaseModel):
    related_files_count: int = 3
    visible_tag_count: int = 2


class DisplayConfig(BaseModel):
    home: DisplayHomeConfig
    list: DisplayListConfig
    search: DisplaySearchConfig
    detail: DisplayDetailConfig


class AppConfig(BaseModel):
    id: int
    name: str
    icon: str
    desc: str
    color: str
    bg: str
    url: str = ""
    enabled: bool = True


class BannerSlide(BaseModel):
    id: int
    label: str = ""
    title: str
    desc: str = ""
    image_url: str
    link_url: str = ""
    enabled: bool = True


class IntegrationsConfig(BaseModel):
    bisheng_admin_entry_url: str = ""
    bisheng_knowledge_entry_url: str = ""


class SiteConfig(BaseModel):
    header_brand_name: str = "首钢股份知库"
    header_logo_url: str = "/site-logo-new.png"
    login_brand_name: str = "首钢股份知库"
    login_logo_url: str = "/shougang-stock-logo.png"
    browser_title: str = "首钢股份知库"
    favicon_url: str = "/site-favicon-horizontal-v2.png"


class PortalConfig(BaseModel):
    spaces: list[SpaceConfig] = Field(default_factory=list)
    domains: list[DomainConfig] = Field(default_factory=list)
    sections: list[SectionConfig] = Field(default_factory=list)
    qa: QAConfig
    recommendation: RecommendationConfig
    display: DisplayConfig
    apps: list[AppConfig] = Field(default_factory=list)
    banners: list[BannerSlide] = Field(default_factory=list)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)
    site: SiteConfig = Field(default_factory=SiteConfig)


class SpacesConfigUpdate(BaseModel):
    spaces: list[SpaceConfig]


class DomainsConfigUpdate(BaseModel):
    domains: list[DomainConfig]


class SectionsConfigUpdate(BaseModel):
    sections: list[SectionConfig]


class AppsConfigUpdate(BaseModel):
    apps: list[AppConfig]


class BannersConfigUpdate(BaseModel):
    banners: list[BannerSlide]
