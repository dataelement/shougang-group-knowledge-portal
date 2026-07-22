import type { ChangeEvent, Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building, Tag, Bot, Star, Plus, SlidersHorizontal, RefreshCw, ArrowUp, ArrowDown, Server, Image as ImageIcon, Upload, X, Plug, Settings, FileText, KeyRound, Search as SearchIcon, MessageSquare, ChevronRight, ChevronDown, Check, Trash2, Link2, CheckCircle, XCircle, GraduationCap,
} from 'lucide-react';
import DomainIcon from '../components/DomainIcon';
import {
  type AgentCategoryConfig,
  type AgentConfig,
  type AgentItemConfig,
  type AgentWorkflowOption,
  type BannerSlide,
  type BindableSpace,
  type BishengRuntimeConfig,
  type DeptBinding,
  type DepartmentOption,
  type DisplayConfig,
  type RebindDepartmentOption,
  fetchRebindDepartments,
  type DocumentTypeConfig,
  type DomainConfig,
  type UnifiedAuthRuntimeConfig,
  bindDeptSpace,
  fetchAdminConfig,
  fetchAgentWorkflowOptions,
  fetchBindableSpaces,
  fetchBindingDepartments,
  fetchBishengRuntimeConfig,
  fetchDeptBindings,
  fetchSearchRerankModelOptions,
  fetchUnifiedAuthRuntimeConfig,
  fetchQaModelOptions,
  fetchSpaceOptions,
  rebindDeptSpace,
  unbindDeptSpace,
  type IntegrationsConfig,
  type PortalConfig,
  type QATemplateCategoryConfig,
  type QATemplateConfig,
  type QAModelOption,
  type RecommendationConfig,
  type SearchConfig,
  type SectionConfig,
  type SiteConfig,
  type SpaceOption,
  type QAConfig,
  updateAgentConfig,
  updateBannersConfig,
  updateBishengRuntimeConfig,
  updateDisplayConfig,
  updateDomainsConfig,
  updateDocumentTypesConfig,
  updateIntegrationsConfig,
  updateSearchConfig,
  updateUnifiedAuthRuntimeConfig,
  updateQaConfig,
  updateRecommendationConfig,
  updateSectionsConfig,
  updateSiteConfig,
  uploadBannerImage,
  uploadApplicationIcon,
} from '../api/adminConfig';
import {
  buildDomainCodeOptions,
  createDomainDraft,
  DOMAIN_COLOR_OPTIONS,
  DOMAIN_ICON_OPTIONS,
  isSelectedDomainColor,
  validateDomainDraft,
  getDomainBoundSpaceIds,
  getDomainBindableSpaceGroups,
  type DomainCodeOption,
  type DomainDraft,
} from '../utils/adminDomains';
import {
  createSectionDraft,
  LATEST_SELECTED_SECTION_KEY,
  resolveSectionVisual,
  SECTION_ICON_OPTIONS,
  validateSectionDraft,
  type SectionDraft,
} from '../utils/adminSections';
import {
  createBannerDraft,
  validateBannerDraft,
  type BannerDraft,
} from '../utils/adminBanners';
import {
  canDeleteQaTemplateCategory,
  createQaTemplateCategoryDraft,
  createQaTemplateDraft,
  QA_TEMPLATE_ICON_OPTIONS,
  QA_TEMPLATE_HOME_ICON_OPTIONS,
  validateQaTemplateCategoryDraft,
  validateQaTemplateDraft,
  type QaTemplateCategoryDraft,
  type QaTemplateDraft,
} from '../utils/adminQaTemplates';
import {
  AGENT_COLOR_PRESETS,
  AGENT_ICON_OPTIONS,
  canDeleteAgentCategory,
  createAgentCategoryDraft,
  createAgentDraft,
  createUrlApplicationDraft,
  toAgentCategoryConfig,
  toAgentItemConfig,
  validateAgentCategoryDraft,
  validateAgentConfig,
  validateAgentDraft,
  type AgentCategoryDraft,
  type AgentDraft,
} from '../utils/adminAgentConfig';
import {
  createBindingDraft,
  filterDepartmentOptions,
  findDepartmentOption,
  getIndeterminateDepartmentIds,
  groupBindingsByDepartment,
  toggleSelectedDepartmentId,
  validateBindingDraft,
  type BindingDraft,
} from '../utils/deptKnowledgeBinding';
import { formatDisplayDateTime } from '../utils/dateTime';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import RecommendationPersonalizationPanel from './admin/RecommendationPersonalizationPanel';
import CourseManagementPanel from './admin/CourseManagementPanel';
import s from './AdminPage.module.css';

function isBuiltinSection(section: SectionConfig): boolean {
  return Boolean(section.builtin_key);
}

function isLatestSelectedSection(section: Pick<SectionConfig, 'builtin_key'>): boolean {
  return section.builtin_key === LATEST_SELECTED_SECTION_KEY;
}

function isLatestSelectedSectionDraft(draft: Pick<SectionDraft, 'builtinKey'>): boolean {
  return draft.builtinKey === LATEST_SELECTED_SECTION_KEY;
}

const NAV_ITEMS = [
  { key: 'domains', label: '业务域', icon: Building },
  { key: 'sections', label: '首页分区', icon: Tag },
  { key: 'banners', label: '首页 Banner', icon: ImageIcon },
  { key: 'courses', label: '课程管理', icon: GraduationCap },
  { key: 'documentTypes', label: '文件分类', icon: FileText },
  { key: 'qa', label: '问答配置', icon: Bot },
  { key: 'qaTemplates', label: '问答模板', icon: FileText },
  { key: 'agentConfig', label: '智能应用配置', icon: MessageSquare },
  { key: 'search', label: '搜索配置', icon: SearchIcon },
  { key: 'recommend', label: '推荐策略', icon: Star },
  { key: 'display', label: '展示配置', icon: SlidersHorizontal },
  { key: 'bisheng', label: '数据源配置', icon: Server },
  { key: 'unifiedAuth', label: '统一认证', icon: KeyRound },
  { key: 'deptBinding', label: '科室知识库绑定', icon: Link2 },
  { key: 'integrations', label: '集成配置', icon: Plug },
  { key: 'site', label: '站点配置', icon: Settings },
];

type NavKey = typeof NAV_ITEMS[number]['key'];

function mergeWorkflowOptions(
  current: AgentWorkflowOption[],
  incoming: AgentWorkflowOption[],
): AgentWorkflowOption[] {
  const seen = new Set(current.map((workflow) => workflow.workflow_id));
  const merged = [...current];
  for (const workflow of incoming) {
    if (seen.has(workflow.workflow_id)) continue;
    seen.add(workflow.workflow_id);
    merged.push(workflow);
  }
  return merged;
}

type DisplayItem = {
  group: string;
  key: string;
  label: string;
  value: number;
};

type QaDialogMode =
  | 'welcome_message'
  | 'hot_questions'
  | 'ai_search_system_prompt'
  | 'qa_system_prompt'
  | 'quick_mode_system_prompt'
  | 'normal_mode_system_prompt'
  | 'expert_mode_system_prompt'
  | null;

interface QaModelDraft {
  general_model: string;
  reasoning_model: string;
}

type QaCategoryDeleteTarget = {
  category: QATemplateCategoryConfig;
  index: number;
};

type QaTemplateDeleteTarget = {
  template: QATemplateConfig;
  index: number;
};

type AgentCategoryDeleteTarget = {
  category: AgentCategoryConfig;
  index: number;
};

type AgentDeleteTarget = {
  agent: AgentItemConfig;
  index: number;
};

type WorkflowLoadOptions = {
  cursor?: string;
  append?: boolean;
};

interface BishengDraft {
  base_url: string;
  asset_base_url: string;
  username: string;
  password: string;
  timeout_seconds: string;
}

interface UnifiedAuthDraft {
  enabled: boolean;
  provider: 'group' | 'stock' | 'custom';
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  token_param_style: 'query' | 'form';
  state_secret: string;
  state_ttl_seconds: string;
  http_timeout_seconds: string;
  login_sync_hmac_secret: string;
  login_sync_signature_header: string;
}

interface IntegrationsDraft {
  bisheng_admin_entry_url: string;
  bisheng_knowledge_entry_url: string;
}

interface SiteDraft {
  header_brand_name: string;
  header_logo_url: string;
  login_brand_name: string;
  login_logo_url: string;
  browser_title: string;
  favicon_url: string;
  domain_count_cache_ttl_seconds: string;
  home_cache_ttl_seconds: string;
}

interface DocumentTypeDraft {
  code: string;
  label: string;
  description_examples: string;
  children: Array<{ code?: string; label: string; description_examples?: string }>;
}

export default function AdminPage() {
  const [active, setActive] = useState<NavKey>('domains');
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>();

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
  }
  const [spaceOptions, setSpaceOptions] = useState<SpaceOption[]>([]);
  const [spaceOptionsLoaded, setSpaceOptionsLoaded] = useState(false);
  const [spaceOptionsLoading, setSpaceOptionsLoading] = useState(false);
  const [spaceOptionsError, setSpaceOptionsError] = useState('');
  const [domainDepartments, setDomainDepartments] = useState<DepartmentOption[]>([]);
  const [domainDepartmentsLoading, setDomainDepartmentsLoading] = useState(false);
  const [domainDepartmentsError, setDomainDepartmentsError] = useState('');
  const [domainEditorOpen, setDomainEditorOpen] = useState(false);
  const [domainEditorIndex, setDomainEditorIndex] = useState<number | null>(null);
  const [domainDraft, setDomainDraft] = useState<DomainDraft>(createDomainDraft());
  const [domainFormError, setDomainFormError] = useState('');
  const [domainDeleteIndex, setDomainDeleteIndex] = useState<number | null>(null);
  const [sectionEditorOpen, setSectionEditorOpen] = useState(false);
  const [sectionEditorIndex, setSectionEditorIndex] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft>(createSectionDraft());
  const [sectionFormError, setSectionFormError] = useState('');
  const [sectionDeleteIndex, setSectionDeleteIndex] = useState<number | null>(null);
  const [documentTypeDialogOpen, setDocumentTypeDialogOpen] = useState(false);
  const [documentTypeEditIndex, setDocumentTypeEditIndex] = useState<number | null>(null);
  const [documentTypeDraft, setDocumentTypeDraft] = useState<DocumentTypeDraft>(createDocumentTypeDraft());
  const [documentTypeDialogError, setDocumentTypeDialogError] = useState('');
  const [documentTypeChildrenIndex, setDocumentTypeChildrenIndex] = useState<number | null>(null);
  const [bishengConfig, setBishengConfig] = useState<BishengRuntimeConfig | null>(null);
  const [bishengEditorOpen, setBishengEditorOpen] = useState(false);
  const [bishengDraft, setBishengDraft] = useState<BishengDraft>(createBishengDraft());
  const [bishengFormError, setBishengFormError] = useState('');
  const [unifiedAuthConfig, setUnifiedAuthConfig] = useState<UnifiedAuthRuntimeConfig | null>(null);
  const [unifiedAuthEditorOpen, setUnifiedAuthEditorOpen] = useState(false);
  const [unifiedAuthDraft, setUnifiedAuthDraft] = useState<UnifiedAuthDraft>(createUnifiedAuthDraft());
  const [unifiedAuthFormError, setUnifiedAuthFormError] = useState('');
  const [qaDialogMode, setQaDialogMode] = useState<QaDialogMode>(null);
  const [qaTextDraft, setQaTextDraft] = useState('');
  const [qaDialogError, setQaDialogError] = useState('');
  const [qaModelDialogOpen, setQaModelDialogOpen] = useState(false);
  const [qaModelOptions, setQaModelOptions] = useState<QAModelOption[]>([]);
  const [qaModelDraft, setQaModelDraft] = useState<QaModelDraft>({ general_model: '', reasoning_model: '' });
  const [qaModelLoading, setQaModelLoading] = useState(false);
  const [qaModelError, setQaModelError] = useState('');
  const [searchRerankModelDialogOpen, setSearchRerankModelDialogOpen] = useState(false);
  const [searchRerankModelOptions, setSearchRerankModelOptions] = useState<QAModelOption[]>([]);
  const [searchRerankModelDraft, setSearchRerankModelDraft] = useState('');
  const [searchRerankModelLoading, setSearchRerankModelLoading] = useState(false);
  const [searchRerankModelError, setSearchRerankModelError] = useState('');
  const [qaCategoryEditorOpen, setQaCategoryEditorOpen] = useState(false);
  const [qaCategoryEditorIndex, setQaCategoryEditorIndex] = useState<number | null>(null);
  const [qaCategoryDraft, setQaCategoryDraft] = useState<QaTemplateCategoryDraft>(createQaTemplateCategoryDraft());
  const [qaCategoryFormError, setQaCategoryFormError] = useState('');
  const [qaCategoryDeleteTarget, setQaCategoryDeleteTarget] = useState<QaCategoryDeleteTarget | null>(null);
  const [qaTemplateEditorOpen, setQaTemplateEditorOpen] = useState(false);
  const [qaTemplateEditorIndex, setQaTemplateEditorIndex] = useState<number | null>(null);
  const [qaTemplateDraft, setQaTemplateDraft] = useState<QaTemplateDraft>(createQaTemplateDraft());
  const [qaTemplateFormError, setQaTemplateFormError] = useState('');
  const [qaTemplateDeleteTarget, setQaTemplateDeleteTarget] = useState<QaTemplateDeleteTarget | null>(null);
  const [agentCategoryEditorOpen, setAgentCategoryEditorOpen] = useState(false);
  const [agentCategoryEditorIndex, setAgentCategoryEditorIndex] = useState<number | null>(null);
  const [agentCategoryDraft, setAgentCategoryDraft] = useState<AgentCategoryDraft>(createAgentCategoryDraft());
  const [agentCategoryFormError, setAgentCategoryFormError] = useState('');
  const [agentCategoryDeleteTarget, setAgentCategoryDeleteTarget] = useState<AgentCategoryDeleteTarget | null>(null);
  const [agentEditorOpen, setAgentEditorOpen] = useState(false);
  const [agentEditorIndex, setAgentEditorIndex] = useState<number | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(createAgentDraft());
  const [agentFormError, setAgentFormError] = useState('');
  const [urlApplicationEditorOpen, setUrlApplicationEditorOpen] = useState(false);
  const [urlApplicationEditorIndex, setUrlApplicationEditorIndex] = useState<number | null>(null);
  const [urlApplicationDraft, setUrlApplicationDraft] = useState<AgentDraft>(createUrlApplicationDraft());
  const [urlApplicationFormError, setUrlApplicationFormError] = useState('');
  const [urlApplicationIconUploading, setUrlApplicationIconUploading] = useState(false);
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<AgentDeleteTarget | null>(null);
  const [agentWorkflowOptions, setAgentWorkflowOptions] = useState<AgentWorkflowOption[]>([]);
  const [agentWorkflowLoading, setAgentWorkflowLoading] = useState(false);
  const [agentWorkflowError, setAgentWorkflowError] = useState('');
  const [agentWorkflowKeyword, setAgentWorkflowKeyword] = useState('');
  const [agentWorkflowLoaded, setAgentWorkflowLoaded] = useState(false);
  const [agentWorkflowLoadedKeyword, setAgentWorkflowLoadedKeyword] = useState('');
  const [agentWorkflowHasMore, setAgentWorkflowHasMore] = useState(false);
  const [agentWorkflowNextCursor, setAgentWorkflowNextCursor] = useState('');
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [bannerEditorIndex, setBannerEditorIndex] = useState<number | null>(null);
  const [bannerDraft, setBannerDraft] = useState<BannerDraft>(createBannerDraft());
  const [bannerFormError, setBannerFormError] = useState('');
  const [bannerDeleteIndex, setBannerDeleteIndex] = useState<number | null>(null);
  const [integrationsDialogOpen, setIntegrationsDialogOpen] = useState(false);
  const [integrationsDraft, setIntegrationsDraft] = useState<IntegrationsDraft>(createIntegrationsDraft());
  const [integrationsDialogError, setIntegrationsDialogError] = useState('');
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(createSiteDraft());
  const [siteDialogError, setSiteDialogError] = useState('');
  const [deptBindings, setDeptBindings] = useState<DeptBinding[]>([]);
  const [bindableSpaces, setBindableSpaces] = useState<BindableSpace[]>([]);
  const [bindingDepartments, setBindingDepartments] = useState<DepartmentOption[]>([]);
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>(createBindingDraft());
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [bindingUnbindTarget, setBindingUnbindTarget] = useState<DeptBinding | null>(null);
  const [bindingRebindTarget, setBindingRebindTarget] = useState<DeptBinding | null>(null);
  const [bindingRebindDraft, setBindingRebindDraft] = useState<BindingDraft>(createBindingDraft());
  const [rebindDepartments, setRebindDepartments] = useState<RebindDepartmentOption[]>([]);
  const [rebindDisabledIds, setRebindDisabledIds] = useState<Set<number>>(new Set());
  const [rebindDepartmentsLoading, setRebindDepartmentsLoading] = useState(false);

  async function loadConfig() {
    setLoading(true);
    setError('');
    try {
      const [portalResult, bishengResult, unifiedAuthResult] = await Promise.allSettled([
        fetchAdminConfig(),
        fetchBishengRuntimeConfig(),
        fetchUnifiedAuthRuntimeConfig(),
      ]);

      const errors: string[] = [];
      if (portalResult.status === 'fulfilled') {
        setConfig(portalResult.value);
      } else {
        errors.push(portalResult.reason instanceof Error ? portalResult.reason.message : '门户配置加载失败');
      }

      if (bishengResult.status === 'fulfilled') {
        setBishengConfig(bishengResult.value);
      } else {
        errors.push(bishengResult.reason instanceof Error ? bishengResult.reason.message : '大模型应用平台配置加载失败');
      }

      if (unifiedAuthResult.status === 'fulfilled') {
        setUnifiedAuthConfig(unifiedAuthResult.value);
      } else {
        errors.push(unifiedAuthResult.reason instanceof Error ? unifiedAuthResult.reason.message : '统一认证配置加载失败');
      }

      if (errors.length) {
        setError(errors.join('；'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function runSave(task: () => Promise<void>) {
    setSaving(true);
    setError('');
    try {
      await task();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function loadSpaceOptions() {
    setSpaceOptionsLoading(true);
    setSpaceOptionsError('');
    try {
      const data = await fetchSpaceOptions();
      setSpaceOptions(data.options);
    } catch (err) {
      setSpaceOptionsError(err instanceof Error ? err.message : '候选空间加载失败');
    } finally {
      setSpaceOptionsLoaded(true);
      setSpaceOptionsLoading(false);
    }
  }

  async function loadDomainDepartments() {
    setDomainDepartmentsLoading(true);
    setDomainDepartmentsError('');
    try {
      setDomainDepartments(await fetchBindingDepartments());
    } catch (err) {
      setDomainDepartmentsError(err instanceof Error ? err.message : '部门列表加载失败');
    } finally {
      setDomainDepartmentsLoading(false);
    }
  }

  const refetchBindings = useCallback(async () => {
    const [bindings, spaces, departments] = await Promise.all([
      fetchDeptBindings(), fetchBindableSpaces(), fetchBindingDepartments(),
    ]);
    setDeptBindings(bindings); setBindableSpaces(spaces); setBindingDepartments(departments);
  }, []);

  function openBindingDialog() {
    setBindingDraft(createBindingDraft());
    setError('');
    setBindingDialogOpen(true);
  }

  const handleBindSpace = () => {
    const err = validateBindingDraft(bindingDraft);
    if (err) { setError(err); return; }
    void runSave(async () => {
      await bindDeptSpace(bindingDraft.spaceId!, bindingDraft.departmentId!);
      await refetchBindings();
      setBindingDialogOpen(false);
      setBindingDraft(createBindingDraft());
    });
  };

  const handleUnbindSpace = (spaceId: number, onSuccess?: () => void) => {
    void runSave(async () => {
      await unbindDeptSpace(spaceId);
      await refetchBindings();
      onSuccess?.();
    });
  };

  const handleRebindSpace = () => {
    if (!bindingRebindTarget || bindingRebindDraft.departmentId == null) return;
    void runSave(async () => {
      await rebindDeptSpace(bindingRebindTarget.space_id, bindingRebindDraft.departmentId!);
      await refetchBindings();
      setBindingRebindTarget(null);
      setBindingRebindDraft(createBindingDraft());
      setRebindDepartments([]);
      setRebindDisabledIds(new Set());
    });
  };

  async function loadRebindDepartments() {
    setRebindDepartmentsLoading(true);
    try {
      const departments = await fetchRebindDepartments();
      setRebindDepartments(departments);
      // 已绑定的科室（含当前知识库原科室）置灰不可选
      const disabledIds = new Set(deptBindings.map((binding) => binding.department_id));
      setRebindDisabledIds(disabledIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : '科室候选列表加载失败');
    } finally {
      setRebindDepartmentsLoading(false);
    }
  }

  function openCreateDomainDialog() {
    setDomainEditorOpen(true);
    setDomainEditorIndex(null);
    setDomainDraft(createDomainDraft());
    setDomainFormError('');
    void loadSpaceOptions();
    void loadDomainDepartments();
  }

  function openEditDomainDialog(domain: DomainConfig, index: number) {
    setDomainEditorOpen(true);
    setDomainEditorIndex(index);
    setDomainDraft(createDomainDraft(domain));
    setDomainFormError('');
    void loadSpaceOptions();
    void loadDomainDepartments();
  }

  function openCreateSectionDialog() {
    setSectionEditorOpen(true);
    setSectionEditorIndex(null);
    setSectionDraft(createSectionDraft());
    setSectionFormError('');
  }

  function openEditSectionDialog(section: SectionConfig, index: number) {
    setSectionEditorOpen(true);
    setSectionEditorIndex(index);
    setSectionDraft(createSectionDraft(section));
    setSectionFormError('');
  }

  async function handleConfirmDocumentType() {
    const currentList = config?.document_types ?? [];
    const result = buildDocumentTypeFromDraft(documentTypeDraft, currentList, documentTypeEditIndex);
    if (result.error || !result.documentType) {
      setDocumentTypeDialogError(result.error || '文件分类配置不完整');
      return;
    }
    const documentType = result.documentType;
    let nextList: DocumentTypeConfig[];
    if (documentTypeEditIndex !== null) {
      nextList = currentList.map((item, i) => i === documentTypeEditIndex ? documentType : item);
    } else {
      nextList = [...currentList, documentType];
    }
    setSaving(true);
    setError('');
    try {
      await persistDocumentTypes(nextList, setConfig);
      setDocumentTypeDialogOpen(false);
    } catch (err) {
      setDocumentTypeDialogError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function openBishengDialog(current?: BishengRuntimeConfig | null) {
    setBishengEditorOpen(true);
    setBishengDraft(createBishengDraft(current ?? undefined));
    setBishengFormError('');
  }

  function openUnifiedAuthDialog(current?: UnifiedAuthRuntimeConfig | null) {
    setUnifiedAuthEditorOpen(true);
    setUnifiedAuthDraft(createUnifiedAuthDraft(current ?? undefined));
    setUnifiedAuthFormError('');
  }

  async function openQaModelDialog(qa: QAConfig) {
    setQaModelDialogOpen(true);
    setQaModelDraft({
      general_model: qa.general_model || qa.selected_model || '',
      reasoning_model: qa.reasoning_model || '',
    });
    setQaModelLoading(true);
    setQaModelError('');
    try {
      const data = await fetchQaModelOptions();
      setQaModelOptions(data.models);
      setQaModelDraft({
        general_model: qa.general_model || data.general_model || data.selected_model || '',
        reasoning_model: qa.reasoning_model || data.reasoning_model || '',
      });
    } catch (err) {
      setQaModelError(err instanceof Error ? err.message : '模型列表加载失败');
    } finally {
      setQaModelLoading(false);
    }
  }

  async function openSearchRerankModelDialog(search: SearchConfig) {
    setSearchRerankModelDialogOpen(true);
    setSearchRerankModelDraft(search.rerank_model_id || '');
    setSearchRerankModelLoading(true);
    setSearchRerankModelError('');
    try {
      const data = await fetchSearchRerankModelOptions();
      setSearchRerankModelOptions(data.models);
      setSearchRerankModelDraft(search.rerank_model_id || data.rerank_model_id || '');
    } catch (err) {
      setSearchRerankModelError(err instanceof Error ? err.message : '重排模型列表加载失败');
    } finally {
      setSearchRerankModelLoading(false);
    }
  }

  useEffect(() => {
    if (active !== 'qa' || !config || qaModelOptions.length) return;
    let cancelled = false;
    setQaModelLoading(true);
    setQaModelError('');
    void (async () => {
      try {
        const data = await fetchQaModelOptions();
        if (cancelled) return;
        setQaModelOptions(data.models);
      } catch (err) {
        if (cancelled) return;
        setQaModelError(err instanceof Error ? err.message : '模型列表加载失败');
      } finally {
        if (!cancelled) setQaModelLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, config, qaModelOptions.length]);

  useEffect(() => {
    if (active !== 'search' || !config || searchRerankModelOptions.length) return;
    let cancelled = false;
    setSearchRerankModelLoading(true);
    setSearchRerankModelError('');
    void (async () => {
      try {
        const data = await fetchSearchRerankModelOptions();
        if (cancelled) return;
        setSearchRerankModelOptions(data.models);
      } catch (err) {
        if (cancelled) return;
        setSearchRerankModelError(err instanceof Error ? err.message : '重排模型列表加载失败');
      } finally {
        if (!cancelled) setSearchRerankModelLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, config, searchRerankModelOptions.length]);

  useEffect(() => {
    if (active !== 'domains' || !config || spaceOptionsLoaded || spaceOptionsLoading) return;
    void loadSpaceOptions();
  }, [active, config, spaceOptionsLoaded, spaceOptionsLoading]);

  useEffect(() => {
    if (active !== 'agentConfig' || !config || agentWorkflowLoaded || agentWorkflowLoading) return;
    void loadAgentWorkflowOptions('');
  }, [active, config, agentWorkflowLoaded, agentWorkflowLoading]);

  useEffect(() => {
    if (active !== 'deptBinding') return;
    void refetchBindings().catch((err) => {
      setError(err instanceof Error ? err.message : '科室知识库绑定列表加载失败');
    });
  }, [active, refetchBindings]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openQaTextDialog(mode: Exclude<QaDialogMode, null>, value: string) {
    setQaDialogMode(mode);
    setQaTextDraft(value);
    setQaDialogError('');
  }

  function openCreateQaCategoryDialog() {
    setQaCategoryEditorOpen(true);
    setQaCategoryEditorIndex(null);
    setQaCategoryDraft(createQaTemplateCategoryDraft());
    setQaCategoryFormError('');
  }

  function openEditQaCategoryDialog(category: QATemplateCategoryConfig, index: number) {
    setQaCategoryEditorOpen(true);
    setQaCategoryEditorIndex(index);
    setQaCategoryDraft(createQaTemplateCategoryDraft(category));
    setQaCategoryFormError('');
  }

  function openCreateQaTemplateDialog() {
    setQaTemplateEditorOpen(true);
    setQaTemplateEditorIndex(null);
    setQaTemplateDraft({
      ...createQaTemplateDraft(),
      categoryId: config?.qa.template_categories[0]?.id ?? '',
    });
    setQaTemplateFormError('');
  }

  function openEditQaTemplateDialog(template: QATemplateConfig, index: number) {
    setQaTemplateEditorOpen(true);
    setQaTemplateEditorIndex(index);
    setQaTemplateDraft(createQaTemplateDraft(template));
    setQaTemplateFormError('');
  }

  function openCreateAgentCategoryDialog() {
    setAgentCategoryEditorOpen(true);
    setAgentCategoryEditorIndex(null);
    setAgentCategoryDraft(createAgentCategoryDraft());
    setAgentCategoryFormError('');
  }

  function openEditAgentCategoryDialog(category: AgentCategoryConfig, index: number) {
    setAgentCategoryEditorOpen(true);
    setAgentCategoryEditorIndex(index);
    setAgentCategoryDraft(createAgentCategoryDraft(category));
    setAgentCategoryFormError('');
  }

  async function loadAgentWorkflowOptions(keyword = agentWorkflowKeyword, options: WorkflowLoadOptions = {}) {
    const normalizedKeyword = keyword.trim();
    const cursor = options.cursor?.trim() || '';
    setAgentWorkflowLoading(true);
    if (!options.append) setAgentWorkflowError('');
    try {
      const data = await fetchAgentWorkflowOptions({ keyword: normalizedKeyword, cursor, page_size: 50 });
      setAgentWorkflowOptions((current) => (
        options.append ? mergeWorkflowOptions(current, data.workflows) : data.workflows
      ));
      setAgentWorkflowHasMore(data.has_more);
      setAgentWorkflowNextCursor(data.next_cursor);
      setAgentWorkflowLoadedKeyword(normalizedKeyword);
      setAgentWorkflowLoaded(true);
    } catch (err) {
      setAgentWorkflowError(err instanceof Error ? err.message : 'workflow 候选项加载失败');
      setAgentWorkflowLoaded(true);
    } finally {
      setAgentWorkflowLoading(false);
    }
  }

  function openCreateAgentDialog() {
    setAgentEditorOpen(true);
    setAgentEditorIndex(null);
    setAgentDraft(createAgentDraft({ category_id: config?.agent_config.categories[0]?.id ?? '' }));
    setAgentFormError('');
    void loadAgentWorkflowOptions('');
  }

  function openEditAgentDialog(agent: AgentItemConfig, index: number) {
    setAgentEditorOpen(true);
    setAgentEditorIndex(index);
    setAgentDraft(createAgentDraft(agent));
    setAgentFormError('');
    void loadAgentWorkflowOptions('');
  }

  function openCreateUrlApplicationDialog() {
    setUrlApplicationEditorOpen(true);
    setUrlApplicationEditorIndex(null);
    setUrlApplicationDraft(createUrlApplicationDraft(config?.agent_config.categories[0]?.id ?? ''));
    setUrlApplicationFormError('');
  }

  function openEditApplicationDialog(application: AgentItemConfig, index: number) {
    if (application.type === 'url') {
      setUrlApplicationEditorOpen(true);
      setUrlApplicationEditorIndex(index);
      setUrlApplicationDraft(createUrlApplicationDraft(application.category_id, application));
      setUrlApplicationFormError('');
      return;
    }
    openEditAgentDialog(application, index);
  }

  function openCreateBannerDialog() {
    setBannerEditorOpen(true);
    setBannerEditorIndex(null);
    setBannerDraft(createBannerDraft(undefined, config?.banners ?? []));
    setBannerFormError('');
  }

  function openEditBannerDialog(banner: BannerSlide, index: number) {
    setBannerEditorOpen(true);
    setBannerEditorIndex(index);
    setBannerDraft(createBannerDraft(banner));
    setBannerFormError('');
  }

  const displayItems = config ? getDisplayItems(config.display) : [];
  const domainCodeOptions = buildDomainCodeOptions();
  const deletingBanner = config && bannerDeleteIndex !== null ? config.banners[bannerDeleteIndex] : null;

  return (
    <>
      <div className={s.layout}>
        {/* Left nav */}
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                className={`${s.navItem} ${active === item.key ? s.navItemActive : ''}`}
                onClick={() => setActive(item.key)}
              >
                <Icon size={16} />
                {item.label}
              </div>
            );
          })}
        </nav>

        {/* Main */}
        <main className={s.main}>
          <div className={s.statusRow}>
            <div className={s.statusText}>
              {loading ? '正在加载配置...' : saving ? '正在保存配置...' : '配置已加载，可直接编辑并保存。'}
            </div>
            <div className={s.actions}>
              <button className={s.subtleBtn} onClick={() => void loadConfig()} disabled={loading || saving}>
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
          </div>
          {error ? <div className={s.errorBox}>{error}</div> : null}
          {toast ? (
            <div
              className={`${s.toast} ${toast.type === 'success' ? s.toastSuccess : s.toastError}`}
              role="status"
            >
              {toast.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
              <span>{toast.message}</span>
            </div>
          ) : null}
          {!config && !loading ? (
            <div className={s.emptyState}>配置暂时不可用</div>
          ) : null}
          {config && active === 'domains' && (
            <DomainsTable
              domains={config.domains}
              spaces={spaceOptions}
              spaceOptionsLoaded={spaceOptionsLoaded}
              spaceOptionsError={spaceOptionsError}
              saving={saving}
              onAdd={openCreateDomainDialog}
              onEdit={(index) => openEditDomainDialog(config.domains[index], index)}
              onDelete={(index) => setDomainDeleteIndex(index)}
              onMoveUp={(index) => void handleMoveDomain(config.domains, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveDomain(config.domains, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'sections' && (
            <SectionsTable
              sections={config.sections}
              saving={saving}
              onAdd={openCreateSectionDialog}
              onEdit={(index) => openEditSectionDialog(config.sections[index], index)}
              onDelete={(index) => {
                if (isBuiltinSection(config.sections[index])) return;
                setSectionDeleteIndex(index);
              }}
              onMoveUp={(index) => void handleMoveSection(config.sections, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveSection(config.sections, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'documentTypes' && (
            <DocumentTypesTable
              documentTypes={config.document_types}
              saving={saving}
              onViewChildren={(index) => setDocumentTypeChildrenIndex(index)}
              onAdd={() => {
                setDocumentTypeDraft(createDocumentTypeDraft());
                setDocumentTypeEditIndex(null);
                setDocumentTypeDialogError('');
                setDocumentTypeDialogOpen(true);
              }}
              onEdit={(index) => {
                setDocumentTypeDraft(createDocumentTypeDraft(config.document_types[index]));
                setDocumentTypeEditIndex(index);
                setDocumentTypeDialogError('');
                setDocumentTypeDialogOpen(true);
              }}
              onDelete={(index) => void handleDeleteDocumentType(config.document_types, index, runSave, setConfig)}
              onMoveUp={(index) => void handleMoveDocumentType(config.document_types, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveDocumentType(config.document_types, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'qa' && (
            <QAConfigTable
              qa={config.qa}
              saving={saving}
              modelOptions={qaModelOptions}
              modelLoading={qaModelLoading}
              modelError={qaModelError}
              onEditWelcomeMessage={() => openQaTextDialog('welcome_message', config.qa.welcome_message)}
              onEditQuestions={() => openQaTextDialog('hot_questions', config.qa.hot_questions.join('\n'))}
              onEditModel={() => void openQaModelDialog(config.qa)}
              onEditSearchPrompt={() => openQaTextDialog('ai_search_system_prompt', config.qa.ai_search_system_prompt)}
              onEditQaPrompt={() => openQaTextDialog('qa_system_prompt', config.qa.qa_system_prompt)}
              onEditQuickPrompt={() => openQaTextDialog('quick_mode_system_prompt', config.qa.quick_mode_system_prompt)}
              onEditNormalPrompt={() => openQaTextDialog('normal_mode_system_prompt', config.qa.normal_mode_system_prompt)}
              onEditExpertPrompt={() => openQaTextDialog('expert_mode_system_prompt', config.qa.expert_mode_system_prompt)}
            />
          )}
          {config && active === 'qaTemplates' && (
            <QATemplatesTable
              qa={config.qa}
              saving={saving}
              onAddCategory={openCreateQaCategoryDialog}
              onEditCategory={(index) => openEditQaCategoryDialog(config.qa.template_categories[index], index)}
              onDeleteCategory={(index) => setQaCategoryDeleteTarget({ category: config.qa.template_categories[index], index })}
              onMoveCategory={(index, direction) => {
                const nextIndex = index + direction;
                if (nextIndex < 0 || nextIndex >= config.qa.template_categories.length) return;
                const updated = [...config.qa.template_categories];
                const [moved] = updated.splice(index, 1);
                updated.splice(nextIndex, 0, moved);
                void runSave(() => persistQa({ ...config.qa, template_categories: updated }, setConfig));
              }}
              onToggleCategory={(index, enabled) => {
                const updated = [...config.qa.template_categories];
                updated[index] = { ...updated[index], enabled };
                void runSave(() => persistQa({ ...config.qa, template_categories: updated }, setConfig));
              }}
              onAddTemplate={openCreateQaTemplateDialog}
              onEditTemplate={(index) => openEditQaTemplateDialog(config.qa.templates[index], index)}
              onDeleteTemplate={(index) => setQaTemplateDeleteTarget({ template: config.qa.templates[index], index })}
              onMoveTemplate={(index, direction) => {
                const nextIndex = index + direction;
                if (nextIndex < 0 || nextIndex >= config.qa.templates.length) return;
                const updated = [...config.qa.templates];
                const [moved] = updated.splice(index, 1);
                updated.splice(nextIndex, 0, moved);
                void runSave(() => persistQa({ ...config.qa, templates: updated }, setConfig));
              }}
              onToggleTemplate={(index, enabled) => {
                const updated = [...config.qa.templates];
                updated[index] = { ...updated[index], enabled };
                void runSave(() => persistQa({ ...config.qa, templates: updated }, setConfig));
              }}
            />
          )}
          {config && active === 'agentConfig' && (
            <AgentConfigTable
              agentConfig={config.agent_config}
              workflowOptions={agentWorkflowOptions}
              workflowLoading={agentWorkflowLoading}
              workflowError={agentWorkflowError}
              workflowLoaded={agentWorkflowLoaded}
              workflowSourceReliable={agentWorkflowLoaded && !agentWorkflowLoading && !agentWorkflowError && !agentWorkflowHasMore && agentWorkflowLoadedKeyword === ''}
              workflowHasMore={agentWorkflowHasMore}
              saving={saving}
              onRefreshWorkflows={() => void loadAgentWorkflowOptions('')}
              onLoadMoreWorkflows={() => void loadAgentWorkflowOptions(agentWorkflowLoadedKeyword, {
                cursor: agentWorkflowNextCursor,
                append: true,
              })}
              onAddCategory={openCreateAgentCategoryDialog}
              onEditCategory={(index) => openEditAgentCategoryDialog(config.agent_config.categories[index], index)}
              onDeleteCategory={(index) => setAgentCategoryDeleteTarget({ category: config.agent_config.categories[index], index })}
              onMoveCategory={(index, direction) => {
                const nextIndex = index + direction;
                if (nextIndex < 0 || nextIndex >= config.agent_config.categories.length) return;
                const updated = [...config.agent_config.categories];
                const [moved] = updated.splice(index, 1);
                updated.splice(nextIndex, 0, moved);
                void runSave(() => persistAgentConfig({ ...config.agent_config, categories: updated }, setConfig));
              }}
              onToggleCategory={(index, enabled) => {
                const updated = [...config.agent_config.categories];
                updated[index] = { ...updated[index], enabled };
                void runSave(() => persistAgentConfig({ ...config.agent_config, categories: updated }, setConfig));
              }}
              onAddAgent={openCreateAgentDialog}
              onAddUrlApplication={openCreateUrlApplicationDialog}
              onEditAgent={(index) => openEditApplicationDialog(config.agent_config.applications[index], index)}
              onDeleteAgent={(index) => setAgentDeleteTarget({ agent: config.agent_config.applications[index], index })}
              onMoveAgent={(index, direction) => {
                const nextIndex = index + direction;
                if (nextIndex < 0 || nextIndex >= config.agent_config.applications.length) return;
                const updated = [...config.agent_config.applications];
                const [moved] = updated.splice(index, 1);
                updated.splice(nextIndex, 0, moved);
                void runSave(() => persistAgentConfig({ ...config.agent_config, applications: updated }, setConfig));
              }}
              onToggleAgent={(index, enabled) => {
                const updated = [...config.agent_config.applications];
                updated[index] = { ...updated[index], enabled };
                void runSave(() => persistAgentConfig({ ...config.agent_config, applications: updated }, setConfig));
              }}
            />
          )}
          {config && active === 'search' && (
            <SearchConfigTable
              search={config.search}
              modelOptions={searchRerankModelOptions}
              modelLoading={searchRerankModelLoading}
              modelError={searchRerankModelError}
              saving={saving}
              onEditRerankModel={() => void openSearchRerankModelDialog(config.search)}
            />
          )}
          {active === 'bisheng' && (
            <BishengConfigTable
              config={bishengConfig}
              saving={saving}
              onEdit={() => openBishengDialog(bishengConfig)}
            />
          )}
          {active === 'unifiedAuth' && (
            <UnifiedAuthConfigTable
              config={unifiedAuthConfig}
              saving={saving}
              onEdit={() => openUnifiedAuthDialog(unifiedAuthConfig)}
            />
          )}
          {active === 'deptBinding' && (
            <DeptBindingTable
              bindings={groupBindingsByDepartment(deptBindings)}
              saving={saving}
              onAdd={openBindingDialog}
              onRebind={(binding) => {
                setBindingRebindTarget(binding);
                setBindingRebindDraft({ spaceId: binding.space_id, departmentId: binding.department_id });
                void loadRebindDepartments();
              }}
            />
          )}
          {config && active === 'recommend' && (
            <RecommendationPersonalizationPanel
              recommendation={config.recommendation}
              sectionPageSize={config.display.home.section_page_size}
              saving={saving}
              onSave={async (next) => {
                setSaving(true);
                setError('');
                try {
                  await persistRecommendation(next, setConfig);
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : '保存失败');
                  throw saveError;
                } finally {
                  setSaving(false);
                }
              }}
            />
          )}
          {config && active === 'display' && (
            <DisplayConfigTable
              items={displayItems}
              saving={saving}
              onAdjust={(key, delta) => void handleAdjustDisplay(config.display, key, delta, runSave, setConfig)}
            />
          )}
          {config && active === 'banners' && (
            <BannersTable
              banners={config.banners}
              saving={saving}
              onAdd={openCreateBannerDialog}
              onEdit={(index) => openEditBannerDialog(config.banners[index], index)}
              onDelete={(index) => setBannerDeleteIndex(index)}
              onMoveUp={(index) => void handleMoveBanner(config.banners, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveBanner(config.banners, index, 1, runSave, setConfig)}
            />
          )}
          {active === 'courses' && <CourseManagementPanel />}
          {config && active === 'integrations' && (
            <IntegrationsConfigTable
              integrations={config.integrations}
              saving={saving}
              onEdit={() => {
                setIntegrationsDraft(createIntegrationsDraft(config.integrations));
                setIntegrationsDialogError('');
                setIntegrationsDialogOpen(true);
              }}
            />
          )}
          {config && active === 'site' && (
            <SiteConfigTable
              site={createSiteDraft(config.site)}
              saving={saving}
              onEdit={() => {
                setSiteDraft(createSiteDraft(config.site));
                setSiteDialogError('');
                setSiteDialogOpen(true);
              }}
            />
          )}
        </main>
      </div>
      {config && domainEditorOpen ? (
        <DomainEditorDialog
          open
          spaces={spaceOptions}
          spacesLoading={spaceOptionsLoading}
          spacesError={spaceOptionsError}
          departments={domainDepartments}
          departmentsLoading={domainDepartmentsLoading}
          departmentsError={domainDepartmentsError}
          domainCodeOptions={domainCodeOptions}
          draft={domainDraft}
          saving={saving}
          error={domainFormError}
          onClose={() => setDomainEditorOpen(false)}
          onRefreshSpaces={() => void loadSpaceOptions()}
          onRefreshDepartments={() => void loadDomainDepartments()}
          onChange={(patch) => {
            setDomainDraft((current) => ({ ...current, ...patch }));
            setDomainFormError('');
          }}
          onSubmit={() => {
            const result = validateDomainDraft(domainDraft, spaceOptions);
            if (!result.domain) {
              setDomainFormError(result.error || '业务域配置无效');
              return;
            }
            if (domainEditorIndex === null) {
              void handleAddDomain(config.domains, result.domain, runSave, setConfig, {
                onSuccess: () => {
                  setDomainEditorOpen(false);
                  showToast('业务域添加成功');
                }
              });
              return;
            }
            void handleEditDomain(config.domains, domainEditorIndex, result.domain, runSave, setConfig, {
              onSuccess: () => {
                setDomainEditorOpen(false);
                showToast('业务域编辑成功');
              }
            });
          }}
        />
      ) : null}
      {config && domainDeleteIndex !== null ? (
        <DomainDeleteDialog
          open
          domain={config.domains[domainDeleteIndex]}
          spaceName={formatDomainBoundSpaceText(config.domains[domainDeleteIndex], spaceOptions)}
          saving={saving}
          onClose={() => setDomainDeleteIndex(null)}
          onConfirm={() => {
            void handleDeleteDomain(config.domains, domainDeleteIndex, runSave, setConfig, {
              confirm: false,
              onSuccess: () => {
                setDomainDeleteIndex(null);
                showToast('业务域删除成功');
              }
            });
          }}
        />
      ) : null}
      {config && sectionEditorOpen ? (
        <SectionEditorDialog
          open
          draft={sectionDraft}
          saving={saving}
          error={sectionFormError}
          onClose={() => setSectionEditorOpen(false)}
          onChange={(patch) => {
            setSectionDraft((current) => ({ ...current, ...patch }));
            setSectionFormError('');
          }}
          onSubmit={() => {
            const result = validateSectionDraft(sectionDraft);
            if (!result.section) {
              setSectionFormError(result.error || '首页分区配置无效');
              return;
            }
            if (sectionEditorIndex === null) {
              void handleAddSection(config.sections, result.section, runSave, setConfig, {
                onSuccess: () => setSectionEditorOpen(false),
              });
              return;
            }
            void handleEditSection(config.sections, sectionEditorIndex, result.section, runSave, setConfig, {
              onSuccess: () => setSectionEditorOpen(false),
            });
          }}
        />
      ) : null}
      {config && sectionDeleteIndex !== null ? (
        <SectionDeleteDialog
          open
          section={config.sections[sectionDeleteIndex]}
          saving={saving}
          onClose={() => setSectionDeleteIndex(null)}
          onConfirm={() => {
            void handleDeleteSection(config.sections, sectionDeleteIndex, runSave, setConfig, {
              confirm: false,
              onSuccess: () => setSectionDeleteIndex(null),
            });
          }}
        />
      ) : null}
      {documentTypeDialogOpen ? (
        <DocumentTypeEditorDialog
          open
          title={documentTypeEditIndex !== null ? '编辑文件分类' : '新增文件分类'}
          draft={documentTypeDraft}
          saving={saving}
          error={documentTypeDialogError}
          onClose={() => setDocumentTypeDialogOpen(false)}
          onChange={(updater) => {
            setDocumentTypeDraft(updater);
            setDocumentTypeDialogError('');
          }}
          onSubmit={() => void handleConfirmDocumentType()}
        />
      ) : null}
      {config && documentTypeChildrenIndex !== null && config.document_types[documentTypeChildrenIndex] ? (
        <DocumentTypeChildrenDialog
          documentType={config.document_types[documentTypeChildrenIndex]}
          onClose={() => setDocumentTypeChildrenIndex(null)}
        />
      ) : null}
      {bishengEditorOpen ? (
        <BishengEditorDialog
          open
          draft={bishengDraft}
          saving={saving}
          error={bishengFormError}
          hasToken={Boolean(bishengConfig?.has_token)}
          onClose={() => setBishengEditorOpen(false)}
          onChange={(patch) => {
            setBishengDraft((current) => ({ ...current, ...patch }));
            setBishengFormError('');
          }}
          onSubmit={() => {
            const result = validateBishengDraft(bishengDraft);
            if (!result.payload) {
              setBishengFormError(result.error || '大模型应用平台配置无效');
              return;
            }
            const nextPayload = result.payload;
            setSaving(true);
            setError('');
            void updateBishengRuntimeConfig(nextPayload)
              .then((updated) => {
                setBishengConfig(updated);
                setBishengEditorOpen(false);
              })
              .catch((err) => {
                const message = err instanceof Error ? err.message : '保存失败';
                setError(message);
                setBishengFormError(message);
              })
              .finally(() => setSaving(false));
          }}
        />
      ) : null}
      {unifiedAuthEditorOpen ? (
        <UnifiedAuthEditorDialog
          open
          draft={unifiedAuthDraft}
          saving={saving}
          error={unifiedAuthFormError}
          config={unifiedAuthConfig}
          onClose={() => setUnifiedAuthEditorOpen(false)}
          onChange={(patch) => {
            setUnifiedAuthDraft((current) => ({ ...current, ...patch }));
            setUnifiedAuthFormError('');
          }}
          onSubmit={() => {
            const result = validateUnifiedAuthDraft(unifiedAuthDraft);
            if (!result.payload) {
              setUnifiedAuthFormError(result.error || '统一认证配置无效');
              return;
            }
            setSaving(true);
            setError('');
            void updateUnifiedAuthRuntimeConfig(result.payload)
              .then((updated) => {
                setUnifiedAuthConfig(updated);
                setUnifiedAuthEditorOpen(false);
              })
              .catch((err) => {
                const message = err instanceof Error ? err.message : '保存失败';
                setError(message);
                setUnifiedAuthFormError(message);
              })
              .finally(() => setSaving(false));
          }}
        />
      ) : null}
      {bindingDialogOpen ? (
        <DeptBindingDialog
          open
          spaces={bindableSpaces}
          departments={bindingDepartments}
          draft={bindingDraft}
          saving={saving}
          error={error}
          onClose={() => setBindingDialogOpen(false)}
          onChange={(patch) => setBindingDraft((current) => ({ ...current, ...patch }))}
          onSubmit={handleBindSpace}
        />
      ) : null}
      {bindingUnbindTarget ? (
        <DeptUnbindConfirmDialog
          open
          binding={bindingUnbindTarget}
          saving={saving}
          error={error}
          onClose={() => setBindingUnbindTarget(null)}
          onConfirm={() => {
            const target = bindingUnbindTarget;
            handleUnbindSpace(target.space_id, () => setBindingUnbindTarget(null));
          }}
        />
      ) : null}
      {bindingRebindTarget ? (
        <DeptRebindDialog
          open
          binding={bindingRebindTarget}
          departments={rebindDepartments}
          disabledIds={rebindDisabledIds}
          departmentsLoading={rebindDepartmentsLoading}
          draft={bindingRebindDraft}
          saving={saving}
          error={error}
          onClose={() => {
            setBindingRebindTarget(null);
            setBindingRebindDraft(createBindingDraft());
            setRebindDepartments([]);
            setRebindDisabledIds(new Set());
          }}
          onChange={(patch) => setBindingRebindDraft((current) => ({ ...current, ...patch }))}
          onSubmit={handleRebindSpace}
        />
      ) : null}
      {config && qaDialogMode ? (
        <TextEditorDialog
          open
          title={getQaDialogTitle(qaDialogMode)}
          note={getQaDialogNote(qaDialogMode)}
          label={getQaDialogLabel(qaDialogMode)}
          value={qaTextDraft}
          saving={saving}
          error={qaDialogError}
          multiline
          placeholder={getQaDialogPlaceholder(qaDialogMode)}
          onClose={() => setQaDialogMode(null)}
          onChange={(value) => {
            setQaTextDraft(value);
            setQaDialogError('');
          }}
          onSubmit={() => {
            const trimmed = qaTextDraft.trim();
            if (!trimmed) {
              setQaDialogError('请输入内容');
              return;
            }
            const nextQa =
              qaDialogMode === 'hot_questions'
                ? { ...config.qa, hot_questions: qaTextDraft.split('\n').map((item) => item.trim()).filter(Boolean) }
                : { ...config.qa, [qaDialogMode]: trimmed };
            if (qaDialogMode === 'hot_questions' && !nextQa.hot_questions.length) {
              setQaDialogError('请至少保留一条热门问题');
              return;
            }
            void runSave(async () => {
              await persistQa(nextQa, setConfig);
              setQaDialogMode(null);
            });
          }}
        />
      ) : null}
      {config && qaModelDialogOpen ? (
        <QaModelDialog
          open
          models={qaModelOptions}
          selectedModels={qaModelDraft}
          loading={qaModelLoading}
          saving={saving}
          error={qaModelError}
          managementUrl={config.integrations?.bisheng_admin_entry_url || ''}
          onClose={() => setQaModelDialogOpen(false)}
          onSelect={(field, modelId) => setQaModelDraft((current) => ({ ...current, [field]: modelId }))}
          onSubmit={() => {
            const generalModelAvailable = qaModelOptions.some((model) => model.id === qaModelDraft.general_model);
            const reasoningModelAvailable = !qaModelDraft.reasoning_model
              || qaModelOptions.some((model) => model.id === qaModelDraft.reasoning_model);
            if (!qaModelDraft.general_model || !generalModelAvailable) {
              setQaModelError('当前通用模型已停用或不可用，请重新选择');
              return;
            }
            if (!reasoningModelAvailable) {
              setQaModelError('当前推理模型已停用或不可用，请重新选择或设为不配置');
              return;
            }
            void runSave(async () => {
              const generalModelDisplayName = resolveQaModelDisplayNameSnapshot(
                qaModelOptions,
                qaModelDraft.general_model,
                config.qa.general_model || config.qa.selected_model,
                config.qa.general_model_display_name,
              );
              const reasoningModelDisplayName = resolveQaModelDisplayNameSnapshot(
                qaModelOptions,
                qaModelDraft.reasoning_model,
                config.qa.reasoning_model,
                config.qa.reasoning_model_display_name,
              );
              await persistQa({
                ...config.qa,
                selected_model: qaModelDraft.general_model,
                general_model: qaModelDraft.general_model,
                reasoning_model: qaModelDraft.reasoning_model,
                general_model_display_name: generalModelDisplayName,
                reasoning_model_display_name: reasoningModelDisplayName,
              }, setConfig);
              setQaModelDialogOpen(false);
            });
          }}
        />
      ) : null}
      {config && searchRerankModelDialogOpen ? (
        <SearchRerankModelDialog
          open
          models={searchRerankModelOptions}
          selectedModel={searchRerankModelDraft}
          loading={searchRerankModelLoading}
          saving={saving}
          error={searchRerankModelError}
          onClose={() => setSearchRerankModelDialogOpen(false)}
          onSelect={setSearchRerankModelDraft}
          onSubmit={() => {
            void runSave(async () => {
              await persistSearch({
                ...config.search,
                rerank_model_id: searchRerankModelDraft,
              }, setConfig);
              setSearchRerankModelDialogOpen(false);
            });
          }}
        />
      ) : null}
      {config && qaCategoryEditorOpen ? (
        <QaTemplateCategoryDialog
          open
          draft={qaCategoryDraft}
          saving={saving}
          error={qaCategoryFormError}
          onClose={() => setQaCategoryEditorOpen(false)}
          onChange={(patch) => {
            setQaCategoryDraft((current) => ({ ...current, ...patch }));
            setQaCategoryFormError('');
          }}
          onSubmit={() => {
            const currentId = qaCategoryEditorIndex === null
              ? undefined
              : config.qa.template_categories[qaCategoryEditorIndex]?.id;
            const result = validateQaTemplateCategoryDraft(qaCategoryDraft, config.qa.template_categories, currentId);
            if (!result.category) {
              setQaCategoryFormError(result.error || '模板分类配置无效');
              return;
            }
            const nextCategory = result.category;
            void runSave(async () => {
              const updated = [...config.qa.template_categories];
              if (qaCategoryEditorIndex === null) {
                updated.push(nextCategory);
              } else {
                updated[qaCategoryEditorIndex] = nextCategory;
              }
              await persistQa({ ...config.qa, template_categories: updated }, setConfig);
              setQaCategoryEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && qaCategoryDeleteTarget ? (
        <QaTemplateCategoryDeleteDialog
          open
          category={qaCategoryDeleteTarget.category}
          saving={saving}
          onClose={() => setQaCategoryDeleteTarget(null)}
          onConfirm={() => {
            const target = qaCategoryDeleteTarget;
            if (!canDeleteQaTemplateCategory(target.category.id, config.qa.templates)) {
              setQaCategoryDeleteTarget(null);
              setError('该分类下仍有关联模板，请先调整或删除模板。');
              return;
            }
            void runSave(async () => {
              await persistQa({
                ...config.qa,
                template_categories: config.qa.template_categories.filter((_, index) => index !== target.index),
              }, setConfig);
              setQaCategoryDeleteTarget(null);
            });
          }}
        />
      ) : null}
      {config && qaTemplateEditorOpen ? (
        <QaTemplateDialog
          open
          draft={qaTemplateDraft}
          categories={config.qa.template_categories}
          saving={saving}
          error={qaTemplateFormError}
          onClose={() => setQaTemplateEditorOpen(false)}
          onChange={(patch) => {
            setQaTemplateDraft((current) => ({ ...current, ...patch }));
            setQaTemplateFormError('');
          }}
          onSubmit={() => {
            const currentId = qaTemplateEditorIndex === null
              ? undefined
              : config.qa.templates[qaTemplateEditorIndex]?.id;
            const result = validateQaTemplateDraft(qaTemplateDraft, config.qa.template_categories, config.qa.templates, currentId);
            if (!result.template) {
              setQaTemplateFormError(result.error || '问答模板配置无效');
              return;
            }
            const nextTemplate = result.template;
            void runSave(async () => {
              const updated = [...config.qa.templates];
              if (qaTemplateEditorIndex === null) {
                updated.push(nextTemplate);
              } else {
                updated[qaTemplateEditorIndex] = nextTemplate;
              }
              await persistQa({ ...config.qa, templates: updated }, setConfig);
              setQaTemplateEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && qaTemplateDeleteTarget ? (
        <QaTemplateDeleteDialog
          open
          template={qaTemplateDeleteTarget.template}
          saving={saving}
          onClose={() => setQaTemplateDeleteTarget(null)}
          onConfirm={() => {
            const target = qaTemplateDeleteTarget;
            void runSave(async () => {
              await persistQa({
                ...config.qa,
                templates: config.qa.templates.filter((_, index) => index !== target.index),
              }, setConfig);
              setQaTemplateDeleteTarget(null);
            });
          }}
        />
      ) : null}
      {config && agentCategoryEditorOpen ? (
        <AgentCategoryDialog
          open
          draft={agentCategoryDraft}
          saving={saving}
          error={agentCategoryFormError}
          onClose={() => setAgentCategoryEditorOpen(false)}
          onChange={(patch) => {
            setAgentCategoryDraft((current) => ({ ...current, ...patch }));
            setAgentCategoryFormError('');
          }}
          onSubmit={() => {
            const result = validateAgentCategoryDraft(agentCategoryDraft);
            if (result) {
              setAgentCategoryFormError(result);
              return;
            }
            const nextCategory = toAgentCategoryConfig(agentCategoryDraft);
            const currentId = agentCategoryEditorIndex === null
              ? undefined
              : config.agent_config.categories[agentCategoryEditorIndex]?.id;
            const duplicate = config.agent_config.categories.some((category, index) => (
              category.id === nextCategory.id && (currentId === undefined || index !== agentCategoryEditorIndex)
            ));
            if (duplicate) {
              setAgentCategoryFormError('分类 ID 不能重复。');
              return;
            }
            void runSave(async () => {
              const categories = [...config.agent_config.categories];
              if (agentCategoryEditorIndex === null) {
                categories.push(nextCategory);
              } else {
                categories[agentCategoryEditorIndex] = nextCategory;
              }
              const applications = config.agent_config.applications.map((application) => (
                currentId && application.category_id === currentId
                  ? { ...application, category_id: nextCategory.id }
                  : application
              ));
              await persistAgentConfig({ categories, applications }, setConfig);
              setAgentCategoryEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && agentCategoryDeleteTarget ? (
        <AgentCategoryDeleteDialog
          open
          category={agentCategoryDeleteTarget.category}
          saving={saving}
          onClose={() => setAgentCategoryDeleteTarget(null)}
          onConfirm={() => {
            const target = agentCategoryDeleteTarget;
            const deleteState = canDeleteAgentCategory(target.category, config.agent_config.applications);
            if (!deleteState.canDelete) {
              setAgentCategoryDeleteTarget(null);
              setError(deleteState.reason);
              return;
            }
            void runSave(async () => {
              await persistAgentConfig({
                ...config.agent_config,
                categories: config.agent_config.categories.filter((_, index) => index !== target.index),
              }, setConfig);
              setAgentCategoryDeleteTarget(null);
            });
          }}
        />
      ) : null}
      {config && agentEditorOpen ? (
        <AgentDialog
          open
          draft={agentDraft}
          categories={config.agent_config.categories}
          workflowOptions={agentWorkflowOptions}
          workflowLoading={agentWorkflowLoading}
          workflowError={agentWorkflowError}
          workflowKeyword={agentWorkflowKeyword}
          workflowHasMore={agentWorkflowHasMore}
          saving={saving}
          error={agentFormError}
          onClose={() => setAgentEditorOpen(false)}
          onChange={(patch) => {
            setAgentDraft((current) => ({ ...current, ...patch }));
            setAgentFormError('');
          }}
          onWorkflowKeywordChange={setAgentWorkflowKeyword}
          onRefreshWorkflows={() => void loadAgentWorkflowOptions(agentWorkflowKeyword)}
          onLoadMoreWorkflows={() => void loadAgentWorkflowOptions(agentWorkflowLoadedKeyword, {
            cursor: agentWorkflowNextCursor,
            append: true,
          })}
          onSelectWorkflow={(workflow) => {
            setAgentDraft((current) => ({
              ...current,
              workflowId: workflow.workflow_id,
              name: current.name.trim() ? current.name : workflow.name,
              desc: current.desc.trim() ? current.desc : workflow.desc,
            }));
            setAgentFormError('');
          }}
          onSubmit={() => {
            const draftError = validateAgentDraft(agentDraft);
            if (draftError) {
              setAgentFormError(draftError);
              return;
            }
            const nextAgent = toAgentItemConfig(agentDraft);
            const applications = [...config.agent_config.applications];
            if (agentEditorIndex === null) {
              applications.push(nextAgent);
            } else {
              applications[agentEditorIndex] = nextAgent;
            }
            const configError = validateAgentConfig({ ...config.agent_config, applications });
            if (configError) {
              setAgentFormError(configError);
              return;
            }
            void runSave(async () => {
              await persistAgentConfig({ ...config.agent_config, applications }, setConfig);
              setAgentEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && urlApplicationEditorOpen ? (
        <UrlApplicationDialog
          open
          draft={urlApplicationDraft}
          categories={config.agent_config.categories}
          saving={saving}
          uploading={urlApplicationIconUploading}
          error={urlApplicationFormError}
          onClose={() => setUrlApplicationEditorOpen(false)}
          onChange={(patch) => {
            setUrlApplicationDraft((current) => ({ ...current, ...patch }));
            setUrlApplicationFormError('');
          }}
          onUploadIcon={async (file) => {
            setUrlApplicationIconUploading(true);
            setUrlApplicationFormError('');
            try {
              const data = await uploadApplicationIcon(file);
              setUrlApplicationDraft((current) => ({ ...current, iconImageUrl: data.image_url }));
            } catch (uploadError) {
              setUrlApplicationFormError(uploadError instanceof Error ? uploadError.message : '图标上传失败');
            } finally {
              setUrlApplicationIconUploading(false);
            }
          }}
          onSubmit={() => {
            const draftError = validateAgentDraft(urlApplicationDraft);
            if (draftError) {
              setUrlApplicationFormError(draftError);
              return;
            }
            const nextApplication = toAgentItemConfig(urlApplicationDraft);
            const applications = [...config.agent_config.applications];
            if (urlApplicationEditorIndex === null) {
              applications.push(nextApplication);
            } else {
              applications[urlApplicationEditorIndex] = nextApplication;
            }
            const configError = validateAgentConfig({ ...config.agent_config, applications });
            if (configError) {
              setUrlApplicationFormError(configError);
              return;
            }
            void runSave(async () => {
              await persistAgentConfig({ ...config.agent_config, applications }, setConfig);
              setUrlApplicationEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && agentDeleteTarget ? (
        <AgentDeleteDialog
          open
          agent={agentDeleteTarget.agent}
          saving={saving}
          onClose={() => setAgentDeleteTarget(null)}
          onConfirm={() => {
            const target = agentDeleteTarget;
            void runSave(async () => {
              await persistAgentConfig({
                ...config.agent_config,
                applications: config.agent_config.applications.filter((_, index) => index !== target.index),
              }, setConfig);
              setAgentDeleteTarget(null);
            });
          }}
        />
      ) : null}
      {config && bannerEditorOpen ? (
        <BannerEditorDialog
          open
          draft={bannerDraft}
          saving={saving}
          error={bannerFormError}
          onClose={() => setBannerEditorOpen(false)}
          onChange={(patch) => {
            setBannerDraft((current) => ({ ...current, ...patch }));
            setBannerFormError('');
          }}
          onSubmit={() => {
            const result = validateBannerDraft(bannerDraft);
            if (!result.banner) {
              setBannerFormError(result.error || 'Banner 配置无效');
              return;
            }
            const nextBanner = result.banner;
            void runSave(async () => {
              if (bannerEditorIndex === null) {
                await persistBanners([...config.banners, nextBanner], setConfig);
              } else {
                const updated = [...config.banners];
                updated[bannerEditorIndex] = nextBanner;
                await persistBanners(updated, setConfig);
              }
              setBannerEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && deletingBanner ? (
        <BannerDeleteDialog
          open
          banner={deletingBanner}
          saving={saving}
          onClose={() => setBannerDeleteIndex(null)}
          onConfirm={() => {
            if (bannerDeleteIndex === null) return;
            void runSave(async () => {
              await persistBanners(config.banners.filter((_, index) => index !== bannerDeleteIndex), setConfig);
              setBannerDeleteIndex(null);
            });
          }}
        />
      ) : null}
      {config && integrationsDialogOpen ? (
        <IntegrationsEditorDialog
          open
          draft={integrationsDraft}
          saving={saving}
          error={integrationsDialogError}
          onClose={() => setIntegrationsDialogOpen(false)}
          onChange={(value) => {
            setIntegrationsDraft(value);
            setIntegrationsDialogError('');
          }}
          onSubmit={() => {
            const nextIntegrations = {
              bisheng_admin_entry_url: integrationsDraft.bisheng_admin_entry_url.trim(),
              bisheng_knowledge_entry_url: integrationsDraft.bisheng_knowledge_entry_url.trim(),
            };
            const invalidField = Object.values(nextIntegrations).find((value) => value && !/^https?:\/\//i.test(value));
            if (invalidField) {
              setIntegrationsDialogError('URL 需以 http:// 或 https:// 开头；如要清空请删除全部内容。');
              return;
            }
            void runSave(async () => {
              await persistIntegrations(nextIntegrations, setConfig);
              setIntegrationsDialogOpen(false);
            });
          }}
        />
      ) : null}
      {config && siteDialogOpen ? (
        <SiteEditorDialog
          open
          draft={siteDraft}
          saving={saving}
          error={siteDialogError}
          onClose={() => setSiteDialogOpen(false)}
          onChange={(value) => {
            setSiteDraft(value);
            setSiteDialogError('');
          }}
          onSubmit={() => {
            const result = validateSiteDraft(siteDraft);
            if (result.error || !result.site) {
              setSiteDialogError(result.error || '站点配置无效');
              return;
            }
            const nextSite = result.site;
            void runSave(async () => {
              await persistSite(nextSite, setConfig);
              setSiteDialogOpen(false);
            });
          }}
        />
      ) : null}
    </>
  );
}

function DomainsTable({
  domains,
  spaces,
  spaceOptionsLoaded,
  spaceOptionsError,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  domains: DomainConfig[];
  spaces: SpaceOption[];
  spaceOptionsLoaded: boolean;
  spaceOptionsError: string;
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>业务域管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      {/* TODO: Confirm with product whether domain cards should use photo backgrounds, logo/icon cards, or support both as a configurable strategy. */}
      <p className={s.pageNote}>
        待与产品确认最终卡片策略：业务域卡片是采用“图片背景卡”还是“Logo/图标卡”，后台当前同时预留背景图和 Logo/图标 配置位。首页业务域导航当前按前端数组顺序取前 N 个展示，业务域通过新增和删除管理，不单独做停用。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>业务域名称</th>
            <th>Logo/图标</th>
            <th>背景图</th>
            <th>绑定空间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d, index) => {
            const boundSpaceText = formatDomainBoundSpaceText(d, spaces);
            const boundSpaceIds = getDomainBoundSpaceIds(d, spaces);
            const boundSpaceNames = new Map(spaces.map((space) => [space.id, space.name]));
            const boundSpaceNameText = boundSpaceIds
              .map((spaceId) => boundSpaceNames.get(spaceId) || String(spaceId))
              .join('、');
            const deleteBlockReason = !spaceOptionsLoaded
              ? '正在加载有效知识空间，暂不能确认绑定关系'
              : spaceOptionsError
                ? '候选空间加载失败，暂不能确认绑定关系'
                : boundSpaceIds.length > 0
                  ? `已绑定知识空间：${boundSpaceNameText}，请先解除绑定后再删除`
                  : '';
            const visualPreset = getDomainVisualPreset(d);
            const backgroundImage = visualPreset.backgroundImage;
            return (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td><AdminIconCell icon={d.icon} color={d.color} bg={d.bg} /></td>
                <td>
                  {backgroundImage ? (
                    <img src={backgroundImage} alt={`${d.name} 背景`} className={s.backgroundPreview} />
                  ) : (
                    '未配置'
                  )}
                </td>
                <td>
                  {boundSpaceText
                    ? boundSpaceText
                    : d.space_ids.length > 0
                      ? d.space_ids.join(', ')
                      : <span className={s.unboundBadge} title="未绑定的业务域不会显示在前台首页">未绑定 · 待补绑定</span>}
                </td>
                <td>
                  <div className={s.actionGroup}>
                    <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                    <span title={deleteBlockReason || '删除'}>
                      <button
                        className={deleteBlockReason ? s.inlineMutedBtn : s.inlineDangerBtn}
                        onClick={() => onDelete(index)}
                        disabled={saving || Boolean(deleteBlockReason)}
                      >
                        删除
                      </button>
                    </span>
                    <button
                      className={s.iconActionBtn}
                      onClick={() => onMoveUp(index)}
                      disabled={saving || index === 0}
                      aria-label={`上移${d.name}`}
                      title="上移"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className={s.iconActionBtn}
                      onClick={() => onMoveDown(index)}
                      disabled={saving || index === domains.length - 1}
                      aria-label={`下移${d.name}`}
                      title="下移"
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function AdminIconCell({
  icon,
  color,
  bg,
}: {
  icon: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={s.logoCell}>
      <DomainIcon icon={icon} color={color} bg={bg} size={36} />
      <span>{icon}</span>
    </div>
  );
}

function DomainEditorDialog({
  open,
  spaces,
  spacesLoading,
  spacesError,
  departments,
  departmentsLoading,
  departmentsError,
  domainCodeOptions,
  draft,
  saving,
  error,
  onClose,
  onRefreshSpaces,
  onRefreshDepartments,
  onChange,
  onSubmit,
}: {
  open: boolean;
  spaces: SpaceOption[];
  spacesLoading: boolean;
  spacesError: string;
  departments: DepartmentOption[];
  departmentsLoading: boolean;
  departmentsError: string;
  domainCodeOptions: DomainCodeOption[];
  draft: DomainDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onRefreshSpaces: () => void;
  onRefreshDepartments: () => void;
  onChange: (patch: Partial<DomainDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  const selectedSpaceIds = new Set(draft.spaceIds);
  const selectedSpaces = draft.spaceIds.map((spaceId) => {
    const numericId = Number(spaceId);
    return spaces.find((space) => space.id === numericId) ?? {
      id: numericId,
      name: spaceId,
      description: '',
      file_count: 0,
      space_level: '',
      business_domain_codes: [],
    };
  });
  const toggleSpace = (spaceId: string) => {
    if (selectedSpaceIds.has(spaceId)) {
      onChange({ spaceIds: draft.spaceIds.filter((id) => id !== spaceId) });
      return;
    }
    onChange({ spaceIds: [...draft.spaceIds, spaceId] });
  };
  const removeSpace = (spaceId: string) => {
    onChange({ spaceIds: draft.spaceIds.filter((id) => id !== spaceId) });
  };

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.name.trim() ? `编辑业务域 · ${draft.name}` : '新增业务域'}</h3>
            <p className={s.modalNote}>一个业务域可绑定多个公共或部门知识空间，前台按数组顺序展示。需要下线时直接删除该业务域。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域名称</span>
            <input
              className={s.formInput}
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="例如：轧线"
            />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域编码</span>
            <input
              className={s.formInput}
              value={draft.code}
              list="domain-code-options"
              onChange={(event) => onChange({ code: event.target.value })}
              placeholder="例如：PP（生产）"
            />
            <datalist id="domain-code-options">
              {domainCodeOptions.map((option, index) => (
                <option key={`${option.code}-${index}`} value={option.code}>{`${option.code} ${option.label}`}</option>
              ))}
            </datalist>
            <span className={s.fieldHint}>对应文件编码第 3 段（如 SGGF-STD-PP-… 中的 PP）。可从候选快速选择，也可手动填写；留空则该业务域知识数量按 0 计。保存时统一转大写。</span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>绑定部门</span>
            <DomainDepartmentMultiSelect
              id="domain-departments"
              value={draft.departmentIds}
              departments={departments}
              disabled={departmentsLoading}
              onChange={(departmentIds) => onChange({ departmentIds })}
            />
            {departmentsLoading ? <span className={s.fieldHint}>正在加载部门树...</span> : null}
            {departmentsError ? (
              <span className={s.fieldHint}>
                {departmentsError}
                <button type="button" className={s.inlineBtn} onClick={onRefreshDepartments} disabled={departmentsLoading}>
                  重新加载
                </button>
              </span>
            ) : null}
            <span className={s.fieldHint}>可选择多个部门；父部门和子部门独立勾选，不会级联选择。本配置仅供后台管理使用，不改变门户展示或权限。</span>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>绑定空间</span>
            <div className={s.spaceMultiPicker}>
              {spacesLoading ? <div className={s.spacePickerEmpty}>正在加载候选空间...</div> : null}
              {getDomainBindableSpaceGroups(spaces).map((group) => {
                const groupSpaceIds = group.options.map((space) => String(space.id));
                const allGroupSelected =
                  groupSpaceIds.length > 0 &&
                  groupSpaceIds.every((id) => selectedSpaceIds.has(id));
                const toggleGroup = () => {
                  if (allGroupSelected) {
                    onChange({
                      spaceIds: draft.spaceIds.filter(
                        (id) => !groupSpaceIds.includes(id),
                      ),
                    });
                  } else {
                    onChange({
                      spaceIds: Array.from(new Set([...draft.spaceIds, ...groupSpaceIds])),
                    });
                  }
                };

                return (
                  <div key={group.level} className={s.spacePickerGroup}>
                    <div className={s.spacePickerGroupHead}>
                      <div className={s.spacePickerGroupTitle}>{group.label}</div>
                      {group.options.length ? (
                        <label className={s.spacePickerGroupSelectAll}>
                          <span>全选</span>
                          <input
                            type="checkbox"
                            checked={allGroupSelected}
                            onChange={toggleGroup}
                          />
                        </label>
                      ) : null}
                    </div>
                    {group.options.length ? (
                      group.options.map((space) => (
                        <label key={space.id} className={s.spacePickerOption}>
                          <input
                            type="checkbox"
                            checked={selectedSpaceIds.has(String(space.id))}
                            onChange={() => toggleSpace(String(space.id))}
                          />
                          <span className={s.spacePickerName}>{space.name}</span>
                          {(space.business_domain_codes ?? []).length ? (
                            <span className={s.spacePickerMeta}>{space.business_domain_codes?.join(' / ')}</span>
                          ) : null}
                        </label>
                      ))
                    ) : (
                      <div className={s.spacePickerEmpty}>暂无{group.label}</div>
                    )}
                </div>
              );
            })}
            </div>
            <div className={s.selectedSpaceChips}>
              {selectedSpaces.length ? selectedSpaces.map((space) => (
                <button
                  key={space.id}
                  type="button"
                  className={s.selectedSpaceChip}
                  onClick={() => removeSpace(String(space.id))}
                  title="取消绑定"
                >
                  <span>{space.name}</span>
                  <X size={13} />
                </button>
              )) : (
                <span className={s.unboundBadge} title="未绑定的业务域不会显示在前台首页">未绑定 · 待补绑定</span>
              )}
            </div>
            {spacesError ? (
              <span className={s.fieldHint}>
                {spacesError}
                <button type="button" className={s.inlineBtn} onClick={onRefreshSpaces} disabled={spacesLoading}>
                  重新加载
                </button>
              </span>
            ) : null}
            <span className={s.fieldHint}>未绑定的业务域只在后台可见，绑定知识空间后会按数组顺序出现在首页业务域导航。</span>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>首页统计口径</span>
            <div className={s.emptyState}>首页业务域卡片「知识数量」来自全部知识库中文件编码第 3 段等于该业务域编码、且解析成功的文档数。</div>
            <span className={s.fieldHint}>
              数量口径由「业务域编码」决定，与绑定空间无关；未配编码则显示 0。统计结果带缓存（见站点配置的缓存有效期）。
            </span>
          </div>
          <label className={s.formField}>
            <span className={s.fieldLabel}>背景图</span>
            <input
              className={s.formInput}
              value={draft.backgroundImage}
              onChange={(event) => onChange({ backgroundImage: event.target.value })}
              placeholder="https://example.com/domain.jpg 或 /rolling-domain-bg.jpg"
            />
            <span className={s.fieldHint}>
              支持两种格式：网络图片 URL（例如 `https://example.com/domain.jpg`）或站点本地静态路径（例如 `/rolling-domain-bg.jpg`，也兼容 `rolling-domain-bg.jpg`）。
            </span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>图标</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                  onClick={() => onChange({ icon })}
                >
                  <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                  <span className={s.optionLabel}>{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>颜色</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`${s.colorOptionBtn} ${isSelectedDomainColor(draft, option) ? s.colorOptionBtnActive : ''}`}
                  onClick={() => onChange({ color: option.color, bg: option.bg })}
                >
                  <span className={s.colorPairPreview}>
                    <span className={s.colorSwatchMain} style={{ background: option.color }} />
                    <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                  </span>
                  <span className={s.optionLabel}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function formatDomainBoundSpaceText(domain: DomainConfig, spaces: SpaceOption[]): string {
  if (!domain.space_ids.length) return '';
  const spaceNameById = new Map(spaces.map((space) => [space.id, space.name]));
  return domain.space_ids
    .map((spaceId) => spaceNameById.get(spaceId) || String(spaceId))
    .join('、');
}

function DomainDeleteDialog({
  open,
  domain,
  spaceName,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  domain: DomainConfig;
  spaceName?: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除业务域</h3>
            <p className={s.modalNote}>删除后该业务域入口会从首页和业务域页消失，但不会影响原知识空间。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>业务域名称：</strong>{domain.name}</div>
          <div className={s.confirmLine}><strong>绑定空间：</strong>{spaceName || domain.space_ids.join(', ')}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function DeptBindingTable({
  bindings,
  saving,
  onAdd,
  onRebind,
}: {
  bindings: DeptBinding[];
  saving: boolean;
  onAdd: () => void;
  onRebind: (binding: DeptBinding) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>科室知识库绑定</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 新增绑定</button>
      </div>
      <p className={s.pageNote}>
        将团队/科室知识库绑定给科室后，该库归属对应科室：删除时需先在此解绑，解绑后方可正常删除。未绑定的自由团队库删除时，若创建者主部门已有绑定库，会自动将文件迁移过去后再清空自身。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>知识库名称</th>
            <th>所属部门</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {bindings.map((binding) => (
            <tr key={binding.space_id}>
              <td>{binding.space_name}</td>
              <td>{binding.department_name}</td>
              <td>{binding.create_time ? formatDisplayDateTime(binding.create_time) : '-'}</td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onRebind(binding)} disabled={saving}>更绑</button>
                </div>
              </td>
            </tr>
          ))}
          {!bindings.length ? (
            <tr><td colSpan={4}><div className={s.emptyState}>暂无绑定，点击右上角「新增绑定」创建一条。</div></td></tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

interface SearchableBindingOption {
  value: number;
  label: string;
}

function SearchableBindingSelect({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  onChange,
}: {
  id: string;
  value: number | null;
  options: SearchableBindingOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;
  const selectedOption = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-Hans-CN');
    if (!keyword) return options;
    return options.filter((option) => option.label.toLocaleLowerCase('zh-Hans-CN').includes(keyword));
  }, [options, query]);
  const activeIndex = Math.min(highlightedIndex, Math.max(filteredOptions.length - 1, 0));

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    const selectedIndex = options.findIndex((option) => option.value === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const selectOption = (option: SearchableBindingOption) => {
    onChange(option.value);
    closeMenu(true);
  };

  const moveHighlight = (offset: number) => {
    if (!filteredOptions.length) return;
    setHighlightedIndex((current) => (current + offset + filteredOptions.length) % filteredOptions.length);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === 'Enter' && filteredOptions[activeIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  return (
    <div className={s.searchableSelect} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${s.searchableSelectTrigger} ${open ? s.searchableSelectTriggerOpen : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span
          className={selectedOption ? s.searchableSelectValue : s.searchableSelectPlaceholder}
          title={selectedOption?.label}
        >
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className={s.searchableSelectChevron} size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className={s.searchableSelectMenu}>
          <div className={s.searchableSelectSearchWrap}>
            <SearchIcon size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              className={s.searchableSelectSearch}
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              aria-activedescendant={filteredOptions[activeIndex] ? `${id}-option-${filteredOptions[activeIndex].value}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleMenuKeyDown}
            />
          </div>
          <div ref={listRef} id={listboxId} className={s.searchableSelectOptions} role="listbox">
            {filteredOptions.map((option, index) => {
              const selected = option.value === value;
              const highlighted = index === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`${id}-option-${option.value}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-option-index={index}
                  className={`${s.searchableSelectOption} ${highlighted ? s.searchableSelectOptionHighlighted : ''} ${selected ? s.searchableSelectOptionSelected : ''}`}
                  title={option.label}
                  onPointerMove={() => setHighlightedIndex(index)}
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                  {selected ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              );
            })}
            {!filteredOptions.length ? <div className={s.searchableSelectEmpty}>{emptyText}</div> : null}
          </div>
          <div className={s.searchableSelectMeta} aria-live="polite">
            {query ? `找到 ${filteredOptions.length} 项` : `共 ${options.length} 项可选`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TreeBindingDepartmentSelect({
  id,
  value,
  departments,
  disabled,
  disabledIds,
  onChange,
}: {
  id: string;
  value: number | null;
  departments: DepartmentOption[];
  disabled?: boolean;
  disabledIds?: Set<number>;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const treeId = `${id}-tree`;
  const selectedDepartment = findDepartmentOption(departments, value);
  const visibleDepartments = useMemo(
    () => filterDepartmentOptions(departments, query),
    [departments, query],
  );

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setExpandedIds(new Set());
  };

  const selectDepartment = (departmentId: number) => {
    if (disabledIds?.has(departmentId)) return;
    onChange(departmentId);
    closeMenu(true);
  };

  const toggleDepartment = (departmentId: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const renderDepartment = (department: DepartmentOption, depth: number) => {
    const hasChildren = department.children.length > 0;
    const expanded = Boolean(query.trim()) || expandedIds.has(department.id);
    const selected = department.id === value;
    const isDisabled = disabledIds?.has(department.id) ?? false;
    return (
      <div
        key={department.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selected}
        aria-disabled={isDisabled}
      >
        <div className={s.departmentTreeRow} style={{ paddingLeft: `${10 + depth * 18}px` }}>
          {hasChildren ? (
            <button
              type="button"
              className={`${s.departmentTreeToggle} ${expanded ? s.departmentTreeToggleExpanded : ''}`}
              aria-label={`${expanded ? '收起' : '展开'}${department.name}`}
              onClick={() => toggleDepartment(department.id)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : <span className={s.departmentTreeTogglePlaceholder} aria-hidden="true" />}
          <button
            type="button"
            disabled={isDisabled}
            className={`${s.departmentTreeOption} ${selected ? s.departmentTreeOptionSelected : ''} ${isDisabled ? s.departmentTreeOptionDisabled : ''}`}
            title={isDisabled ? `${department.name}（已绑定）` : department.name}
            onClick={() => selectDepartment(department.id)}
          >
            <span>{department.name}</span>
            {selected ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        </div>
        {hasChildren && expanded ? (
          <div role="group">
            {department.children.map((child) => renderDepartment(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.searchableSelect} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${s.searchableSelectTrigger} ${open ? s.searchableSelectTriggerOpen : ''}`}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-controls={treeId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span
          className={selectedDepartment ? s.searchableSelectValue : s.searchableSelectPlaceholder}
          title={selectedDepartment?.name}
        >
          {selectedDepartment?.name || '请选择科室'}
        </span>
        <ChevronDown className={s.searchableSelectChevron} size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className={s.searchableSelectMenu}>
          <div className={s.searchableSelectSearchWrap}>
            <SearchIcon size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              className={s.searchableSelectSearch}
              type="search"
              value={query}
              placeholder="搜索科室名称"
              aria-label="搜索科室名称"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeMenu(true);
                }
              }}
            />
          </div>
          <div id={treeId} className={s.departmentTreeOptions} role="tree" aria-label="科室树">
            {visibleDepartments.map((department) => renderDepartment(department, 0))}
            {!visibleDepartments.length ? <div className={s.searchableSelectEmpty}>暂无匹配的科室</div> : null}
          </div>
          <div className={s.searchableSelectMeta} aria-live="polite">
            {query ? '展示匹配科室及其所属层级' : `共 ${departments.length} 个顶级部门`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DomainDepartmentMultiSelect({
  id,
  value,
  departments,
  disabled,
  onChange,
}: {
  id: string;
  value: string[];
  departments: DepartmentOption[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const treeId = `${id}-tree`;
  const selectedIds = new Set(value);
  const indeterminateIds = useMemo(
    () => getIndeterminateDepartmentIds(departments, value),
    [departments, value],
  );
  const visibleDepartments = useMemo(
    () => filterDepartmentOptions(departments, query),
    [departments, query],
  );

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setExpandedIds(new Set());
  };

  const toggleDepartment = (departmentId: number) => {
    onChange(toggleSelectedDepartmentId(value, departmentId));
  };

  const toggleExpanded = (departmentId: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const renderDepartment = (department: DepartmentOption, depth: number) => {
    const hasChildren = department.children.length > 0;
    const expanded = Boolean(query.trim()) || expandedIds.has(department.id);
    const selected = selectedIds.has(String(department.id));
    const indeterminate = indeterminateIds.has(department.id);
    return (
      <div
        key={department.id}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-checked={indeterminate ? 'mixed' : selected}
      >
        <div className={s.departmentTreeRow} style={{ paddingLeft: `${10 + depth * 18}px` }}>
          {hasChildren ? (
            <button
              type="button"
              className={`${s.departmentTreeToggle} ${expanded ? s.departmentTreeToggleExpanded : ''}`}
              aria-label={`${expanded ? '收起' : '展开'}${department.name}`}
              onClick={() => toggleExpanded(department.id)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : <span className={s.departmentTreeTogglePlaceholder} aria-hidden="true" />}
          <label
            className={`${s.departmentTreeOption} ${selected ? s.departmentTreeOptionSelected : ''} ${indeterminate ? s.departmentTreeOptionIndeterminate : ''}`}
            title={department.name}
          >
            <input
              type="checkbox"
              checked={selected}
              aria-checked={indeterminate ? 'mixed' : selected}
              ref={(input) => {
                if (input) input.indeterminate = indeterminate;
              }}
              onChange={() => toggleDepartment(department.id)}
            />
            <span>{department.name}</span>
          </label>
        </div>
        {hasChildren && expanded ? (
          <div role="group">
            {department.children.map((child) => renderDepartment(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.searchableSelect} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`${s.searchableSelectTrigger} ${open ? s.searchableSelectTriggerOpen : ''}`}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-controls={treeId}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        <span className={value.length ? s.searchableSelectValue : s.searchableSelectPlaceholder}>
          {value.length ? `已选择 ${value.length} 个部门` : '请选择部门'}
        </span>
        <ChevronDown className={s.searchableSelectChevron} size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className={s.searchableSelectMenu}>
          <div className={s.searchableSelectSearchWrap}>
            <SearchIcon size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              className={s.searchableSelectSearch}
              type="search"
              value={query}
              placeholder="搜索部门名称"
              aria-label="搜索部门名称"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeMenu(true);
                }
              }}
            />
          </div>
          <div id={treeId} className={s.departmentTreeOptions} role="tree" aria-label="部门树（多选）">
            {visibleDepartments.map((department) => renderDepartment(department, 0))}
            {!visibleDepartments.length ? <div className={s.searchableSelectEmpty}>暂无匹配的部门</div> : null}
          </div>
          <div className={s.searchableSelectMeta} aria-live="polite">
            {query ? '展示匹配部门及其所属层级' : `已选择 ${value.length} 个部门`}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeptBindingDialog({
  open,
  spaces,
  departments,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  spaces: BindableSpace[];
  departments: DepartmentOption[];
  draft: BindingDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<BindingDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.modalCard} ${s.bindingModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>新增科室知识库绑定</h3>
            <p className={s.modalNote}>选择一个尚未绑定的团队/科室知识库，绑定给指定科室。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={`${s.formGrid} ${s.bindingFormGrid}`}>
          <div className={s.formField}>
            <label className={s.fieldLabel} htmlFor="dept-binding-space">团队/科室知识库</label>
            <SearchableBindingSelect
              id="dept-binding-space"
              value={draft.spaceId}
              options={spaces.map((space) => ({ value: space.space_id, label: space.name }))}
              placeholder="请选择知识库"
              searchPlaceholder="搜索知识库名称"
              emptyText="暂无匹配的知识库"
              disabled={saving}
              onChange={(spaceId) => onChange({ spaceId })}
            />
            <span className={s.fieldHint}>仅显示尚未绑定的团队/科室知识库</span>
          </div>
          <div className={s.formField}>
            <label className={s.fieldLabel} htmlFor="dept-binding-department">科室</label>
            <TreeBindingDepartmentSelect
              id="dept-binding-department"
              value={draft.departmentId}
              departments={departments}
              disabled={saving}
              onChange={(departmentId) => onChange({ departmentId })}
            />
            <span className={s.fieldHint}>绑定后，该知识库将归属所选科室</span>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || draft.spaceId == null || draft.departmentId == null}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeptUnbindConfirmDialog({
  open,
  binding,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  binding: DeptBinding;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>解绑知识库</h3>
            <p className={s.modalNote}>解绑后该知识库将不再归属科室，此后删除不再受科室库限制；解绑不影响库内已有文件。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>知识库：</strong>{binding.space_name}</div>
          <div className={s.confirmLine}><strong>所属部门：</strong>{binding.department_name}</div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认解绑</button>
        </div>
      </div>
    </div>
  );
}

function DeptRebindDialog({
  open,
  binding,
  departments,
  disabledIds,
  departmentsLoading,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  binding: DeptBinding;
  departments: DepartmentOption[];
  disabledIds: Set<number>;
  departmentsLoading: boolean;
  draft: BindingDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<BindingDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.modalCard} ${s.bindingModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>更绑科室知识库</h3>
            <p className={s.modalNote}>选择新的科室后，该知识库将归属到所选科室。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={`${s.formGrid} ${s.bindingFormGrid}`}>
          <div className={s.formField}>
            <span className={s.fieldLabel}>团队/科室知识库</span>
            <input className={s.formInput} value={binding.space_name} readOnly />
            <span className={s.fieldHint}>更绑仅修改归属科室，不改变知识库</span>
          </div>
          <div className={s.formField}>
            <label className={s.fieldLabel} htmlFor="dept-rebind-department">新科室</label>
            <TreeBindingDepartmentSelect
              id="dept-rebind-department"
              value={draft.departmentId}
              departments={departments}
              disabled={saving || departmentsLoading}
              disabledIds={disabledIds}
              onChange={(departmentId) => onChange({ departmentId })}
            />
            {departmentsLoading ? <span className={s.fieldHint}>正在加载科室列表...</span> : null}
            <span className={s.fieldHint}>原科室：{binding.department_name}；已绑定科室置灰且不可选</span>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || departmentsLoading || draft.departmentId == null || draft.departmentId === binding.department_id}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionsTable({
  sections,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  sections: SectionConfig[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>首页分区管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        首页分区按当前数组顺序展示。系统内置分区可以改名，但不能删除；知识推荐 · 最新精选不再关联标签，普通分区跳转地址会按标签自动生成。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分区标题</th>
            <th>关联标签</th>
            <th>Logo/图标</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, index) => {
            const visual = resolveSectionVisual(sec);
            const builtin = isBuiltinSection(sec);
            const latestSelected = isLatestSelectedSection(sec);
            return (
            <tr key={`${sec.builtin_key || sec.tag}-${index}`}>
              <td>{sec.title}{builtin ? <span className={s.sectionTagBadge}>系统内置</span> : null}</td>
              <td>
                <span className={s.sectionTagBadge}>
                  {latestSelected ? '无' : sec.tag}
                </span>
              </td>
              <td><AdminIconCell icon={sec.icon} color={visual.color} bg={visual.bg} /></td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                  <button
                    className={builtin ? s.inlineMutedBtn : s.inlineDangerBtn}
                    onClick={() => onDelete(index)}
                    disabled={saving || builtin}
                    title={builtin ? '系统内置分区不能删除' : '删除'}
                  >
                    删除
                  </button>
                  <button
                    className={s.iconActionBtn}
                    onClick={() => onMoveUp(index)}
                    disabled={saving || index === 0}
                    aria-label={`上移${sec.title}`}
                    title="上移"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className={s.iconActionBtn}
                    onClick={() => onMoveDown(index)}
                    disabled={saving || index === sections.length - 1}
                    aria-label={`下移${sec.title}`}
                    title="下移"
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </>
  );
}

function SectionEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: SectionDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<SectionDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  const latestSelected = isLatestSelectedSectionDraft(draft);

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.title.trim() ? `编辑首页分区：${draft.title}` : '新增首页分区'}</h3>
            <p className={s.modalNote}>分区卡片会直接出现在首页。系统内置分区会保留固定推荐逻辑，普通分区跳转地址会按标签自动生成。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>分区标题</span>
            <input
              className={s.formInput}
              value={draft.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="例如：知识推荐 · 最新精选"
            />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>关联标签</span>
            <input
              className={s.formInput}
              value={latestSelected ? '无' : draft.tag}
              disabled={latestSelected}
              onChange={(event) => onChange({ tag: event.target.value })}
              placeholder="例如：最新精选"
            />
            <span className={s.fieldHint}>
              {latestSelected
                ? '知识推荐 · 最新精选使用文档预览数推荐，不按标签查询。'
                : '普通分区会按这个标签自动生成站内跳转。'}
            </span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>图标</span>
            <div className={s.optionPickerRow}>
              {SECTION_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                  onClick={() => onChange({ icon })}
                >
                  <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                  <span className={s.optionLabel}>{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>颜色</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`${s.colorOptionBtn} ${isSelectedDomainColor(draft, option) ? s.colorOptionBtnActive : ''}`}
                  onClick={() => onChange({ color: option.color, bg: option.bg })}
                >
                  <span className={s.colorPairPreview}>
                    <span className={s.colorSwatchMain} style={{ background: option.color }} />
                    <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                  </span>
                  <span className={s.optionLabel}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function SectionDeleteDialog({
  open,
  section,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  section: SectionConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除首页分区</h3>
            <p className={s.modalNote}>删除后首页将不再展示该分区入口，但不会影响原有标签和文档数据。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>分区标题：</strong>{section.title}</div>
          <div className={s.confirmLine}><strong>关联标签：</strong>{section.tag}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function BishengConfigTable({
  config,
  saving,
  onEdit,
}: {
  config: BishengRuntimeConfig | null;
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>数据源配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户后端使用的大模型应用平台数据源环境。密码不会回显到前端；保存成功后会立即更新运行中的连接配置。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>大模型应用平台地址</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.base_url || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>资源域名（预览代理）</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.asset_base_url || '与大模型应用平台地址相同'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>登录账号</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.username || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>连接状态</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{config?.connected ? '已连接' : '未连接'}</span>
                <span className={s.valueMeta}>{config?.auth_message || '未验证'}</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>当前登录用户</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{config?.auth_user?.name || config?.auth_user?.account || '未获取'}</span>
                {config?.auth_user?.account ? (
                  <span className={s.valueMeta}>
                    {config.auth_user.account}{config.auth_user.role ? ` · ${config.auth_user.role}` : ''}
                  </span>
                ) : null}
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>请求超时</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config ? `${config.timeout_seconds} 秒` : '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>最近验证时间</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.last_auth_at ? formatDisplayDateTime(config.last_auth_at) : '未验证'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BishengEditorDialog({
  open,
  draft,
  saving,
  error,
  hasToken,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: BishengDraft;
  saving: boolean;
  error: string;
  hasToken: boolean;
  onClose: () => void;
  onChange: (patch: Partial<BishengDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑数据源配置</h3>
            <p className={s.modalNote}>请填大模型应用平台<strong>后端 API</strong> 地址（端口通常是 :7860/:7861/:8098），<strong>不是</strong> :4001/:3001/:3002 这种带 nginx 静态托管的浏览器入口。保存时后端会直接调用大模型应用平台登录接口验证账号密码。密码不会回显；如果只改超时，可以留空继续沿用当前登录态。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={`${s.modalScrollBody} ${s.qaTemplateScrollBody}`}>
          <div className={`${s.formGrid} ${s.qaTemplateFormGrid}`}>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>大模型应用平台地址</span>
              <input className={s.formInput} value={draft.base_url} onChange={(event) => onChange({ base_url: event.target.value })} placeholder="例如：http://192.168.106.114:7860（大模型应用平台后端 API，不是浏览器入口）" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>资源域名（asset_base_url）</span>
              <input className={s.formInput} value={draft.asset_base_url} onChange={(event) => onChange({ asset_base_url: event.target.value })} placeholder="例如：http://192.168.106.120:3002（用于解析大模型应用平台预签名相对 URL，留空则沿用大模型应用平台地址）" />
              <span className={s.fieldHint}>大模型应用平台返回的预览/下载 URL 是相对路径，需要它指向能反代 MinIO 的 nginx 入口。若大模型应用平台后端 API 同时具备 MinIO 反代，可留空。</span>
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>登录账号</span>
              <input className={s.formInput} value={draft.username} onChange={(event) => onChange({ username: event.target.value })} placeholder="请输入服务账号用户名" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>请求超时（秒）</span>
              <input className={s.formInput} value={draft.timeout_seconds} onChange={(event) => onChange({ timeout_seconds: event.target.value })} placeholder="例如：30" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>登录密码</span>
              <input type="password" className={s.formInput} value={draft.password} onChange={(event) => onChange({ password: event.target.value })} placeholder={hasToken ? '留空则沿用当前登录态' : '首次保存必须输入密码'} />
              <span className={s.fieldHint}>为了安全，当前密码不会回显；修改地址或账号时必须重新输入密码。</span>
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存并验证</button>
        </div>
      </div>
    </div>
  );
}

function UnifiedAuthConfigTable({
  config,
  saving,
  onEdit,
}: {
  config: UnifiedAuthRuntimeConfig | null;
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>统一认证配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户后端调用统一身份认证平台的 OAuth 参数。client_secret、state_secret 和 login_sync_hmac_secret 不会回显；response_type=code 固定写入后端，state 由后端动态生成。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>启用状态</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.enabled ? '已启用' : '未启用'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>认证入口</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{formatUnifiedAuthProvider(config?.provider)}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>client_id</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.client_id || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>redirect_uri</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.redirect_uri || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>getToken 参数位置</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.token_param_style === 'form' ? 'form body' : 'URL query'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>密钥状态</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>
                  client_secret {config?.has_client_secret ? '已配置' : '未配置'} · state_secret {config?.has_state_secret ? '已配置' : '未配置'} · login_sync_hmac_secret {config?.has_login_sync_hmac_secret ? '已配置' : '未配置'}
                </span>
                <span className={s.valueMeta}>admin 保存时留空会沿用当前密钥。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function UnifiedAuthEditorDialog({
  open,
  draft,
  saving,
  error,
  config,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: UnifiedAuthDraft;
  saving: boolean;
  error: string;
  config: UnifiedAuthRuntimeConfig | null;
  onClose: () => void;
  onChange: (patch: Partial<UnifiedAuthDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑统一认证配置</h3>
            <p className={s.modalNote}>client_id 和 redirect_uri 来自统一认证平台应用登记；response_type=code 固定由后端发送；state 由后端动态生成。密钥输入框留空会沿用当前值。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={`${s.modalScrollBody} ${s.qaTemplateScrollBody}`}>
          <div className={`${s.formGrid} ${s.qaTemplateFormGrid}`}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>启用统一认证</span>
              <select className={s.formInput} value={draft.enabled ? 'true' : 'false'} onChange={(event) => onChange({ enabled: event.target.value === 'true' })}>
                <option value="false">未启用</option>
                <option value="true">启用</option>
              </select>
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>认证入口</span>
              <select className={s.formInput} value={draft.provider} onChange={(event) => onChange({ provider: event.target.value as UnifiedAuthDraft['provider'] })}>
                <option value="group">集团统一认证</option>
                <option value="stock">股份统一认证</option>
                <option value="custom">自定义端点</option>
              </select>
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>client_id</span>
              <input className={s.formInput} value={draft.client_id} onChange={(event) => onChange({ client_id: event.target.value })} placeholder="统一认证平台分配的客户端 ID" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>getToken 参数位置</span>
              <select className={s.formInput} value={draft.token_param_style} onChange={(event) => onChange({ token_param_style: event.target.value as UnifiedAuthDraft['token_param_style'] })}>
                <option value="query">URL query</option>
                <option value="form">form body</option>
              </select>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>redirect_uri</span>
              <input className={s.formInput} value={draft.redirect_uri} onChange={(event) => onChange({ redirect_uri: event.target.value })} placeholder="例如：https://portal.example.com/api/v1/auth/unified/callback" />
              <span className={s.fieldHint}>必须与统一认证平台登记的回调地址完全一致。</span>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>authorize_url（自定义时填写）</span>
              <input className={s.formInput} value={draft.authorize_url} onChange={(event) => onChange({ authorize_url: event.target.value })} placeholder="例如：https://iam.example.com/idp/oauth2/authorize" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>token_url（自定义时填写）</span>
              <input className={s.formInput} value={draft.token_url} onChange={(event) => onChange({ token_url: event.target.value })} placeholder="例如：https://iam.example.com/idp/oauth2/getToken" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>userinfo_url（自定义时填写）</span>
              <input className={s.formInput} value={draft.userinfo_url} onChange={(event) => onChange({ userinfo_url: event.target.value })} placeholder="例如：https://iam.example.com/idp/oauth2/getUserInfo" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>state TTL（秒）</span>
              <input className={s.formInput} value={draft.state_ttl_seconds} onChange={(event) => onChange({ state_ttl_seconds: event.target.value })} placeholder="例如：300" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>HTTP 超时（秒）</span>
              <input className={s.formInput} value={draft.http_timeout_seconds} onChange={(event) => onChange({ http_timeout_seconds: event.target.value })} placeholder="例如：10" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>client_secret</span>
              <input type="password" className={s.formInput} value={draft.client_secret} onChange={(event) => onChange({ client_secret: event.target.value })} placeholder={config?.has_client_secret ? '已配置，留空则沿用当前值' : '首次启用前建议填写'} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>state_secret</span>
              <input type="password" className={s.formInput} value={draft.state_secret} onChange={(event) => onChange({ state_secret: event.target.value })} placeholder={config?.has_state_secret ? '已配置，留空则沿用当前值' : '留空则由后端自动生成'} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>login_sync_hmac_secret</span>
              <input type="password" className={s.formInput} value={draft.login_sync_hmac_secret} onChange={(event) => onChange({ login_sync_hmac_secret: event.target.value })} placeholder={config?.has_login_sync_hmac_secret ? '已配置，留空则沿用当前值' : '需与 BiSheng sso_sync.gateway_hmac_secret 一致'} />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>签名请求头</span>
              <input className={s.formInput} value={draft.login_sync_signature_header} onChange={(event) => onChange({ login_sync_signature_header: event.target.value })} placeholder="X-Signature" />
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存配置</button>
        </div>
      </div>
    </div>
  );
}

function QAConfigTable({
  qa,
  saving,
  modelOptions,
  modelLoading,
  modelError,
  onEditWelcomeMessage,
  onEditQuestions,
  onEditModel,
  onEditSearchPrompt,
  onEditQaPrompt,
  onEditQuickPrompt,
  onEditNormalPrompt,
  onEditExpertPrompt,
}: {
  qa: QAConfig;
  saving: boolean;
  modelOptions: QAModelOption[];
  modelLoading: boolean;
  modelError: string;
  onEditWelcomeMessage: () => void;
  onEditQuestions: () => void;
  onEditModel: () => void;
  onEditSearchPrompt: () => void;
  onEditQaPrompt: () => void;
  onEditQuickPrompt: () => void;
  onEditNormalPrompt: () => void;
  onEditExpertPrompt: () => void;
}) {
  const generalModelId = qa.general_model || qa.selected_model || '';
  const reasoningModelId = qa.reasoning_model || '';
  const generalModelLabel = formatQaModelLabel(modelOptions, generalModelId) || '未配置';
  const reasoningModelLabel = formatQaModelLabel(modelOptions, reasoningModelId) || '未配置';

  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>问答配置</h2>
      </div>
      <p className={s.pageNote}>
        这里统一维护欢迎语、热门问题和两个模型提示词。首页 QA 卡片与问答页会直接读取这些配置。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>欢迎语</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{qa.welcome_message || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditWelcomeMessage} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>热门问题</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.hot_questions.length} 条</span>
                {qa.hot_questions[0] ? <span className={s.valueMeta}>例如：{qa.hot_questions[0]}</span> : null}
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQuestions} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>问答模型</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>通用模型：{generalModelLabel}</span>
                <span className={s.valueTitle}>推理模型：{reasoningModelLabel}</span>
                <span className={s.valueMeta}>
                  {modelLoading
                    ? '正在从大模型应用平台模型管理加载模型列表...'
                    : modelError
                      ? '模型列表加载失败，当前显示的是已保存配置。'
                      : '来自大模型应用平台模型管理列表，仅用于问答页模型选择。'}
                </span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditModel} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>搜索助手</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.ai_search_system_prompt ? truncateText(qa.ai_search_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于搜索页的 搜索助手 总结。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditSearchPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>快速模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.quick_mode_system_prompt ? truncateText(qa.quick_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“快速模式”，偏向简短、直接的回答。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQuickPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>普通模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.normal_mode_system_prompt ? truncateText(qa.normal_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“普通模式”，偏向结构化、可执行的回答。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditNormalPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>专家模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.expert_mode_system_prompt ? truncateText(qa.expert_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“专家模式”，发送时会使用推理模型。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditExpertPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>旧技术问答 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.qa_system_prompt ? truncateText(qa.qa_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>兼容历史配置保留，新版问答页不再读取这一项。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQaPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function SearchConfigTable({
  search,
  modelOptions,
  modelLoading,
  modelError,
  saving,
  onEditRerankModel,
}: {
  search: SearchConfig;
  modelOptions: QAModelOption[];
  modelLoading: boolean;
  modelError: string;
  saving: boolean;
  onEditRerankModel: () => void;
}) {
  const rerankModelLabel = formatQaModelLabel(modelOptions, search.rerank_model_id) || '未配置';

  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>搜索配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户首页检索的重排模型配置。未配置时搜索结果只使用 ES 与向量召回融合排序。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>搜索重排模型</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{rerankModelLabel}</span>
                <span className={s.valueMeta}>
                  {modelLoading
                    ? '正在从大模型应用平台模型管理加载 rerank 模型列表...'
                    : modelError
                      ? '重排模型列表加载失败，当前显示的是已保存配置。'
                      : search.rerank_model_id
                        ? '门户首页检索会使用该模型对融合候选做重排。'
                        : '未配置时不启用 rerank，搜索仍会正常返回融合排序结果。'}
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEditRerankModel} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function AgentConfigTable({
  agentConfig,
  workflowOptions,
  workflowLoading,
  workflowError,
  workflowLoaded,
  workflowSourceReliable,
  workflowHasMore,
  saving,
  onRefreshWorkflows,
  onLoadMoreWorkflows,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onMoveCategory,
  onToggleCategory,
  onAddAgent,
  onAddUrlApplication,
  onEditAgent,
  onDeleteAgent,
  onMoveAgent,
  onToggleAgent,
}: {
  agentConfig: AgentConfig;
  workflowOptions: AgentWorkflowOption[];
  workflowLoading: boolean;
  workflowError: string;
  workflowLoaded: boolean;
  workflowSourceReliable: boolean;
  workflowHasMore: boolean;
  saving: boolean;
  onRefreshWorkflows: () => void;
  onLoadMoreWorkflows: () => void;
  onAddCategory: () => void;
  onEditCategory: (index: number) => void;
  onDeleteCategory: (index: number) => void;
  onMoveCategory: (index: number, direction: -1 | 1) => void;
  onToggleCategory: (index: number, enabled: boolean) => void;
  onAddAgent: () => void;
  onAddUrlApplication: () => void;
  onEditAgent: (index: number) => void;
  onDeleteAgent: (index: number) => void;
  onMoveAgent: (index: number, direction: -1 | 1) => void;
  onToggleAgent: (index: number, enabled: boolean) => void;
}) {
  const categoryNameById = new Map(agentConfig.categories.map((category) => [category.id, category.name]));
  const workflowIds = new Set(workflowOptions.map((workflow) => workflow.workflow_id));
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>智能应用配置</h2>
        <div className={s.actions}>
          <button className={s.subtleBtn} onClick={onRefreshWorkflows} disabled={saving || workflowLoading}>
            <RefreshCw size={14} />
            刷新 workflow
          </button>
          <button className={s.addBtn} onClick={onAddAgent} disabled={saving || !agentConfig.categories.length}>
            <Plus size={14} /> 添加 Agent
          </button>
          <button className={s.addBtn} onClick={onAddUrlApplication} disabled={saving || !agentConfig.categories.length}>
            <Plus size={14} /> 添加 URL 应用
          </button>
          <button className={s.addBtn} onClick={onAddCategory} disabled={saving}>
            <Plus size={14} /> 添加分类
          </button>
        </div>
      </div>
      <p className={s.pageNote}>
        统一维护 Bisheng workflow Agent 与 URL 应用。前台按这里的分类和顺序混合展示，两类应用使用各自的 iframe 运行方式。
      </p>
      {workflowError ? <div className={s.errorBox}>{workflowError}</div> : null}
      {workflowLoading ? <div className={s.emptyState}>正在加载 Bisheng workflow 候选项...</div> : null}

      <h3 className={s.sectionTitle}>分类管理</h3>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分类名称</th>
            <th>ID</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {agentConfig.categories.map((category, index) => (
            <tr key={category.id}>
              <td>{category.name}</td>
              <td>{category.id}</td>
              <td><span className={category.enabled ? s.stateEnabled : s.stateDisabled}>{category.enabled ? '已启用' : '已停用'}</span></td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEditCategory(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineBtn} onClick={() => onToggleCategory(index, !category.enabled)} disabled={saving}>{category.enabled ? '停用' : '启用'}</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDeleteCategory(index)} disabled={saving}>删除</button>
                  <button className={s.iconActionBtn} onClick={() => onMoveCategory(index, -1)} disabled={saving || index === 0} title="上移"><ArrowUp size={15} /></button>
                  <button className={s.iconActionBtn} onClick={() => onMoveCategory(index, 1)} disabled={saving || index === agentConfig.categories.length - 1} title="下移"><ArrowDown size={15} /></button>
                </div>
              </td>
            </tr>
          ))}
          {!agentConfig.categories.length ? (
            <tr><td colSpan={4}><div className={s.emptyState}>暂无分类，请先添加分类。</div></td></tr>
          ) : null}
        </tbody>
      </table>

      <h3 className={s.sectionTitle}>智能应用列表</h3>
      <table className={s.table}>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>分类</th>
            <th>目标</th>
            <th>标签</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {agentConfig.applications.map((agent, index) => {
            const sourceAbnormal = agent.type === 'workflow' && workflowSourceReliable && !workflowIds.has(agent.workflow_id);
            return (
              <tr key={agent.id}>
                <td>
                  <div className={s.spaceNameCell}>
                    <span>{agent.name}</span>
                    <span className={s.inlineHint}>{agent.desc || '未配置描述'}</span>
                  </div>
                </td>
                <td><span className={s.keyBadge}>{agent.type === 'url' ? 'URL 应用' : 'Agent'}</span></td>
                <td>{categoryNameById.get(agent.category_id) || agent.category_id}</td>
                <td>
                  <div className={s.spaceNameCell}>
                    <span>{agent.type === 'url' ? agent.url : agent.workflow_id}</span>
                    {sourceAbnormal ? <span className={s.errorText}>未在已发布 workflow 候选项中</span> : null}
                  </div>
                </td>
                <td>{agent.tags.join('，') || '未配置'}</td>
                <td><span className={agent.enabled ? s.stateEnabled : s.stateDisabled}>{agent.enabled ? '已启用' : '已停用'}</span></td>
                <td>
                  <div className={s.actionGroup}>
                    <button className={s.inlineBtn} onClick={() => onEditAgent(index)} disabled={saving}>编辑</button>
                    <button className={s.inlineBtn} onClick={() => onToggleAgent(index, !agent.enabled)} disabled={saving}>{agent.enabled ? '停用' : '启用'}</button>
                    <button className={s.inlineDangerBtn} onClick={() => onDeleteAgent(index)} disabled={saving}>删除</button>
                    <button className={s.iconActionBtn} onClick={() => onMoveAgent(index, -1)} disabled={saving || index === 0} title="上移"><ArrowUp size={15} /></button>
                    <button className={s.iconActionBtn} onClick={() => onMoveAgent(index, 1)} disabled={saving || index === agentConfig.applications.length - 1} title="下移"><ArrowDown size={15} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
          {!agentConfig.applications.length ? (
            <tr><td colSpan={7}><div className={s.emptyState}>暂无智能应用，添加后会在前台智能应用页展示。</div></td></tr>
          ) : null}
        </tbody>
      </table>
      {workflowHasMore ? (
        <div className={s.tableFooter}>
          <button className={s.subtleBtn} onClick={onLoadMoreWorkflows} disabled={saving || workflowLoading}>
            {workflowLoading ? '加载中...' : '加载更多 workflow'}
          </button>
          {workflowLoaded ? <span className={s.inlineHint}>仍有更多已发布 workflow，可继续加载后再判断来源异常。</span> : null}
        </div>
      ) : null}
    </>
  );
}

function AgentCategoryDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: AgentCategoryDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<AgentCategoryDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>Agent 分类</h3>
            <p className={s.modalNote}>分类用于前台 Agent 智能体 tab 筛选。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>分类名称</span>
            <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：AI问答" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>分类 ID</span>
            <input className={s.formInput} value={draft.id} onChange={(event) => onChange({ id: event.target.value })} placeholder="例如：qa" />
          </label>
          <label className={s.checkRow}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            启用该分类
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function AgentDialog({
  open,
  draft,
  categories,
  workflowOptions,
  workflowLoading,
  workflowError,
  workflowKeyword,
  workflowHasMore,
  saving,
  error,
  onClose,
  onChange,
  onWorkflowKeywordChange,
  onRefreshWorkflows,
  onLoadMoreWorkflows,
  onSelectWorkflow,
  onSubmit,
}: {
  open: boolean;
  draft: AgentDraft;
  categories: AgentCategoryConfig[];
  workflowOptions: AgentWorkflowOption[];
  workflowLoading: boolean;
  workflowError: string;
  workflowKeyword: string;
  workflowHasMore: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<AgentDraft>) => void;
  onWorkflowKeywordChange: (value: string) => void;
  onRefreshWorkflows: () => void;
  onLoadMoreWorkflows: () => void;
  onSelectWorkflow: (workflow: AgentWorkflowOption) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.modalCard} ${s.qaTemplateModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>Agent 智能体</h3>
            <p className={s.modalNote}>从 Bisheng 已发布 workflow 选择来源，展示文案可按门户场景覆盖。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalActions}>
          <input
            className={s.optionSearch}
            value={workflowKeyword}
            onChange={(event) => onWorkflowKeywordChange(event.target.value)}
            placeholder="搜索 Bisheng workflow"
          />
          <button className={s.subtleBtn} onClick={onRefreshWorkflows} disabled={workflowLoading || saving}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        {workflowError ? <div className={s.errorBox}>{workflowError}</div> : null}
        <div className={s.optionList}>
          {workflowLoading ? <div className={s.emptyState}>正在加载 workflow...</div> : null}
          {!workflowLoading && !workflowOptions.length ? <div className={s.emptyState}>暂无已发布 workflow 候选项</div> : null}
          {!workflowLoading && workflowOptions.map((workflow) => (
            <div key={workflow.workflow_id} className={s.optionRow}>
              <div className={s.optionMain}>
                <div className={s.optionName}>{workflow.name}</div>
                <div className={s.optionMeta}>{workflow.desc || workflow.workflow_id}</div>
              </div>
              <button className={draft.workflowId === workflow.workflow_id ? s.subtleBtn : s.addBtn} onClick={() => onSelectWorkflow(workflow)} disabled={saving}>
                {draft.workflowId === workflow.workflow_id ? '已选择' : '选择'}
              </button>
            </div>
          ))}
          {workflowHasMore ? (
            <button className={s.subtleBtn} onClick={onLoadMoreWorkflows} disabled={workflowLoading || saving}>
              {workflowLoading ? '加载中...' : '加载更多 workflow'}
            </button>
          ) : null}
        </div>
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>workflow_id</span>
            <input className={s.formInput} value={draft.workflowId} onChange={(event) => onChange({ workflowId: event.target.value })} placeholder="选择 workflow 后自动填充" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>展示名称</span>
            <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>分类</span>
            <select className={s.formInput} value={draft.categoryId} onChange={(event) => onChange({ categoryId: event.target.value })}>
              <option value="">请选择分类</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>标签</span>
            <input className={s.formInput} value={draft.tagsText} onChange={(event) => onChange({ tagsText: event.target.value })} placeholder="多个标签用逗号分隔" />
          </label>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>描述</span>
            <textarea className={s.formTextarea} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} rows={3} />
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>图标</span>
            <div className={s.optionPickerRow}>
              {AGENT_ICON_OPTIONS.map((icon) => (
                <button key={icon} type="button" className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`} onClick={() => onChange({ icon })}>
                  <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                  <span className={s.optionLabel}>{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>颜色</span>
            <div className={s.optionPickerRow}>
              {AGENT_COLOR_PRESETS.map((option) => (
                <button key={`${option.color}-${option.bg}`} type="button" className={`${s.colorOptionBtn} ${draft.color === option.color && draft.bg === option.bg ? s.colorOptionBtnActive : ''}`} onClick={() => onChange({ color: option.color, bg: option.bg })}>
                  <span className={s.colorPairPreview}>
                    <span className={s.colorSwatchMain} style={{ background: option.color }} />
                    <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                  </span>
                </button>
              ))}
            </div>
          </div>
          <label className={s.checkRow}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            启用该 Agent
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function UrlApplicationDialog({
  open,
  draft,
  categories,
  saving,
  uploading,
  error,
  onClose,
  onChange,
  onUploadIcon,
  onSubmit,
}: {
  open: boolean;
  draft: AgentDraft;
  categories: AgentCategoryConfig[];
  saving: boolean;
  uploading: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<AgentDraft>) => void;
  onUploadIcon: (file: File) => Promise<void>;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.modalCard} ${s.qaTemplateModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>URL 应用</h3>
            <p className={s.modalNote}>配置可在门户智能应用工作区内通过 iframe 打开的 HTTP/HTTPS 应用。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>展示名称</span>
              <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：经营分析系统" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>分类</span>
              <select className={s.formInput} value={draft.categoryId} onChange={(event) => onChange({ categoryId: event.target.value })}>
                <option value="">请选择分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>应用 URL</span>
              <input className={s.formInput} value={draft.url} onChange={(event) => onChange({ url: event.target.value })} placeholder="https://example.com/app" />
              <span className={s.fieldHint}>仅支持完整的 http:// 或 https:// 地址；目标站点必须允许 iframe 嵌入。</span>
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>标签</span>
              <input className={s.formInput} value={draft.tagsText} onChange={(event) => onChange({ tagsText: event.target.value })} placeholder="多个标签用逗号分隔" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>启用状态</span>
              <span className={s.toggleRow}>
                <span>{draft.enabled ? '已启用' : '已停用'}</span>
                <input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
              </span>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>描述</span>
              <textarea className={s.formTextarea} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} rows={3} />
            </label>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>预设图标</span>
              <div className={s.optionPickerRow}>
                {AGENT_ICON_OPTIONS.map((icon) => (
                  <button key={icon} type="button" className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`} onClick={() => onChange({ icon })}>
                    <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                    <span className={s.optionLabel}>{icon}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>本地图标</span>
              <div className={s.optionPickerRow}>
                {draft.iconImageUrl ? <img src={draft.iconImageUrl} alt="应用图标预览" className={s.siteFaviconPreview} /> : null}
                <label className={s.subtleBtn}>
                  <Upload size={14} />{uploading ? '上传中...' : '上传图片'}
                  <input
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading || saving}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onUploadIcon(file);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {draft.iconImageUrl ? <button type="button" className={s.subtleBtn} onClick={() => onChange({ iconImageUrl: '' })}>使用预设图标</button> : null}
              </div>
            </div>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>颜色</span>
              <div className={s.optionPickerRow}>
                {AGENT_COLOR_PRESETS.map((option) => (
                  <button key={`${option.color}-${option.bg}`} type="button" className={`${s.colorOptionBtn} ${draft.color === option.color && draft.bg === option.bg ? s.colorOptionBtnActive : ''}`} onClick={() => onChange({ color: option.color, bg: option.bg })}>
                    <span className={s.colorPairPreview}>
                      <span className={s.colorSwatchMain} style={{ background: option.color }} />
                      <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || uploading}>保存</button>
        </div>
      </div>
    </div>
  );
}

function AgentCategoryDeleteDialog({
  open,
  category,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  category: AgentCategoryConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}><h3 className={s.modalTitle}>删除 Agent 分类</h3><button className={s.subtleBtn} onClick={onClose}>取消</button></div>
        <div className={s.confirmBody}><div className={s.confirmLine}><strong>分类名称：</strong>{category.name}</div></div>
        <div className={s.confirmActions}><button className={s.subtleBtn} onClick={onClose}>关闭</button><button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button></div>
      </div>
    </div>
  );
}

function AgentDeleteDialog({
  open,
  agent,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  agent: AgentItemConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}><h3 className={s.modalTitle}>删除智能应用</h3><button className={s.subtleBtn} onClick={onClose}>取消</button></div>
        <div className={s.confirmBody}><div className={s.confirmLine}><strong>应用：</strong>{agent.name}</div><div className={s.confirmLine}><strong>{agent.type === 'url' ? 'URL' : 'workflow'}：</strong>{agent.type === 'url' ? agent.url : agent.workflow_id}</div></div>
        <div className={s.confirmActions}><button className={s.subtleBtn} onClick={onClose}>关闭</button><button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button></div>
      </div>
    </div>
  );
}

function QATemplatesTable({
  qa,
  saving,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onMoveCategory,
  onToggleCategory,
  onAddTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onMoveTemplate,
  onToggleTemplate,
}: {
  qa: QAConfig;
  saving: boolean;
  onAddCategory: () => void;
  onEditCategory: (index: number) => void;
  onDeleteCategory: (index: number) => void;
  onMoveCategory: (index: number, direction: -1 | 1) => void;
  onToggleCategory: (index: number, enabled: boolean) => void;
  onAddTemplate: () => void;
  onEditTemplate: (index: number) => void;
  onDeleteTemplate: (index: number) => void;
  onMoveTemplate: (index: number, direction: -1 | 1) => void;
  onToggleTemplate: (index: number, enabled: boolean) => void;
}) {
  const categoryNameById = new Map(qa.template_categories.map((category) => [category.id, category.name]));

  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>问答模板</h2>
        <button className={s.addBtn} onClick={onAddTemplate} disabled={saving || qa.template_categories.length === 0}><Plus size={14} /> 添加模板</button>
      </div>
      <p className={s.pageNote}>
        这里维护知识问答页“AI 帮我写”卡片和首页快捷入口。分类下仍有模板时不能删除分类。
      </p>

      <div className={s.titleBar}>
        <h3 className={s.sectionTitle}>模板分类</h3>
        <button className={s.subtleBtn} onClick={onAddCategory} disabled={saving}><Plus size={14} /> 添加分类</button>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分类名称</th>
            <th>状态</th>
            <th>模板数</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {qa.template_categories.map((category, index) => {
            const templateCount = qa.templates.filter((template) => template.category_id === category.id).length;
            const deletable = canDeleteQaTemplateCategory(category.id, qa.templates);
            return (
              <tr key={category.id}>
                <td><div className={s.valueStack}><span className={s.valueTitle}>{category.name}</span><span className={s.valueMeta}>{category.description}</span></div></td>
                <td><span className={category.enabled ? s.stateEnabled : s.stateDisabled}>{category.enabled ? '已启用' : '已停用'}</span></td>
                <td>{templateCount}</td>
                <td>
                  <div className={s.actionGroup}>
                    <button className={s.inlineBtn} onClick={() => onMoveCategory(index, -1)} disabled={saving || index === 0}>上移</button>
                    <button className={s.inlineBtn} onClick={() => onMoveCategory(index, 1)} disabled={saving || index === qa.template_categories.length - 1}>下移</button>
                    <button className={s.inlineBtn} onClick={() => onToggleCategory(index, !category.enabled)} disabled={saving}>{category.enabled ? '停用' : '启用'}</button>
                    <button className={s.inlineBtn} onClick={() => onEditCategory(index)} disabled={saving}>编辑</button>
                    <button
                      className={deletable ? s.inlineDangerBtn : s.inlineMutedBtn}
                      onClick={() => onDeleteCategory(index)}
                      disabled={saving || !deletable}
                      title={deletable ? '删除分类' : '请先调整或删除该分类下的模板'}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={s.titleBar}>
        <h3 className={s.sectionTitle}>模板列表</h3>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>模板名称</th>
            <th>分类</th>
            <th>图标</th>
            <th>提示词</th>
            <th>展示</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {qa.templates.map((template, index) => (
            <tr key={template.id}>
              <td>
                <div className={s.valueStack}>
                  <span className={s.valueTitle}>{template.name}</span>
                  <span className={s.valueMeta}>{template.desc || template.id}</span>
                </div>
              </td>
              <td>{categoryNameById.get(template.category_id) || '分类不存在'}</td>
              <td><DomainIcon icon={template.icon} color={template.color} bg={template.bg} size={32} /></td>
              <td>{truncateText(template.prompt, 42)}</td>
              <td>
                <div className={s.valueStack}>
                  <span className={template.enabled ? s.stateEnabled : s.stateDisabled}>{template.enabled ? '已启用' : '已停用'}</span>
                  {template.show_on_home ? <span className={s.valueMeta}>首页展示</span> : <span className={s.valueMeta}>仅问答页</span>}
                </div>
              </td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onMoveTemplate(index, -1)} disabled={saving || index === 0}>上移</button>
                  <button className={s.inlineBtn} onClick={() => onMoveTemplate(index, 1)} disabled={saving || index === qa.templates.length - 1}>下移</button>
                  <button className={s.inlineBtn} onClick={() => onToggleTemplate(index, !template.enabled)} disabled={saving}>{template.enabled ? '停用' : '启用'}</button>
                  <button className={s.inlineBtn} onClick={() => onEditTemplate(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDeleteTemplate(index)} disabled={saving}>删除</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function QaTemplateCategoryDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: QaTemplateCategoryDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<QaTemplateCategoryDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.name.trim() ? `编辑分类 · ${draft.name}` : '新增分类'}</h3>
            <p className={s.modalNote}>分类用于知识问答页模板筛选；分类 ID 保存后保持稳定。</p>
          </div>
          <div className={s.modalHeaderActions}>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ enabled: !draft.enabled })}>
              <span>{draft.enabled ? '已启用' : '已停用'}</span>
              <span className={`${s.switchTrack} ${draft.enabled ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.enabled ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          </div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>分类名称</span>
            <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：工作汇报" maxLength={10} />
          </label>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>分类描述</span>
            <input className={s.formInput} value={draft.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="选填，简要说明该分类" maxLength={50} />
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function QaTemplateDialog({
  open,
  draft,
  categories,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: QaTemplateDraft;
  categories: QATemplateCategoryConfig[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<QaTemplateDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.name.trim() ? `编辑模板 · ${draft.name}` : '新增模板'}</h3>
            <p className={s.modalNote}>模板会显示在知识问答页；打开首页展示后也会显示在首页快捷入口。</p>
          </div>
          <div className={s.modalHeaderActions}>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ showOnHome: !draft.showOnHome })}>
              <span>{draft.showOnHome ? '首页展示' : '不在首页'}</span>
              <span className={`${s.switchTrack} ${draft.showOnHome ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.showOnHome ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ enabled: !draft.enabled })}>
              <span>{draft.enabled ? '已启用' : '已停用'}</span>
              <span className={`${s.switchTrack} ${draft.enabled ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.enabled ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          </div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            {draft.showOnHome ? (
              <div className={`${s.formField} ${s.formFieldWide}`}>
                <span className={s.fieldLabel}>首页图标</span>
                <div className={s.optionPickerRow}>
                  {QA_TEMPLATE_HOME_ICON_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${s.iconOptionBtn} ${draft.homeIcon === opt.value ? s.iconOptionBtnActive : ''}`}
                      onClick={() => onChange({ homeIcon: opt.value })}
                    >
                      <img
                        src={opt.value}
                        alt=""
                        style={{ width: 32, height: 32, objectFit: 'contain' }}
                      />
                      <span className={s.optionLabel}>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className={s.formField}>
              <span className={s.fieldLabel}>模板名称</span>
              <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：工作计划" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>所属分类</span>
              <select className={s.formInput} value={draft.categoryId} onChange={(event) => onChange({ categoryId: event.target.value })}>
                <option value="">请选择分类</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>图标</span>
              <div className={s.optionPickerRow}>
                {QA_TEMPLATE_ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                    onClick={() => onChange({ icon })}
                  >
                    <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={32} />
                    <span className={s.optionLabel}>{icon}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>颜色</span>
              <div className={s.optionPickerRow}>
                {DOMAIN_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`${s.colorOptionBtn} ${draft.color === option.color && draft.bg === option.bg ? s.colorOptionBtnActive : ''}`}
                    onClick={() => onChange({ color: option.color, bg: option.bg })}
                  >
                    <span className={s.colorPairPreview}>
                      <span className={s.colorSwatchMain} style={{ background: option.color }} />
                      <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                    </span>
                    <span className={s.optionLabel}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>模板描述</span>
              <textarea className={`${s.formTextarea} ${s.qaTemplateDescInput}`} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} placeholder="一句话说明模板用途" maxLength={50} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>提示词</span>
              <textarea className={`${s.formTextarea} ${s.qaTemplatePromptInput}`} value={draft.prompt} onChange={(event) => onChange({ prompt: event.target.value })} placeholder="点击模板后填入问答输入框的提示词" />
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function QaTemplateCategoryDeleteDialog({
  open,
  category,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  category: QATemplateCategoryConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除模板分类</h3>
            <p className={s.modalNote}>删除后该分类不再出现在知识问答页筛选中。</p>
          </div>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>分类名称：</strong>{category.name}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function QaTemplateDeleteDialog({
  open,
  template,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  template: QATemplateConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除问答模板</h3>
            <p className={s.modalNote}>删除后知识问答页和首页快捷入口都会同步下线。</p>
          </div>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>模板名称：</strong>{template.name}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function IntegrationsConfigTable({
  integrations,
  saving,
  onEdit,
}: {
  integrations: IntegrationsConfig;
  saving: boolean;
  onEdit: () => void;
}) {
  const adminUrl = integrations.bisheng_admin_entry_url?.trim() || '';
  const knowledgeUrl = integrations.bisheng_knowledge_entry_url?.trim() || '';
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>集成配置</h2>
      </div>
      <p className={s.pageNote}>
        门户与大模型应用平台工作台的集成入口。后台入口配置后，右上角用户菜单出现「知识管理后台」；知识空间入口用于「我的知识」页面 iframe 嵌入。大模型应用平台侧需按 docs/bisheng-portal-admin-integration.md 部署对应补丁。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>知识管理后台 URL</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{adminUrl || '（未配置 — 入口隐藏）'}</span>
                <span className={s.valueMeta}>
                  示例：http://workspace.example.com/workspace/shougang-portal-admin
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEdit} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
          <tr>
            <td>我的知识嵌入 URL</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{knowledgeUrl || '（未配置 — 使用数据源前端地址推导 /workspace/knowledge）'}</span>
                <span className={s.valueMeta}>
                  示例：http://workspace.example.com/workspace/knowledge
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEdit} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function SiteConfigTable({
  site,
  saving,
  onEdit,
}: {
  site: SiteDraft;
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>站点配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户品牌展示，包括顶部品牌、登录页品牌，以及浏览器标签页标题和图标。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>顶部品牌名</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.header_brand_name}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>顶部 Header Logo</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.header_logo_url} alt="顶部 Header Logo" className={s.siteLogoPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>登录页品牌名</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.login_brand_name}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>登录页 Logo</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.login_logo_url} alt="登录页 Logo" className={s.siteLogoPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>浏览器标签页文字</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.browser_title}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>浏览器标签页图标</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.favicon_url} alt="浏览器标签页图标" className={s.siteFaviconPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>业务域计数缓存有效期</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.domain_count_cache_ttl_seconds} 秒</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>首页数据缓存有效期</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.home_cache_ttl_seconds} 秒</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function DisplayConfigTable({
  items,
  saving,
  onAdjust,
}: {
  items: DisplayItem[];
  saving: boolean;
  onAdjust: (key: string, delta: -1 | 1) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>展示配置</h2>
      </div>
      <p className={s.pageNote}>
        这里只控制前台各模块的展示数量，不改业务内容本身。保存后首页、列表页、搜索页和详情页会按新值渲染。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分组</th>
            <th>配置项</th>
            <th>显示数量</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <td>{item.group}</td>
              <td>{item.label}</td>
              <td>
                <div className={s.stepper}>
                  <button
                    type="button"
                    className={s.stepperBtn}
                    onClick={() => onAdjust(item.key, -1)}
                    disabled={saving || item.value <= 0}
                    aria-label={`减少${item.label}`}
                  >
                    -
                  </button>
                  <span className={s.stepperValue}>{item.value}</span>
                  <button
                    type="button"
                    className={s.stepperBtn}
                    onClick={() => onAdjust(item.key, 1)}
                    disabled={saving}
                    aria-label={`增加${item.label}`}
                  >
                    +
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TextEditorDialog({
  open,
  title,
  note,
  label,
  value,
  saving,
  error,
  multiline = false,
  placeholder,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  note?: string;
  label: string;
  value: string;
  saving: boolean;
  error?: string;
  multiline?: boolean;
  placeholder?: string;
  onClose: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{title}</h3>
            {note ? <p className={s.modalNote}>{note}</p> : null}
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>{label}</span>
            {multiline ? (
              <textarea
                className={s.formTextarea}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
            ) : (
              <input
                className={s.formInput}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
            )}
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function IntegrationsEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: IntegrationsDraft;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onChange: (value: IntegrationsDraft) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑集成配置</h3>
            <p className={s.modalNote}>
              后台入口控制右上角「知识管理后台」；知识空间入口控制「我的知识」页面嵌入地址。留空表示隐藏或使用默认推导。
            </p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>知识管理后台 URL</span>
            <input
              className={s.formInput}
              value={draft.bisheng_admin_entry_url}
              onChange={(event) => onChange({ ...draft, bisheng_admin_entry_url: event.target.value })}
              placeholder="例如：http://192.168.106.120:3002/workspace/shougang-portal-admin"
            />
          </label>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>我的知识嵌入 URL</span>
            <input
              className={s.formInput}
              value={draft.bisheng_knowledge_entry_url}
              onChange={(event) => onChange({ ...draft, bisheng_knowledge_entry_url: event.target.value })}
              placeholder="例如：http://192.168.106.120:3002/workspace/knowledge"
            />
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function SiteEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: SiteDraft;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onChange: (value: SiteDraft) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑站点配置</h3>
            <p className={s.modalNote}>
              Logo 和 favicon 支持站内本地路径（如 /site-logo-new.png 或 site-logo-new.png）和 http(s) 线上图片地址。
            </p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>顶部品牌名</span>
            <input className={s.formInput} value={draft.header_brand_name} onChange={(event) => onChange({ ...draft, header_brand_name: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>顶部 Header Logo</span>
            <input className={s.formInput} value={draft.header_logo_url} onChange={(event) => onChange({ ...draft, header_logo_url: event.target.value })} placeholder="例如：/site-logo-new.png 或 https://example.com/logo.png" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>登录页品牌名</span>
            <input className={s.formInput} value={draft.login_brand_name} onChange={(event) => onChange({ ...draft, login_brand_name: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>登录页 Logo</span>
            <input className={s.formInput} value={draft.login_logo_url} onChange={(event) => onChange({ ...draft, login_logo_url: event.target.value })} placeholder="例如：/shougang-stock-logo.png 或 https://example.com/login-logo.png" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>浏览器标签页文字</span>
            <input className={s.formInput} value={draft.browser_title} onChange={(event) => onChange({ ...draft, browser_title: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>浏览器标签页图标</span>
            <input className={s.formInput} value={draft.favicon_url} onChange={(event) => onChange({ ...draft, favicon_url: event.target.value })} placeholder="例如：/site-favicon-horizontal-v2.png 或 https://example.com/favicon.ico" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域计数缓存有效期（秒）</span>
            <input
              className={s.formInput}
              type="number"
              min={60}
              value={draft.domain_count_cache_ttl_seconds}
              onChange={(event) => onChange({ ...draft, domain_count_cache_ttl_seconds: event.target.value })}
              placeholder="例如：43200（12 小时）"
            />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>首页数据缓存有效期（秒）</span>
            <input
              className={s.formInput}
              type="number"
              min={60}
              value={draft.home_cache_ttl_seconds}
              onChange={(event) => onChange({ ...draft, home_cache_ttl_seconds: event.target.value })}
              placeholder="例如：1800（30 分钟）"
            />
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function QaModelDialog({
  open,
  models,
  selectedModels,
  loading,
  saving,
  error,
  managementUrl,
  onClose,
  onSelect,
  onSubmit,
}: {
  open: boolean;
  models: QAModelOption[];
  selectedModels: QaModelDraft;
  loading: boolean;
  saving: boolean;
  error?: string;
  managementUrl: string;
  onClose: () => void;
  onSelect: (field: keyof QaModelDraft, modelId: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  const generalModelInvalid = Boolean(selectedModels.general_model) && !models.some((model) => model.id === selectedModels.general_model);
  const reasoningModelInvalid = Boolean(selectedModels.reasoning_model) && !models.some((model) => model.id === selectedModels.reasoning_model);

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑问答模型</h3>
            <p className={s.modalNote}>候选项直接来自大模型应用平台的模型管理列表。通用模型必选，推理模型可选，问答页会在这里配置的模型中切换。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalHint}>当前候选数：{models.length}</div>
        <div className={s.optionList}>
          {loading ? <div className={s.emptyState}>正在加载模型列表...</div> : null}
          {!loading && !models.length ? <div className={s.emptyState}>暂未获取到模型候选项</div> : null}
          {!loading && models.length ? (
            <>
              <QaModelCascaderSelect
                title="通用模型"
                required
                models={models}
                selectedModel={selectedModels.general_model}
                invalid={generalModelInvalid}
                onSelect={(modelId) => onSelect('general_model', modelId)}
              />
              <QaModelCascaderSelect
                title="推理模型"
                allowEmpty
                models={models}
                selectedModel={selectedModels.reasoning_model}
                invalid={reasoningModelInvalid}
                onSelect={(modelId) => onSelect('reasoning_model', modelId)}
              />
            </>
          ) : null}
        </div>
        <div className={s.confirmActions}>
          {managementUrl ? (
            <span className={s.modelManagementNotice}>模型的新增、启停与异常处理请前往毕昇模型管理完成。</span>
          ) : null}
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || loading}>保存</button>
        </div>
      </div>
    </div>
  );
}

function SearchRerankModelDialog({
  open,
  models,
  selectedModel,
  loading,
  saving,
  error,
  onClose,
  onSelect,
  onSubmit,
}: {
  open: boolean;
  models: QAModelOption[];
  selectedModel: string;
  loading: boolean;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSelect: (modelId: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.modalCard} ${s.searchRerankModelModal}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑搜索重排模型</h3>
            <p className={s.modalNote}>候选项来自大模型应用平台模型管理列表，仅展示 rerank 类型模型。可不配置，不配置时搜索只使用融合排序。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalHint}>当前候选数：{models.length}</div>
        <div className={s.optionList}>
          {loading ? <div className={s.emptyState}>正在加载重排模型列表...</div> : null}
          {!loading && !models.length ? <div className={s.emptyState}>暂未获取到 rerank 模型候选项</div> : null}
          {!loading ? (
            <QaModelCascaderSelect
              title="搜索重排模型"
              allowEmpty
              models={models}
              selectedModel={selectedModel}
              onSelect={onSelect}
            />
          ) : null}
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || loading}>保存</button>
        </div>
      </div>
    </div>
  );
}

interface QaModelProviderGroup {
  provider_name: string;
  models: QAModelOption[];
}

function buildQaModelProviderGroups(models: QAModelOption[]): QaModelProviderGroup[] {
  const groups = new Map<string, QaModelProviderGroup>();

  models.forEach((model) => {
    const providerName = getQaModelProviderName(model);
    if (!groups.has(providerName)) {
      groups.set(providerName, { provider_name: providerName, models: [] });
    }
    groups.get(providerName)?.models.push(model);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    models: [...group.models].sort((a, b) => getQaModelDisplayName(a).localeCompare(getQaModelDisplayName(b), 'zh-Hans-CN')),
  }));
}

function getQaModelProviderName(model: QAModelOption): string {
  return model.provider_name?.trim() || '未命名服务商';
}

function getQaModelDisplayName(model: QAModelOption): string {
  return model.name || model.display_name || model.id;
}

function resolveQaModelDisplayNameSnapshot(
  models: QAModelOption[],
  modelId: string,
  previousModelId?: string,
  previousDisplayName?: string,
): string {
  const normalizedModelId = modelId.trim();
  if (!normalizedModelId) return '';
  const model = models.find((item) => item.id === normalizedModelId);
  if (model) return getQaModelDisplayName(model);
  return normalizedModelId === previousModelId?.trim() ? previousDisplayName?.trim() || '' : '';
}

function getQaModelOptionLabel(model: QAModelOption): string {
  const labelParts = [getQaModelDisplayName(model)];
  if (model.display_name && model.display_name !== model.name) {
    labelParts.push(model.display_name);
  }
  labelParts.push(`ID ${model.id}`);
  if (model.key && model.key !== model.id) {
    labelParts.push(`Key ${model.key}`);
  } else if (model.key) {
    labelParts.push(`Key ${model.key}`);
  }
  return labelParts.join(' / ');
}

function QaModelCascaderSelect({
  title,
  required = false,
  allowEmpty = false,
  models,
  selectedModel,
  invalid = false,
  onSelect,
}: {
  title: string;
  required?: boolean;
  allowEmpty?: boolean;
  models: QAModelOption[];
  selectedModel: string;
  invalid?: boolean;
  onSelect: (modelId: string) => void;
}) {
  const groups = buildQaModelProviderGroups(models);
  const selected = models.find((model) => model.id === selectedModel);
  const selectedProvider = selected ? getQaModelProviderName(selected) : '';
  const fallbackProvider = selectedProvider || groups[0]?.provider_name || '';
  const [activeProvider, setActiveProvider] = useState(fallbackProvider);
  const [open, setOpen] = useState(false);
  const resolvedActiveProvider = groups.some((group) => group.provider_name === activeProvider)
    ? activeProvider
    : fallbackProvider;
  const activeGroup = groups.find((group) => group.provider_name === resolvedActiveProvider) || groups[0];
  const activeModels = activeGroup?.models ?? [];
  const selectedLabel = selected
    ? `${getQaModelProviderName(selected)} / ${getQaModelDisplayName(selected)}`
    : invalid
      ? '当前配置模型已停用或不可用'
      : allowEmpty && !selectedModel
        ? '不配置推理模型'
        : '请选择服务商和模型';

  function handleModelSelect(modelId: string) {
    onSelect(modelId);
    setOpen(false);
  }

  return (
    <div className={`${s.qaModelSelectorCard} ${invalid ? s.qaModelSelectorCardInvalid : ''}`}>
      <div className={s.qaModelSelectorHeader}>
        <div className={s.valueStack}>
          <span className={s.valueTitle}>{title}{required ? ' *' : ''}</span>
          <span className={`${s.valueMeta} ${invalid ? s.modelInvalidText : ''}`}>{selectedLabel}</span>
        </div>
        <span className={`${s.checkboxMark} ${selected ? s.checkboxMarkActive : ''}`}>
          {selected ? '已选' : required ? '必选' : '可选'}
        </span>
      </div>

      {invalid ? <div className={s.modelInvalidNotice}>原配置已保留，但保存前需要重新选择启用模型。</div> : null}

      <div className={s.qaModelCascader}>
        <button
          type="button"
          className={`${s.qaModelCascaderTrigger} ${open ? s.qaModelCascaderTriggerOpen : ''}`}
          aria-expanded={open}
          disabled={!groups.length}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selectedLabel}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open ? (
          <div className={s.qaModelCascaderMenu}>
            <div className={s.qaModelCascaderColumn}>
              <span className={s.qaModelCascaderColumnTitle}>服务商</span>
              {groups.map((group) => (
                <button
                  key={group.provider_name}
                  type="button"
                  className={`${s.qaModelCascaderOption} ${group.provider_name === activeGroup?.provider_name ? s.qaModelCascaderOptionActive : ''}`}
                  onMouseEnter={() => setActiveProvider(group.provider_name)}
                  onClick={() => setActiveProvider(group.provider_name)}
                >
                  <span>{group.provider_name}</span>
                  <span className={s.qaModelCascaderCount}>{group.models.length}</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className={s.qaModelCascaderColumn}>
              <span className={s.qaModelCascaderColumnTitle}>模型</span>
              {allowEmpty ? (
                <button
                  type="button"
                  className={`${s.qaModelCascaderOption} ${!selectedModel ? s.qaModelCascaderOptionActive : ''}`}
                  onClick={() => handleModelSelect('')}
                >
                  <span>不配置推理模型</span>
                </button>
              ) : null}
              {activeModels.map((model) => (
                <button
                  key={`${title}-${model.id}`}
                  type="button"
                  className={`${s.qaModelCascaderModelOption} ${model.id === selectedModel ? s.qaModelCascaderOptionActive : ''}`}
                  aria-label={getQaModelOptionLabel(model)}
                  onClick={() => handleModelSelect(model.id)}
                >
                  <span className={s.qaModelCascaderModelMain}>
                    <span className={s.qaModelCascaderModelName}>{getQaModelDisplayName(model)}</span>
                    <span className={s.qaModelCascaderModelMeta}>ID {model.id}{model.visual ? ' · 支持视觉' : ' · 文本模型'}</span>
                    {model.remark ? <span className={s.qaModelCascaderRemark}>{model.remark}</span> : null}
                  </span>
                  <span className={`${s.qaModelStatus} ${getQaModelStatusClassName(model.status)}`}>{getQaModelStatusLabel(model.status)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {selected ? (
        <div className={s.qaModelSelectedMeta}>
          <span>ID {selected.id}</span>
          {selected.key ? <span>Key {selected.key}</span> : null}
          <span>{selected.visual ? '支持视觉' : '文本模型'}</span>
          <span className={`${s.qaModelStatus} ${getQaModelStatusClassName(selected.status)}`}>{getQaModelStatusLabel(selected.status)}</span>
        </div>
      ) : null}
    </div>
  );
}

function getQaModelStatusLabel(status: number): string {
  if (status === 1) return '异常';
  if (status === 2) return '未知';
  return '可用';
}

function getQaModelStatusClassName(status: number): string {
  if (status === 1) return s.qaModelStatusAbnormal;
  if (status === 2) return s.qaModelStatusUnknown;
  return s.qaModelStatusAvailable;
}

function getQaDialogTitle(mode: Exclude<QaDialogMode, null>) {
  switch (mode) {
    case 'welcome_message':
      return '编辑欢迎语';
    case 'hot_questions':
      return '编辑热门问题';
    case 'ai_search_system_prompt':
      return '编辑 搜索助手';
    case 'qa_system_prompt':
      return '编辑旧技术问答 Prompt';
    case 'quick_mode_system_prompt':
      return '编辑快速模式 Prompt';
    case 'normal_mode_system_prompt':
      return '编辑普通模式 Prompt';
    case 'expert_mode_system_prompt':
      return '编辑专家模式 Prompt';
  }
}

function getQaDialogNote(mode: Exclude<QaDialogMode, null>) {
  switch (mode) {
    case 'welcome_message':
      return '首页 QA 卡片和问答页新会话首条消息都会共用这句欢迎语。';
    case 'hot_questions':
      return '每行一条，首页问答模块会按当前展示配置截取显示。';
    case 'ai_search_system_prompt':
      return '搜索页里的 搜索助手 总结会使用这一段配置。';
    case 'qa_system_prompt':
      return '兼容历史配置保留，新版问答页不再读取这一项。';
    case 'quick_mode_system_prompt':
      return '问答页选择快速模式时使用这一段系统提示词。';
    case 'normal_mode_system_prompt':
      return '问答页选择普通模式时使用这一段系统提示词。';
    case 'expert_mode_system_prompt':
      return '问答页选择专家模式时使用这一段系统提示词，并使用推理模型。';
  }
}

function getQaDialogLabel(mode: Exclude<QaDialogMode, null>) {
  switch (mode) {
    case 'welcome_message':
      return '欢迎语';
    case 'hot_questions':
      return '热门问题';
    case 'ai_search_system_prompt':
      return '搜索助手';
    case 'qa_system_prompt':
      return '旧技术问答 Prompt';
    case 'quick_mode_system_prompt':
      return '快速模式 Prompt';
    case 'normal_mode_system_prompt':
      return '普通模式 Prompt';
    case 'expert_mode_system_prompt':
      return '专家模式 Prompt';
  }
}

function getQaDialogPlaceholder(mode: Exclude<QaDialogMode, null>) {
  switch (mode) {
    case 'welcome_message':
      return '例如：你好，我是首钢股份知库智能助手，请问有什么可以帮您？';
    case 'hot_questions':
      return '每行输入一条热门问题';
    default:
      return '请输入内容';
  }
}

function getDisplayItems(display: DisplayConfig): DisplayItem[] {
  return [
    { group: '首页', key: 'home.section_page_size', label: '知识推荐/典型案例条数', value: display.home.section_page_size },
    { group: '首页', key: 'home.hot_tags_count', label: '热门标签条数', value: display.home.hot_tags_count },
   /* { group: '首页', key: 'home.qa_hot_count', label: '技术问答热门问题条数', value: display.home.qa_hot_count },
    { group: '首页', key: 'home.domain_count', label: '业务域导航条数', value: display.home.domain_count },
    { group: '首页', key: 'home.spaces_count', label: '知识广场条数', value: display.home.spaces_count },
    { group: '首页', key: 'home.apps_count', label: '应用市场条数', value: display.home.apps_count },*/
    { group: '列表页', key: 'list.page_size', label: '列表页每页文档数', value: display.list.page_size },
    { group: '列表页', key: 'list.visible_tag_count', label: '列表页单条标签展示数', value: display.list.visible_tag_count },
    { group: '搜索页', key: 'search.page_size', label: '搜索页每页文档数', value: display.search.page_size },
    { group: '搜索页', key: 'search.visible_tag_count', label: '搜索页单条标签展示数', value: display.search.visible_tag_count },
    /*{ group: '详情页', key: 'detail.related_files_count', label: '相关推荐条数', value: display.detail.related_files_count },
    { group: '详情页', key: 'detail.visible_tag_count', label: '相关推荐标签展示数', value: display.detail.visible_tag_count },*/
  ];
}

async function persistDomains(domains: DomainConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateDomainsConfig(domains);
  setConfig((current) => (current ? { ...current, domains: data.domains } : current));
}

async function persistSections(sections: SectionConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSectionsConfig(sections);
  setConfig((current) => (current ? { ...current, sections: data.sections } : current));
}

function normalizeDocumentTypeCode(value?: string): string {
  return (value ?? '').trim().toUpperCase();
}

function getDocumentTypeChildren(documentType: DocumentTypeConfig): Array<{ code: string; label: string; description_examples: string }> {
  if (Array.isArray(documentType.children) && documentType.children.length) {
    return documentType.children.map((child) => ({
      code: child.code ?? '',
      label: child.label,
      description_examples: child.description_examples ?? '',
    }));
  }
  return documentType.code && documentType.label
    ? [{ code: documentType.code, label: documentType.label, description_examples: '' }]
    : [];
}

function createDocumentTypeDraft(documentType?: DocumentTypeConfig): DocumentTypeDraft {
  if (!documentType) {
    return { code: '', label: '', description_examples: '', children: [{ label: '' }] };
  }
  const children = getDocumentTypeChildren(documentType);
  return {
    code: documentType.code,
    label: documentType.label,
    description_examples: documentType.description_examples ?? '',
    children: children.length ? children : [{ code: documentType.code, label: documentType.label }],
  };
}

function buildDocumentTypeFromDraft(
  draft: DocumentTypeDraft,
  documentTypes: DocumentTypeConfig[],
  editIndex: number | null,
): { documentType?: DocumentTypeConfig; error?: string } {
  const code = normalizeDocumentTypeCode(draft.code);
  const label = draft.label.trim();
  const description_examples = draft.description_examples.trim();
  if (!code) return { error: '请输入一级分类编码' };
  if (!label) return { error: '请输入一级分类名称' };
  if (documentTypes.some((item, index) => index !== editIndex && normalizeDocumentTypeCode(item.code) === code)) {
    return { error: '一级分类编码已存在' };
  }

  const children: NonNullable<DocumentTypeConfig['children']> = [];
  for (const child of draft.children) {
    const childCode = normalizeDocumentTypeCode(child.code);
    const childLabel = child.label.trim();
    const childDescriptionExamples = (child.description_examples ?? '').trim();
    if (!childLabel) continue;
    const nextChild = childCode ? { code: childCode, label: childLabel } : { label: childLabel };
    children.push(childDescriptionExamples ? { ...nextChild, description_examples: childDescriptionExamples } : nextChild);
  }
  if (!children.length) return { error: '每个一级分类必须至少添加一个二级分类' };

  const childCodes = children.map((child) => normalizeDocumentTypeCode(child.code)).filter(Boolean);
  if (childCodes.some((childCode, index) => childCodes.indexOf(childCode) !== index)) {
    return { error: '同一一级分类下的二级分类编码不能重复' };
  }
  const existingChildCodes = new Set<string>();
  documentTypes.forEach((item, index) => {
    if (index === editIndex) return;
    getDocumentTypeChildren(item).forEach((child) => existingChildCodes.add(normalizeDocumentTypeCode(child.code)));
  });
  if (children.some((child) => existingChildCodes.has(normalizeDocumentTypeCode(child.code)))) {
    return { error: '二级分类编码已存在，请使用全局唯一编码' };
  }

  return { documentType: { code, label, description_examples, children } };
}

async function persistDocumentTypes(document_types: DocumentTypeConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateDocumentTypesConfig(document_types);
  setConfig((current) => (current ? { ...current, document_types: data.document_types } : current));
}

async function persistQa(qa: QAConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateQaConfig(qa);
  setConfig((current) => (current ? { ...current, qa: data } : current));
}

async function persistAgentConfig(agentConfig: AgentConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateAgentConfig(agentConfig);
  setConfig((current) => (current ? { ...current, agent_config: data } : current));
}

async function persistSearch(search: SearchConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSearchConfig(search);
  setConfig((current) => (current ? { ...current, search: data } : current));
}

async function persistRecommendation(recommendation: RecommendationConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateRecommendationConfig(recommendation);
  setConfig((current) => (current ? { ...current, recommendation: data } : current));
}

async function persistDisplay(display: DisplayConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateDisplayConfig(display);
  setConfig((current) => (current ? { ...current, display: data } : current));
}

async function persistIntegrations(integrations: IntegrationsConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateIntegrationsConfig(integrations);
  setConfig((current) => (current ? { ...current, integrations: data } : current));
}

async function persistSite(site: SiteConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSiteConfig(site);
  setConfig((current) => (current ? { ...current, site: data } : current));
}

type SaveRunner = (task: () => Promise<void>) => Promise<void>;
type ConfigSetter = Dispatch<SetStateAction<PortalConfig | null>>;

async function handleAddDomain(
  domains: DomainConfig[],
  next: DomainConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  await runSave(async () => {
    await persistDomains([...domains, next], setConfig);
    options?.onSuccess?.();
  });
}

async function handleEditDomain(
  domains: DomainConfig[],
  index: number,
  next: DomainConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  const updated = [...domains];
  updated[index] = next;
  await runSave(async () => {
    await persistDomains(updated, setConfig);
    options?.onSuccess?.();
  });
}

async function handleDeleteDomain(
  domains: DomainConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { confirm?: boolean; onSuccess?: () => void },
) {
  if (options?.confirm !== false && !window.confirm(`确定删除业务域“${domains[index].name}”吗？`)) return;
  await runSave(async () => {
    await persistDomains(domains.filter((_, i) => i !== index), setConfig);
    options?.onSuccess?.();
  });
}

async function handleMoveDomain(
  domains: DomainConfig[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= domains.length) return;
  const reordered = [...domains];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistDomains(reordered, setConfig));
}

async function handleAddSection(
  sections: SectionConfig[],
  next: SectionConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  await runSave(async () => {
    await persistSections([...sections, next], setConfig);
    options?.onSuccess?.();
  });
}

async function handleEditSection(
  sections: SectionConfig[],
  index: number,
  next: SectionConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  const updated = [...sections];
  updated[index] = next;
  await runSave(async () => {
    await persistSections(updated, setConfig);
    options?.onSuccess?.();
  });
}

async function handleDeleteSection(
  sections: SectionConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { confirm?: boolean; onSuccess?: () => void },
) {
  if (isBuiltinSection(sections[index])) return;
  if (options?.confirm !== false && !window.confirm(`确定删除分区“${sections[index].title}”吗？`)) return;
  await runSave(async () => {
    await persistSections(sections.filter((_, i) => i !== index), setConfig);
    options?.onSuccess?.();
  });
}

async function handleMoveSection(
  sections: SectionConfig[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sections.length) return;
  const reordered = [...sections];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistSections(reordered, setConfig));
}

async function handleDeleteDocumentType(
  documentTypes: DocumentTypeConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const next = documentTypes.filter((_, i) => i !== index);
  await runSave(() => persistDocumentTypes(next, setConfig));
}

async function handleMoveDocumentType(
  documentTypes: DocumentTypeConfig[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= documentTypes.length) return;
  const reordered = [...documentTypes];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistDocumentTypes(reordered, setConfig));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatQaModelLabel(models: QAModelOption[], modelId: string): string {
  if (!modelId) return '';
  const model = models.find((item) => item.id === modelId);
  return model ? (model.name || model.display_name || model.id) : modelId;
}


async function handleAdjustDisplay(
  display: DisplayConfig,
  key: string,
  delta: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const currentValue = getDisplayValue(display, key);
  const nextValue = Math.max(0, currentValue + delta);
  if (nextValue === currentValue) return;
  await runSave(() => persistDisplay(setDisplayValue(display, key, nextValue), setConfig));
}

function getDisplayValue(display: DisplayConfig, key: string): number {
  const [group, field] = key.split('.');
  switch (group) {
    case 'home':
      return display.home[field as keyof DisplayConfig['home']];
    case 'list':
      return display.list[field as keyof DisplayConfig['list']];
    case 'search':
      return display.search[field as keyof DisplayConfig['search']];
    case 'detail':
      return display.detail[field as keyof DisplayConfig['detail']];
    default:
      return 0;
  }
}

function setDisplayValue(display: DisplayConfig, key: string, value: number): DisplayConfig {
  const [group, field] = key.split('.');
  return {
    ...display,
    [group]: {
      ...display[group as keyof DisplayConfig],
      [field]: value,
    },
  };
}

function createBishengDraft(current?: BishengRuntimeConfig): BishengDraft {
  return {
    base_url: current?.base_url ?? '',
    asset_base_url: current?.asset_base_url ?? '',
    username: current?.username ?? '',
    password: '',
    timeout_seconds: current ? String(current.timeout_seconds) : '30',
  };
}

function createUnifiedAuthDraft(current?: UnifiedAuthRuntimeConfig): UnifiedAuthDraft {
  return {
    enabled: current?.enabled ?? false,
    provider: current?.provider ?? 'group',
    client_id: current?.client_id ?? '',
    client_secret: '',
    redirect_uri: current?.redirect_uri ?? '',
    authorize_url: current?.authorize_url ?? '',
    token_url: current?.token_url ?? '',
    userinfo_url: current?.userinfo_url ?? '',
    token_param_style: current?.token_param_style ?? 'query',
    state_secret: '',
    state_ttl_seconds: String(current?.state_ttl_seconds ?? 300),
    http_timeout_seconds: String(current?.http_timeout_seconds ?? 10),
    login_sync_hmac_secret: '',
    login_sync_signature_header: current?.login_sync_signature_header || 'X-Signature',
  };
}

function formatUnifiedAuthProvider(provider?: UnifiedAuthRuntimeConfig['provider']) {
  if (provider === 'stock') return '股份统一认证';
  if (provider === 'custom') return '自定义端点';
  return '集团统一认证';
}

function createIntegrationsDraft(current?: IntegrationsConfig): IntegrationsDraft {
  return {
    bisheng_admin_entry_url: current?.bisheng_admin_entry_url ?? '',
    bisheng_knowledge_entry_url: current?.bisheng_knowledge_entry_url ?? '',
  };
}

function createSiteDraft(current?: SiteConfig): SiteDraft {
  return {
    header_brand_name: current?.header_brand_name ?? '首钢股份知库',
    header_logo_url: current?.header_logo_url ?? '/site-logo-new.png',
    login_brand_name: current?.login_brand_name ?? '首钢股份知库',
    login_logo_url: current?.login_logo_url ?? '/shougang-stock-logo.png',
    browser_title: current?.browser_title ?? '首钢股份知库',
    favicon_url: current?.favicon_url ?? '/site-favicon-horizontal-v2.png',
    domain_count_cache_ttl_seconds: String(current?.domain_count_cache_ttl_seconds ?? 43200),
    home_cache_ttl_seconds: String(current?.home_cache_ttl_seconds ?? 1800),
  };
}

function validateSiteDraft(draft: SiteDraft): { site?: SiteConfig; error?: string } {
  const ttl = Number(draft.domain_count_cache_ttl_seconds.trim());
  if (!Number.isInteger(ttl) || ttl < 60) {
    return { error: '业务域计数缓存有效期需为不小于 60 的整数（秒）' };
  }
  const homeTtl = Number(draft.home_cache_ttl_seconds.trim());
  if (!Number.isInteger(homeTtl) || homeTtl < 60) {
    return { error: '首页数据缓存有效期需为不小于 60 的整数（秒）' };
  }
  const site: SiteConfig = {
    header_brand_name: draft.header_brand_name.trim(),
    header_logo_url: normalizeAssetUrl(draft.header_logo_url),
    login_brand_name: draft.login_brand_name.trim(),
    login_logo_url: normalizeAssetUrl(draft.login_logo_url),
    browser_title: draft.browser_title.trim(),
    favicon_url: normalizeAssetUrl(draft.favicon_url),
    domain_count_cache_ttl_seconds: ttl,
    home_cache_ttl_seconds: homeTtl,
  };
  if (!site.header_brand_name) return { error: '请输入顶部品牌名' };
  if (!site.login_brand_name) return { error: '请输入登录页品牌名' };
  if (!site.browser_title) return { error: '请输入浏览器标签页文字' };
  for (const [label, value] of [
    ['顶部 Header Logo', site.header_logo_url],
    ['登录页 Logo', site.login_logo_url],
    ['浏览器标签页图标', site.favicon_url],
  ] as const) {
    if (!value) return { error: `请输入${label}` };
    if (!isValidAssetUrl(value)) return { error: `${label} 需填写站内本地路径或 http(s) 线上图片地址` };
  }
  return { site };
}

function normalizeAssetUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return `/${trimmed.replace(/^\.?\//, '')}`;
}

function isValidAssetUrl(value: string): boolean {
  return value.startsWith('/') || /^https?:\/\//i.test(value);
}

function validateBishengDraft(draft: BishengDraft): {
  payload?: {
    base_url: string;
    asset_base_url: string;
    username: string;
    password: string;
    timeout_seconds: number;
  };
  error?: string;
} {
  const base_url = draft.base_url.trim();
  if (!/^https?:\/\//i.test(base_url)) return { error: '请输入有效的大模型应用平台地址，必须以 http:// 或 https:// 开头' };

  const asset_base_url = draft.asset_base_url.trim();
  if (asset_base_url && !/^https?:\/\//i.test(asset_base_url)) {
    return { error: '资源域名（asset_base_url）必须以 http:// 或 https:// 开头，留空则与大模型应用平台地址相同' };
  }

  const timeout_seconds = Number(draft.timeout_seconds.trim());
  if (!Number.isFinite(timeout_seconds) || timeout_seconds <= 0) {
    return { error: '请输入有效的超时时间（秒）' };
  }

  return {
    payload: {
      base_url,
      asset_base_url,
      username: draft.username.trim(),
      password: draft.password,
      timeout_seconds,
    },
  };
}

function validateUnifiedAuthDraft(draft: UnifiedAuthDraft): {
  payload?: Parameters<typeof updateUnifiedAuthRuntimeConfig>[0];
  error?: string;
} {
  const client_id = draft.client_id.trim();
  const redirect_uri = draft.redirect_uri.trim();
  const authorize_url = draft.authorize_url.trim();
  const token_url = draft.token_url.trim();
  const userinfo_url = draft.userinfo_url.trim();
  const login_sync_signature_header = draft.login_sync_signature_header.trim() || 'X-Signature';

  if (draft.enabled && !client_id) return { error: '启用统一认证前需要填写 client_id' };
  if (draft.enabled && !redirect_uri) return { error: '启用统一认证前需要填写 redirect_uri' };
  if (redirect_uri && !/^https?:\/\//i.test(redirect_uri)) return { error: 'redirect_uri 必须以 http:// 或 https:// 开头' };

  for (const [label, value] of [
    ['authorize_url', authorize_url],
    ['token_url', token_url],
    ['userinfo_url', userinfo_url],
  ] as const) {
    if (value && !/^https?:\/\//i.test(value)) {
      return { error: `${label} 必须以 http:// 或 https:// 开头` };
    }
  }

  if (draft.enabled && draft.provider === 'custom' && (!authorize_url || !token_url || !userinfo_url)) {
    return { error: '自定义端点需要填写 authorize_url、token_url 和 userinfo_url' };
  }

  const state_ttl_seconds = Number(draft.state_ttl_seconds.trim());
  if (!Number.isInteger(state_ttl_seconds) || state_ttl_seconds <= 0) {
    return { error: 'state TTL 需为大于 0 的整数秒' };
  }

  const http_timeout_seconds = Number(draft.http_timeout_seconds.trim());
  if (!Number.isFinite(http_timeout_seconds) || http_timeout_seconds <= 0) {
    return { error: 'HTTP 超时需为大于 0 的数字秒' };
  }

  return {
    payload: {
      enabled: draft.enabled,
      provider: draft.provider,
      client_id,
      client_secret: draft.client_secret.trim(),
      redirect_uri,
      authorize_url,
      token_url,
      userinfo_url,
      token_param_style: draft.token_param_style,
      state_secret: draft.state_secret.trim(),
      state_ttl_seconds,
      http_timeout_seconds,
      login_sync_hmac_secret: draft.login_sync_hmac_secret.trim(),
      login_sync_signature_header,
    },
  };
}

async function persistBanners(banners: BannerSlide[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateBannersConfig(banners);
  setConfig((current) => (current ? { ...current, banners: data.banners } : current));
}

async function handleMoveBanner(
  banners: BannerSlide[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= banners.length) return;
  const reordered = [...banners];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistBanners(reordered, setConfig));
}

function BannersTable({
  banners,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  banners: BannerSlide[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>首页 Banner 管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        管理首页顶部轮播 Banner。可上传本地图片或填写外部图片地址；列表顺序即轮播顺序，停用后该 Banner 不会出现在前台。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>顺序</th>
            <th>预览</th>
            <th>标题 / 副标题</th>
            <th>跳转</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {banners.map((banner, index) => (
            <tr key={banner.id}>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onMoveUp(index)} disabled={saving || index === 0} aria-label="上移"><ArrowUp size={14} /></button>
                  <button className={s.inlineBtn} onClick={() => onMoveDown(index)} disabled={saving || index === banners.length - 1} aria-label="下移"><ArrowDown size={14} /></button>
                </div>
              </td>
              <td>
                {banner.image_url ? (
                  <img
                    src={banner.image_url}
                    alt={banner.title}
                    style={{ width: 120, height: 60, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                  />
                ) : (
                  <span className={s.inlineHint}>无图片</span>
                )}
              </td>
              <td>
                <div className={s.valueStack}>
                  {banner.label ? <span className={s.valueMeta}>{banner.label}</span> : null}
                  <span className={s.valueTitle}>{banner.title}</span>
                  {banner.desc ? <span className={s.valueMeta}>{truncateText(banner.desc, 48)}</span> : null}
                </div>
              </td>
              <td>{banner.link_url ? <span className={s.valueMeta}>{truncateText(banner.link_url, 36)}</span> : <span className={s.inlineHint}>不可点击</span>}</td>
              <td>
                <span className={banner.enabled ? s.stateEnabled : s.stateDisabled}>
                  {banner.enabled ? '已启用' : '已停用'}
                </span>
              </td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                </div>
              </td>
            </tr>
          ))}
          {!banners.length ? (
            <tr><td colSpan={6}><div className={s.emptyState}>暂无 Banner，点击右上角「添加」创建一条。</div></td></tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

const BANNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

function ImageUploadField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > BANNER_IMAGE_MAX_BYTES) {
      setError('图片不得超过 5MB');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const data = await uploadBannerImage(file);
      onChange(data.image_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={s.subtleBtn}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          <Upload size={14} />
          {uploading ? '上传中…' : '上传图片'}
        </button>
        <span className={s.fieldHint}>支持 JPEG / PNG / WebP，最大 5MB</span>
        <input
          ref={inputRef}
          type="file"
          accept={BANNER_IMAGE_ACCEPT}
          style={{ display: 'none' }}
          onChange={handleSelect}
        />
      </div>
      {value ? (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <img
            src={value}
            alt="预览"
            style={{ maxWidth: 240, maxHeight: 120, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--neutral-200)' }}
          />
          <button
            type="button"
            className={s.subtleBtn}
            onClick={() => onChange('')}
            disabled={disabled || uploading}
            aria-label="移除图片"
          >
            <X size={14} /> 移除
          </button>
        </div>
      ) : null}
      {error ? <div className={s.errorBox} style={{ marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}

function BannerEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: BannerDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<BannerDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.title.trim() ? `编辑 Banner · ${draft.title}` : '新增 Banner'}</h3>
            <p className={s.modalNote}>统一在这里维护首页轮播 Banner 的图片、文案和跳转地址。</p>
          </div>
          <div className={s.modalHeaderActions}>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ enabled: !draft.enabled })}>
              <span>{draft.enabled ? '已启用' : '已停用'}</span>
              <span className={`${s.switchTrack} ${draft.enabled ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.enabled ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          </div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>Banner ID</span>
              <input className={s.formInput} value={draft.id} onChange={(event) => onChange({ id: event.target.value })} placeholder="例如：4" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>左上角小标签</span>
              <input className={s.formInput} value={draft.label} onChange={(event) => onChange({ label: event.target.value })} placeholder="例如：平台概览" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>主标题</span>
              <input className={s.formInput} value={draft.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="例如：首钢股份知库 — 钢铁行业知识共享平台" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>副标题</span>
              <textarea className={s.formTextarea} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} placeholder="一句话描述 Banner 主题" />
            </label>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>图片</span>
              <ImageUploadField
                value={draft.image_url}
                onChange={(next) => onChange({ image_url: next })}
                disabled={saving}
              />
              <input
                className={s.formInput}
                value={draft.image_url}
                onChange={(event) => onChange({ image_url: event.target.value })}
                placeholder="或填写图片地址：/banner-hero-1.jpg 或 https://…"
                style={{ marginTop: 8 }}
              />
            </div>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>跳转 URL</span>
              <input className={s.formInput} value={draft.link_url} onChange={(event) => onChange({ link_url: event.target.value })} placeholder="留空则 Banner 不可点击" />
              <span className={s.fieldHint}>填写后整张 Banner 可点击，跳转到此地址（http(s):// 开头）。</span>
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function BannerDeleteDialog({
  open,
  banner,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  banner: BannerSlide;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除 Banner</h3>
            <p className={s.modalNote}>删除后首页该 Banner 立即下线。已上传到服务器的图片文件不会被自动清理。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>主标题：</strong>{banner.title}</div>
          {banner.label ? <div className={s.confirmLine}><strong>小标签：</strong>{banner.label}</div> : null}
          <div className={s.confirmLine}><strong>图片：</strong>{banner.image_url}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function DocumentTypesTable({
  documentTypes,
  saving,
  onViewChildren,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  documentTypes: DocumentTypeConfig[];
  saving: boolean;
  onViewChildren: (index: number) => void;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>文件分类管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>一级分类用于分组，上传和筛选时使用二级分类；每个一级分类必须至少包含一个二级分类。</p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>编码</th>
            <th>名称</th>
            <th>分类描述及示例</th>
            <th>二级分类</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {documentTypes.length === 0 ? (
            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>暂无文件分类，请点击右上角添加</td></tr>
          ) : documentTypes.map((dt, index) => {
            const children = getDocumentTypeChildren(dt);
            const descriptionExamples = dt.description_examples?.trim() ?? '';
            return (
              <Fragment key={dt.code}>
                <tr className={s.documentTypeRow} onClick={() => onViewChildren(index)}>
                  <td>
                    <div className={s.documentTypeCodeCell}>
                      <button
                        type="button"
                        className={s.rowExpandBtn}
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewChildren(index);
                        }}
                        aria-label="查看二级分类"
                        title="查看二级分类"
                      >
                        <ChevronRight size={16} />
                      </button>
                      <span>{dt.code}</span>
                    </div>
                  </td>
                  <td>{dt.label}</td>
                  <td>
                    {descriptionExamples ? (
                      <span className={s.documentTypeDescription} title={descriptionExamples}>
                        {descriptionExamples}
                      </span>
                    ) : (
                      <span className={s.inlineHint}>--</span>
                    )}
                  </td>
                  <td><span className={s.inlineHint}>{children.length} 个二级分类</span></td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className={s.actionGroup}>
                      <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                      <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                      <button className={s.iconActionBtn} onClick={() => onMoveUp(index)} disabled={saving || index === 0} aria-label="上移" title="上移"><ArrowUp size={15} /></button>
                      <button className={s.iconActionBtn} onClick={() => onMoveDown(index)} disabled={saving || index === documentTypes.length - 1} aria-label="下移" title="下移"><ArrowDown size={15} /></button>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function DocumentTypeChildrenDialog({
  documentType,
  onClose,
}: {
  documentType: DocumentTypeConfig;
  onClose: () => void;
}) {
  const children = getDocumentTypeChildren(documentType);
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={`${s.confirmCard} ${s.documentTypeChildrenCard}`} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader} style={{ justifyContent: "space-between" }}>
          <div>
            <span>二级分类列表</span>
            <div className={s.documentTypeChildrenSubTitle}>
              {documentType.code} / {documentType.label}，共 {children.length} 个二级分类
            </div>
          </div>
          <button className={s.subtleBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div className={s.confirmBody}>
          <table className={s.childTypeTable}>
            <thead>
              <tr>
                <th>二级分类名称</th>
                <th>分类描述及示例</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => {
                const childDescriptionExamples = child.description_examples.trim();
                return (
                  <tr key={child.code || child.label}>
                    <td>{child.label}</td>
                    <td>
                      {childDescriptionExamples ? (
                        <span className={s.documentTypeDescription} title={childDescriptionExamples}>
                          {childDescriptionExamples}
                        </span>
                      ) : (
                        <span className={s.inlineHint}>--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function DocumentTypeEditorDialog({
  open,
  title,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  draft: DocumentTypeDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (updater: SetStateAction<DocumentTypeDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  function updateChild(index: number, patch: Partial<{ code?: string; label: string; description_examples?: string }>) {
    onChange((current) => ({
      ...current,
      children: current.children.map((child, i) => i === index ? { ...child, ...patch } : child),
    }));
  }
  return (
    <div className={s.modalBackdrop}>
      <div className={`${s.confirmCard} ${s.documentTypeEditorCard}`}>
        <div className={s.modalHeader} style={{ justifyContent: "space-between" }}>
          <span>{title}</span>
          <button className={s.subtleBtn} onClick={onClose}><X size={18} /></button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.documentTypeEditorGrid}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>一级分类编码</span>
              <input className={s.formInput} value={draft.code} placeholder="如 POL" onChange={(e) => onChange((current) => ({ ...current, code: e.target.value }))} />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>一级分类名称</span>
              <input className={s.formInput} value={draft.label} placeholder="如 政策制度" onChange={(e) => onChange((current) => ({ ...current, label: e.target.value }))} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>分类描述及示例</span>
              <textarea
                className={s.formTextarea}
                value={draft.description_examples}
                placeholder="填写该一级分类的说明、适用范围或示例文件，可留空"
                onChange={(e) => onChange((current) => ({ ...current, description_examples: e.target.value }))}
              />
            </label>
          </div>
          <div className={s.childTypeEditor}>
            <div className={s.childTypeEditorHeader}>
              <span className={s.fieldLabel}>二级分类</span>
              <button
                type="button"
                className={s.inlineBtn}
                onClick={() => onChange((current) => ({ ...current, children: [...current.children, { label: '' }] }))}
                disabled={saving}
              >
                <Plus size={14} /> 添加二级分类
              </button>
            </div>
            <div className={s.childTypeEditorList}>
              {draft.children.map((child, index) => (
                <div className={s.childTypeEditorRow} key={index}>
                  <input className={s.formInput} value={child.label} placeholder="二级名称" onChange={(event) => updateChild(index, { label: event.target.value })} />
                  <textarea
                    className={s.formTextarea}
                    value={child.description_examples ?? ''}
                    placeholder="分类描述及示例，可留空"
                    onChange={(event) => updateChild(index, { description_examples: event.target.value })}
                  />
                  <button
                    type="button"
                    className={s.iconActionBtn}
                    onClick={() => onChange((current) => ({ ...current, children: current.children.filter((_, i) => i !== index) }))}
                    disabled={saving || draft.children.length <= 1}
                    aria-label="删除二级分类"
                    title="删除二级分类"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {error ? <div className={s.errorBox}>{error}</div> : null}
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>确认</button>
        </div>
      </div>
    </div>
  );
}
