from pydantic import BaseModel, Field, field_validator, model_validator


_HIDDEN_TEXT_CHARS = "\u200b\u200c\u200d\ufeff"


def _clean_config_text(value: str) -> str:
    return str(value or "").translate({ord(char): None for char in _HIDDEN_TEXT_CHARS}).strip()


DEFAULT_QUICK_MODE_SYSTEM_PROMPT = (
    "你是首钢知识门户的快速问答助手。请优先给出简洁结论，结合知识库依据回答，"
    "控制篇幅，避免展开无关背景；如果依据不足，请明确说明。"
)
DEFAULT_NORMAL_MODE_SYSTEM_PROMPT = (
    "你是首钢知识门户的专业问答助手。请结合知识库内容，用准确、克制、可执行的中文回答问题。"
    "优先给出结论、依据、操作建议和风险提示；若知识库中没有足够依据，请明确说明并建议进一步核实。"
)
DEFAULT_EXPERT_MODE_SYSTEM_PROMPT = (
    "你是首钢知识门户的专家问答助手。请基于知识库和推理能力分析复杂问题，"
    "按背景、判断依据、关键步骤、风险边界和建议方案组织回答；不要编造知识库中没有依据的事实。"
)


class DomainConfig(BaseModel):
    name: str
    space_ids: list[int] = Field(default_factory=list)
    color: str
    bg: str
    icon: str
    background_image: str = ""
    enabled: bool = True
    code: str = ""


class SectionConfig(BaseModel):
    title: str
    tag: str
    link: str
    icon: str
    builtin_key: str = ""
    color: str = "#2563eb"
    bg: str = "#eff6ff"
    enabled: bool = True


class QATemplateCategoryConfig(BaseModel):
    id: str
    name: str
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.name = self.name.strip()
        if not self.id:
            raise ValueError("Template category id is required")
        if not self.name:
            raise ValueError("Template category name is required")
        return self


class QATemplateConfig(BaseModel):
    id: str
    name: str
    desc: str = ""
    category_id: str
    prompt: str
    icon: str
    home_icon: str = ""
    color: str
    bg: str
    enabled: bool = True
    show_on_home: bool = False

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.name = self.name.strip()
        self.desc = self.desc.strip()
        self.category_id = self.category_id.strip()
        self.prompt = self.prompt.strip()
        self.icon = self.icon.strip()
        self.home_icon = self.home_icon.strip()
        self.color = self.color.strip()
        self.bg = self.bg.strip()
        if not self.id:
            raise ValueError("Template id is required")
        if not self.name:
            raise ValueError("Template name is required")
        if not self.category_id:
            raise ValueError("Template category is required")
        if not self.prompt:
            raise ValueError("Template prompt is required")
        if not self.icon:
            raise ValueError("Template icon is required")
        if not self.color:
            raise ValueError("Template color is required")
        if not self.bg:
            raise ValueError("Template background color is required")
        return self


class QAConfig(BaseModel):
    welcome_message: str = "你好，我是首钢股份知库智能助手，请问有什么可以帮您？"
    hot_questions: list[str] = Field(default_factory=list)
    ai_search_system_prompt: str = ""
    qa_system_prompt: str = ""
    quick_mode_system_prompt: str = DEFAULT_QUICK_MODE_SYSTEM_PROMPT
    normal_mode_system_prompt: str = DEFAULT_NORMAL_MODE_SYSTEM_PROMPT
    expert_mode_system_prompt: str = DEFAULT_EXPERT_MODE_SYSTEM_PROMPT
    selected_model: str = ""
    general_model: str = ""
    reasoning_model: str = ""
    general_model_display_name: str = ""
    reasoning_model_display_name: str = ""
    template_categories: list[QATemplateCategoryConfig] = Field(default_factory=list)
    templates: list[QATemplateConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_and_validate(self):
        if not self.general_model and self.selected_model:
            self.general_model = self.selected_model
        if not self.selected_model and self.general_model:
            self.selected_model = self.general_model
        category_ids = [category.id for category in self.template_categories]
        duplicate_category_ids = {category_id for category_id in category_ids if category_ids.count(category_id) > 1}
        if duplicate_category_ids:
            raise ValueError("Template category ids must be unique")
        template_ids = [template.id for template in self.templates]
        duplicate_template_ids = {template_id for template_id in template_ids if template_ids.count(template_id) > 1}
        if duplicate_template_ids:
            raise ValueError("Template ids must be unique")
        valid_category_ids = set(category_ids)
        orphan_templates = [
            template.id
            for template in self.templates
            if template.category_id not in valid_category_ids
        ]
        if orphan_templates:
            raise ValueError("Template category must exist")
        return self


class QAModelOption(BaseModel):
    key: str = ""
    id: str
    name: str = ""
    display_name: str = ""
    visual: bool = False
    provider_name: str = ""
    status: int = 0


class QAModelOptionsResponse(BaseModel):
    selected_model: str = ""
    general_model: str = ""
    reasoning_model: str = ""
    general_model_display_name: str = ""
    reasoning_model_display_name: str = ""
    models: list[QAModelOption] = Field(default_factory=list)


class AgentCategoryConfig(BaseModel):
    id: str
    name: str
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.name = self.name.strip()
        if not self.id:
            raise ValueError("Agent category id is required")
        if not self.name:
            raise ValueError("Agent category name is required")
        return self


class AgentItemConfig(BaseModel):
    id: str
    workflow_id: str
    name: str
    desc: str = ""
    category_id: str
    tags: list[str] = Field(default_factory=list)
    icon: str
    color: str
    bg: str
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.workflow_id = self.workflow_id.strip()
        self.name = self.name.strip()
        self.desc = self.desc.strip()
        self.category_id = self.category_id.strip()
        self.tags = [tag.strip() for tag in self.tags if tag.strip()]
        self.icon = self.icon.strip()
        self.color = self.color.strip()
        self.bg = self.bg.strip()
        if not self.id:
            raise ValueError("Agent id is required")
        if not self.workflow_id:
            raise ValueError("Agent workflow_id is required")
        if not self.name:
            raise ValueError("Agent name is required")
        if not self.category_id:
            raise ValueError("Agent category is required")
        if not self.icon:
            raise ValueError("Agent icon is required")
        if not self.color:
            raise ValueError("Agent color is required")
        if not self.bg:
            raise ValueError("Agent background color is required")
        return self


class AgentConfig(BaseModel):
    categories: list[AgentCategoryConfig] = Field(default_factory=list)
    agents: list[AgentItemConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalize_and_validate(self):
        category_ids = [category.id for category in self.categories]
        duplicate_category_ids = {category_id for category_id in category_ids if category_ids.count(category_id) > 1}
        if duplicate_category_ids:
            raise ValueError("Agent category ids must be unique")
        agent_ids = [agent.id for agent in self.agents]
        duplicate_agent_ids = {agent_id for agent_id in agent_ids if agent_ids.count(agent_id) > 1}
        if duplicate_agent_ids:
            raise ValueError("Agent ids must be unique")
        workflow_ids = [agent.workflow_id for agent in self.agents]
        duplicate_workflow_ids = {workflow_id for workflow_id in workflow_ids if workflow_ids.count(workflow_id) > 1}
        if duplicate_workflow_ids:
            raise ValueError("Agent workflow_ids must be unique")
        valid_category_ids = set(category_ids)
        orphan_agents = [
            agent.id
            for agent in self.agents
            if agent.category_id not in valid_category_ids
        ]
        if orphan_agents:
            raise ValueError("Agent category must exist")
        return self


class AgentWorkflowOption(BaseModel):
    workflow_id: str
    name: str
    desc: str = ""
    flow_type: int = 10
    status: int = 2


class AgentWorkflowOptionsResponse(BaseModel):
    workflows: list[AgentWorkflowOption] = Field(default_factory=list)
    has_more: bool = False
    next_cursor: str = ""


class SearchConfig(BaseModel):
    rerank_model_id: str = ""


class SearchRerankModelOptionsResponse(BaseModel):
    rerank_model_id: str = ""
    models: list[QAModelOption] = Field(default_factory=list)


class DocumentTypeChildConfig(BaseModel):
    code: str = ""
    label: str = ""

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return _clean_config_text(value).upper()

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value):
        return _clean_config_text(value)

    @model_validator(mode="after")
    def validate_required_fields(self):
        if not self.code:
            raise ValueError("Document type child code is required")
        if not self.label:
            raise ValueError("Document type child label is required")
        return self


class DocumentTypeConfig(BaseModel):
    code: str = ""
    label: str = ""
    children: list[DocumentTypeChildConfig] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def fill_legacy_children(cls, value):
        if isinstance(value, dict) and "children" not in value:
            code = _clean_config_text(value.get("code")).upper()
            label = _clean_config_text(value.get("label"))
            if code and label:
                return {**value, "children": [{"code": code, "label": label}]}
        return value

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return _clean_config_text(value).upper()

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value):
        return _clean_config_text(value)

    @model_validator(mode="after")
    def normalize_and_validate(self):
        if not self.code:
            raise ValueError("Document type code is required")
        if not self.label:
            raise ValueError("Document type label is required")
        if not self.children:
            raise ValueError("Document type children are required")
        child_codes = [child.code for child in self.children]
        duplicate_child_codes = {code for code in child_codes if child_codes.count(code) > 1}
        if duplicate_child_codes:
            raise ValueError("Document type child codes must be unique")
        return self


class SpaceOption(BaseModel):
    id: int
    name: str
    description: str = ""
    file_count: int = 0
    space_level: str = "personal"
    business_domain_codes: list[str] = Field(default_factory=list)


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
    domain_count_cache_ttl_seconds: int = 43200


DEFAULT_DOCUMENT_TYPES: list[dict[str, str]] = [
    {"code": "POL", "label": "政策制度"},
    {"code": "STD", "label": "标准规范"},
    {"code": "PRO", "label": "流程与程序"},
    {"code": "SPC", "label": "技术规程与诀窍"},
    {"code": "RPT", "label": "报告"},
    {"code": "CAS", "label": "案例"},
    {"code": "DGN", "label": "设计资产"},
    {"code": "PAT", "label": "专利与知识产权"},
    {"code": "TRN", "label": "培训资源"},
    {"code": "NEW", "label": "行业情报"},
]


class PortalConfig(BaseModel):
    domains: list[DomainConfig] = Field(default_factory=list)
    sections: list[SectionConfig] = Field(default_factory=list)
    document_types: list[DocumentTypeConfig] = Field(default_factory=list)
    qa: QAConfig
    agent_config: AgentConfig = Field(default_factory=AgentConfig)
    search: SearchConfig = Field(default_factory=SearchConfig)
    recommendation: RecommendationConfig
    display: DisplayConfig
    apps: list[AppConfig] = Field(default_factory=list)
    banners: list[BannerSlide] = Field(default_factory=list)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)
    site: SiteConfig = Field(default_factory=SiteConfig)


class DomainsConfigUpdate(BaseModel):
    domains: list[DomainConfig]


class SectionsConfigUpdate(BaseModel):
    sections: list[SectionConfig]


class AppsConfigUpdate(BaseModel):
    apps: list[AppConfig]


class BannersConfigUpdate(BaseModel):
    banners: list[BannerSlide]


class DocumentTypesConfigUpdate(BaseModel):
    document_types: list[DocumentTypeConfig]

    @model_validator(mode="after")
    def validate_unique_codes(self):
        codes = [item.code for item in self.document_types]
        duplicate_codes = {code for code in codes if codes.count(code) > 1}
        if duplicate_codes:
            raise ValueError("Document type codes must be unique")
        child_codes = [
            child.code
            for item in self.document_types
            for child in item.children
        ]
        duplicate_child_codes = {code for code in child_codes if child_codes.count(code) > 1}
        if duplicate_child_codes:
            raise ValueError("Document type child codes must be unique")
        return self
