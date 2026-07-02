import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

export interface DomainConfig {
  name: string;
  space_ids: number[];
  color: string;
  bg: string;
  icon: string;
  background_image: string;
  enabled: boolean;
  code: string;
}

export interface SectionConfig {
  title: string;
  tag: string;
  link: string;
  icon: string;
  color: string;
  bg: string;
  enabled: boolean;
}

export interface QAConfig {
  welcome_message: string;
  hot_questions: string[];
  ai_search_system_prompt: string;
  qa_system_prompt: string;
  quick_mode_system_prompt: string;
  normal_mode_system_prompt: string;
  expert_mode_system_prompt: string;
  selected_model: string;
  general_model: string;
  reasoning_model: string;
  template_categories: QATemplateCategoryConfig[];
  templates: QATemplateConfig[];
}

export interface QATemplateCategoryConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export interface QATemplateConfig {
  id: string;
  name: string;
  desc: string;
  category_id: string;
  prompt: string;
  icon: string;
  home_icon: string;
  color: string;
  bg: string;
  enabled: boolean;
  show_on_home: boolean;
}

export interface QAModelOption {
  key: string;
  id: string;
  name: string;
  display_name: string;
  visual: boolean;
  provider_name: string;
  status: number;
}

export interface QAModelOptionsResponse {
  selected_model: string;
  general_model: string;
  reasoning_model: string;
  models: QAModelOption[];
}

export interface AgentCategoryConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AgentItemConfig {
  id: string;
  workflow_id: string;
  name: string;
  desc: string;
  category_id: string;
  tags: string[];
  icon: string;
  color: string;
  bg: string;
  enabled: boolean;
}

export interface AgentConfig {
  categories: AgentCategoryConfig[];
  agents: AgentItemConfig[];
}

export interface AgentWorkflowOption {
  workflow_id: string;
  name: string;
  desc: string;
  flow_type: number;
  status: number;
}

export interface AgentWorkflowOptionsResponse {
  workflows: AgentWorkflowOption[];
  has_more: boolean;
  next_cursor: string;
}

export interface SearchConfig {
  rerank_model_id: string;
}

export interface SearchRerankModelOptionsResponse {
  rerank_model_id: string;
  models: QAModelOption[];
}

export interface DocumentTypeConfig {
  code: string;
  label: string;
}

export interface BusinessDomainOption {
  code: string;
  name: string;
}

export interface BishengRuntimeConfig {
  base_url: string;
  asset_base_url: string;
  username: string;
  timeout_seconds: number;
  has_token: boolean;
  has_saved_password: boolean;
  last_auth_at: string;
  connected: boolean;
  auth_message: string;
  auth_user: {
    account: string;
    name: string;
    role: string;
    external_id: string;
  } | null;
}

export interface UnifiedAuthRuntimeConfig {
  enabled: boolean;
  provider: 'group' | 'stock' | 'custom';
  client_id: string;
  redirect_uri: string;
  authorize_url: string;
  token_url: string;
  userinfo_url: string;
  token_param_style: 'query' | 'form';
  state_ttl_seconds: number;
  http_timeout_seconds: number;
  login_sync_signature_header: string;
  has_client_secret: boolean;
  has_state_secret: boolean;
  has_login_sync_hmac_secret: boolean;
}

export interface SpaceOption {
  id: number;
  name: string;
  description: string;
  file_count: number;
  space_level?: string;
  business_domain_codes?: string[];
}

export interface SpaceFileItem {
  id: number;
  name: string;
}

export interface SpaceFolderItem {
  id: number;
  name: string;
  path: string;
}

export interface RecommendationConfig {
  provider: string;
  home_strategy: string;
  detail_strategy: string;
}

export interface DisplayHomeConfig {
  section_page_size: number;
  hot_tags_count: number;
  qa_hot_count: number;
  domain_count: number;
  spaces_count: number;
  apps_count: number;
}

export interface DisplayListConfig {
  page_size: number;
  visible_tag_count: number;
}

export interface DisplaySearchConfig {
  page_size: number;
  visible_tag_count: number;
}

export interface DisplayDetailConfig {
  related_files_count: number;
  visible_tag_count: number;
}

export interface DisplayConfig {
  home: DisplayHomeConfig;
  list: DisplayListConfig;
  search: DisplaySearchConfig;
  detail: DisplayDetailConfig;
}

export interface AppConfig {
  id: number;
  name: string;
  icon: string;
  desc: string;
  color: string;
  bg: string;
  url: string;
  enabled: boolean;
}

export interface BannerSlide {
  id: number;
  label: string;
  title: string;
  desc: string;
  image_url: string;
  link_url: string;
  enabled: boolean;
}

export interface IntegrationsConfig {
  bisheng_admin_entry_url: string;
  bisheng_knowledge_entry_url: string;
}

export interface SiteConfig {
  header_brand_name: string;
  header_logo_url: string;
  login_brand_name: string;
  login_logo_url: string;
  browser_title: string;
  favicon_url: string;
  domain_count_cache_ttl_seconds: number;
}

export interface PortalConfig {
  domains: DomainConfig[];
  sections: SectionConfig[];
  document_types: DocumentTypeConfig[];
  business_domain_options: BusinessDomainOption[];
  qa: QAConfig;
  agent_config: AgentConfig;
  search: SearchConfig;
  recommendation: RecommendationConfig;
  display: DisplayConfig;
  apps: AppConfig[];
  banners: BannerSlide[];
  integrations: IntegrationsConfig;
  site: SiteConfig;
}

export interface AdminConfigImportResult {
  portal: PortalConfig;
  bisheng: BishengRuntimeConfig;
  unified_auth: UnifiedAuthRuntimeConfig;
  message: string;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(response.ok ? '响应内容为空' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? '响应不是有效 JSON' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  if (!response.ok) {
    throw new Error(normalizeUserFacingMessage(payload?.status_message, '请求失败，请稍后重试。', response.status));
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
    });
    return await parseResponse<T>(response);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '请求失败，请稍后重试。'));
  }
}

export function fetchAdminConfig() {
  return request<PortalConfig>('/api/v1/admin/config');
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status);
    const payload = JSON.parse(text) as Partial<ApiEnvelope<unknown>>;
    return normalizeUserFacingMessage(payload.status_message, '请求失败，请稍后重试。', response.status);
  } catch {
    return normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status);
  }
}

function getDownloadFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || `portal-config-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function exportAdminConfig(): Promise<void> {
  try {
    const response = await fetch('/api/v1/admin/config/export');
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = getDownloadFilename(response.headers.get('content-disposition'));
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '导出配置失败，请稍后重试。'));
  }
}

export async function importAdminConfig(file: File): Promise<AdminConfigImportResult> {
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch('/api/v1/admin/config/import', {
      method: 'POST',
      body: form,
    });
    return await parseResponse<AdminConfigImportResult>(response);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '导入配置失败，请稍后重试。'));
  }
}

export function fetchSpaceOptions() {
  return request<{ options: SpaceOption[] }>('/api/v1/admin/config/space-options');
}

export function fetchAdminSpaceFiles(spaceId: number) {
  return request<{ space_id: number; files: SpaceFileItem[] }>(`/api/v1/admin/config/spaces/${spaceId}/files`);
}

export function fetchAdminSpaceFolders(spaceId: number) {
  return request<{ space_id: number; folders: SpaceFolderItem[] }>(`/api/v1/admin/config/spaces/${spaceId}/folders`);
}

export function updateDomainsConfig(domains: DomainConfig[]) {
  return request<{ domains: DomainConfig[] }>('/api/v1/admin/config/domains', {
    method: 'POST',
    body: JSON.stringify({ domains }),
  });
}

export function updateSectionsConfig(sections: SectionConfig[]) {
  return request<{ sections: SectionConfig[] }>('/api/v1/admin/config/sections', {
    method: 'POST',
    body: JSON.stringify({ sections }),
  });
}

export function updateQaConfig(qa: QAConfig) {
  return request<QAConfig>('/api/v1/admin/config/qa', {
    method: 'POST',
    body: JSON.stringify(qa),
  });
}

export function fetchQaModelOptions() {
  return request<QAModelOptionsResponse>('/api/v1/admin/config/qa/model-options');
}

export function fetchAgentConfig() {
  return request<AgentConfig>('/api/v1/admin/config/agent-config');
}

export function updateAgentConfig(agentConfig: AgentConfig) {
  return request<AgentConfig>('/api/v1/admin/config/agent-config', {
    method: 'POST',
    body: JSON.stringify(agentConfig),
  });
}

export function fetchAgentWorkflowOptions(params: {
  keyword?: string;
  cursor?: string;
  page_size?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set('keyword', params.keyword.trim());
  if (params.cursor?.trim()) query.set('cursor', params.cursor.trim());
  if (params.page_size) query.set('page_size', String(params.page_size));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return request<AgentWorkflowOptionsResponse>(`/api/v1/admin/config/agent-config/workflow-options${suffix}`);
}

export function fetchSearchRerankModelOptions() {
  return request<SearchRerankModelOptionsResponse>('/api/v1/admin/config/search/rerank-model-options');
}

export function updateSearchConfig(search: SearchConfig) {
  return request<SearchConfig>('/api/v1/admin/config/search', {
    method: 'POST',
    body: JSON.stringify(search),
  });
}

export function fetchBishengRuntimeConfig() {
  return request<BishengRuntimeConfig>('/api/v1/admin/config/bisheng');
}

export function updateBishengRuntimeConfig(payload: {
  base_url: string;
  asset_base_url: string;
  username: string;
  password: string;
  timeout_seconds: number;
}) {
  return request<BishengRuntimeConfig>('/api/v1/admin/config/bisheng', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchUnifiedAuthRuntimeConfig() {
  return request<UnifiedAuthRuntimeConfig>('/api/v1/admin/config/unified-auth');
}

export function updateUnifiedAuthRuntimeConfig(payload: {
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
  state_ttl_seconds: number;
  http_timeout_seconds: number;
  login_sync_hmac_secret: string;
  login_sync_signature_header: string;
}) {
  return request<UnifiedAuthRuntimeConfig>('/api/v1/admin/config/unified-auth', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateRecommendationConfig(recommendation: RecommendationConfig) {
  return request<RecommendationConfig>('/api/v1/admin/config/recommendation', {
    method: 'POST',
    body: JSON.stringify(recommendation),
  });
}

export function updateDisplayConfig(display: DisplayConfig) {
  return request<DisplayConfig>('/api/v1/admin/config/display', {
    method: 'POST',
    body: JSON.stringify(display),
  });
}

export function updateAppsConfig(apps: AppConfig[]) {
  return request<{ apps: AppConfig[] }>('/api/v1/admin/config/apps', {
    method: 'POST',
    body: JSON.stringify({ apps }),
  });
}

export function updateBannersConfig(banners: BannerSlide[]) {
  return request<{ banners: BannerSlide[] }>('/api/v1/admin/config/banners', {
    method: 'POST',
    body: JSON.stringify({ banners }),
  });
}

export function updateIntegrationsConfig(integrations: IntegrationsConfig) {
  return request<IntegrationsConfig>('/api/v1/admin/config/integrations', {
    method: 'POST',
    body: JSON.stringify(integrations),
  });
}

export function updateSiteConfig(site: SiteConfig) {
  return request<SiteConfig>('/api/v1/admin/config/site', {
    method: 'POST',
    body: JSON.stringify(site),
  });
}

export function updateDocumentTypesConfig(document_types: DocumentTypeConfig[]) {
  return request<{ document_types: DocumentTypeConfig[] }>('/api/v1/admin/config/document-types', {
    method: 'POST',
    body: JSON.stringify({ document_types }),
  });
}

export function updateBusinessDomainOptionsConfig(business_domain_options: BusinessDomainOption[]) {
  return request<{ business_domain_options: BusinessDomainOption[] }>('/api/v1/admin/config/business-domain-options', {
    method: 'POST',
    body: JSON.stringify({ business_domain_options }),
  });
}

export async function uploadBannerImage(file: File): Promise<{ image_url: string }> {
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch('/api/v1/admin/upload/banner', {
      method: 'POST',
      body: form,
    });
    return await parseResponse<{ image_url: string }>(response);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '图片上传失败，请稍后重试。'));
  }
}
