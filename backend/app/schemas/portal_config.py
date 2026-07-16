import secrets
import string
from copy import deepcopy
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, StrictBool, field_validator, model_validator


_HIDDEN_TEXT_CHARS = "\u200b\u200c\u200d\ufeff"
_DOCUMENT_TYPE_CHILD_CODE_RANDOM_ALPHABET = string.ascii_uppercase + string.digits
_DOCUMENT_TYPE_CHILD_CODE_RANDOM_LENGTH = 4


def _clean_config_text(value: str) -> str:
    return str(value or "").translate({ord(char): None for char in _HIDDEN_TEXT_CHARS}).strip()


def _is_http_url(value: str) -> bool:
    normalized = str(value or "").strip()
    if any(ord(char) < 32 for char in normalized):
        return False
    try:
        parsed = urlparse(normalized)
    except ValueError:
        return False
    return (
        parsed.scheme.lower() in {"http", "https"}
        and bool(parsed.netloc)
        and parsed.username is None
        and parsed.password is None
    )


def _generate_document_type_child_code(parent_code: str, used_codes: set[str]) -> str:
    while True:
        suffix = "".join(
            secrets.choice(_DOCUMENT_TYPE_CHILD_CODE_RANDOM_ALPHABET)
            for _ in range(_DOCUMENT_TYPE_CHILD_CODE_RANDOM_LENGTH)
        )
        code = f"{parent_code}-{suffix}"
        if code not in used_codes:
            return code


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
    department_ids: list[int] = Field(default_factory=list)
    color: str
    bg: str
    icon: str
    background_image: str = ""
    enabled: bool = True
    code: str = ""

    @field_validator("department_ids")
    @classmethod
    def normalize_department_ids(cls, department_ids: list[int]) -> list[int]:
        normalized: list[int] = []
        for department_id in department_ids:
            if department_id <= 0:
                raise ValueError("Department id must be positive")
            if department_id not in normalized:
                normalized.append(department_id)
        return normalized


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
    description: str = ""
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.name = self.name.strip()
        self.description = self.description.strip()
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
    remark: str = ""


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
    type: Literal["workflow", "url"] = "workflow"
    workflow_id: str = ""
    url: str = ""
    name: str
    desc: str = ""
    category_id: str
    tags: list[str] = Field(default_factory=list)
    icon: str
    icon_image_url: str = ""
    color: str
    bg: str
    enabled: bool = True

    @model_validator(mode="after")
    def normalize_and_validate(self):
        self.id = self.id.strip()
        self.workflow_id = self.workflow_id.strip()
        self.url = self.url.strip()
        self.name = self.name.strip()
        self.desc = self.desc.strip()
        self.category_id = self.category_id.strip()
        self.tags = [tag.strip() for tag in self.tags if tag.strip()]
        self.icon = self.icon.strip()
        self.icon_image_url = self.icon_image_url.strip()
        self.color = self.color.strip()
        self.bg = self.bg.strip()
        if not self.id:
            raise ValueError("Application id is required")
        if self.type == "workflow" and not self.workflow_id:
            raise ValueError("Agent workflow_id is required")
        if self.type == "url" and not _is_http_url(self.url):
            raise ValueError("URL application requires a valid http/https URL")
        if not self.name:
            raise ValueError("Application name is required")
        if not self.category_id:
            raise ValueError("Application category is required")
        if not self.icon:
            raise ValueError("Application icon is required")
        if not self.color:
            raise ValueError("Application color is required")
        if not self.bg:
            raise ValueError("Application background color is required")
        if self.icon_image_url and not self.icon_image_url.startswith("/uploads/app-icons/"):
            raise ValueError("Application icon image URL is invalid")
        return self


class AgentConfig(BaseModel):
    categories: list[AgentCategoryConfig] = Field(default_factory=list)
    applications: list[AgentItemConfig] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_agents(cls, value: Any):
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "applications" not in data and isinstance(data.get("agents"), list):
            data["applications"] = data["agents"]
        data.pop("agents", None)
        return data

    @model_validator(mode="after")
    def normalize_and_validate(self):
        category_ids = [category.id for category in self.categories]
        duplicate_category_ids = {category_id for category_id in category_ids if category_ids.count(category_id) > 1}
        if duplicate_category_ids:
            raise ValueError("Agent category ids must be unique")
        application_ids = [application.id for application in self.applications]
        duplicate_application_ids = {
            application_id
            for application_id in application_ids
            if application_ids.count(application_id) > 1
        }
        if duplicate_application_ids:
            raise ValueError("Application ids must be unique")
        workflow_ids = [
            application.workflow_id
            for application in self.applications
            if application.type == "workflow"
        ]
        duplicate_workflow_ids = {workflow_id for workflow_id in workflow_ids if workflow_ids.count(workflow_id) > 1}
        if duplicate_workflow_ids:
            raise ValueError("Agent workflow_ids must be unique")
        valid_category_ids = set(category_ids)
        orphan_applications = [
            application.id
            for application in self.applications
            if application.category_id not in valid_category_ids
        ]
        if orphan_applications:
            raise ValueError("Application category must exist")
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
    description_examples: str = ""

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return _clean_config_text(value).upper()

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value):
        return _clean_config_text(value)

    @field_validator("description_examples", mode="before")
    @classmethod
    def normalize_description_examples(cls, value):
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
    description_examples: str = ""
    children: list[DocumentTypeChildConfig] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def fill_legacy_children_and_child_codes(cls, value):
        if not isinstance(value, dict):
            return value

        next_value = dict(value)
        code = _clean_config_text(next_value.get("code")).upper()
        label = _clean_config_text(next_value.get("label"))
        if "children" not in next_value:
            if code and label:
                next_value["children"] = [{"code": code, "label": label}]
            return next_value
        raw_children = next_value.get("children")
        if not raw_children:
            return next_value
        if not isinstance(raw_children, list) or not code:
            return next_value

        used_codes: set[str] = set()
        children = []
        for child in raw_children:
            if not isinstance(child, dict):
                children.append(child)
                continue
            next_child = dict(child)
            child_code = _clean_config_text(next_child.get("code")).upper()
            child_label = _clean_config_text(next_child.get("label"))
            if child_code:
                used_codes.add(child_code)
                next_child["code"] = child_code
            elif child_label:
                generated_code = _generate_document_type_child_code(code, used_codes)
                used_codes.add(generated_code)
                next_child["code"] = generated_code
            children.append(next_child)
        next_value["children"] = children
        return next_value

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return _clean_config_text(value).upper()

    @field_validator("label", mode="before")
    @classmethod
    def normalize_label(cls, value):
        return _clean_config_text(value)

    @field_validator("description_examples", mode="before")
    @classmethod
    def normalize_description_examples(cls, value):
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
    home_total_count: int = Field(default=20, ge=1, le=50, strict=True)
    hot_half_life_days: int = Field(default=7, ge=1, le=90, strict=True)
    home_entry_source_weight: float = Field(default=0.3, ge=0, le=1, allow_inf_nan=False)
    stable_shuffle_score_gap: float = Field(default=5, ge=0, le=100, allow_inf_nan=False)
    stable_shuffle_cycle_days: int = Field(default=7, ge=1, le=30, strict=True)
    personalized_shadow_enabled: StrictBool = False
    personalized_rollout_percent: int = Field(default=0, ge=0, le=100, strict=True)


class DisplayHomeConfig(BaseModel):
    section_page_size: int = Field(default=6, ge=1, le=50, strict=True)
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
    home_cache_ttl_seconds: int = Field(default=1800, ge=60)


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
    banners: list[BannerSlide] = Field(default_factory=list)
    integrations: IntegrationsConfig = Field(default_factory=IntegrationsConfig)
    site: SiteConfig = Field(default_factory=SiteConfig)

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_applications(cls, value: Any):
        if not isinstance(value, dict):
            return value
        data = deepcopy(value)
        raw_agent_config = data.get("agent_config")
        agent_config = dict(raw_agent_config) if isinstance(raw_agent_config, dict) else {}
        raw_applications = agent_config.get("applications")
        if isinstance(raw_applications, list):
            applications = [dict(item) for item in raw_applications if isinstance(item, dict)]
        else:
            raw_agents = agent_config.get("agents")
            applications = [dict(item) for item in raw_agents if isinstance(item, dict)] if isinstance(raw_agents, list) else []
        for application in applications:
            application.setdefault("type", "workflow")
            application.setdefault("workflow_id", "")
            application.setdefault("url", "")
            application.setdefault("icon_image_url", "")

        raw_categories = agent_config.get("categories")
        categories = [dict(item) for item in raw_categories if isinstance(item, dict)] if isinstance(raw_categories, list) else []
        legacy_apps = data.get("apps")
        valid_legacy_apps = [
            dict(item)
            for item in legacy_apps
            if isinstance(item, dict) and _is_http_url(str(item.get("url") or ""))
        ] if isinstance(legacy_apps, list) else []
        if valid_legacy_apps and not any(str(category.get("id") or "").strip() == "url-apps" for category in categories):
            categories.append({"id": "url-apps", "name": "URL 应用", "enabled": True})

        existing_ids = {str(item.get("id") or "").strip() for item in applications}
        for legacy in valid_legacy_apps:
            base_id = f"url-app-{legacy.get('id')}"
            existing = next((item for item in applications if str(item.get("id") or "").strip() == base_id), None)
            if existing is not None:
                if str(existing.get("type") or "") == "url" and str(existing.get("url") or "").strip() == str(legacy.get("url") or "").strip():
                    continue
                suffix = 2
                candidate = f"{base_id}-{suffix}"
                while candidate in existing_ids:
                    suffix += 1
                    candidate = f"{base_id}-{suffix}"
                application_id = candidate
            else:
                application_id = base_id
            existing_ids.add(application_id)
            applications.append({
                "id": application_id,
                "type": "url",
                "workflow_id": "",
                "url": str(legacy.get("url") or "").strip(),
                "name": str(legacy.get("name") or "").strip(),
                "desc": str(legacy.get("desc") or "").strip(),
                "category_id": "url-apps",
                "tags": [],
                "icon": str(legacy.get("icon") or "Globe").strip() or "Globe",
                "icon_image_url": "",
                "color": str(legacy.get("color") or "#2563eb").strip() or "#2563eb",
                "bg": str(legacy.get("bg") or "#eff6ff").strip() or "#eff6ff",
                "enabled": bool(legacy.get("enabled", True)),
            })

        agent_config["categories"] = categories
        agent_config["applications"] = applications
        agent_config.pop("agents", None)
        data["agent_config"] = agent_config
        data.pop("apps", None)
        return data

    @model_validator(mode="after")
    def validate_personalized_recommendation_config(self):
        if self.recommendation.home_total_count < self.display.home.section_page_size:
            raise ValueError("recommendation.home_total_count must be >= display.home.section_page_size")

        return self


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
