export interface SpaceConfig {
  id: number;
  name: string;
  file_count: number;
  tag_count: number;
  space_level?: string;
  enabled: boolean;
}

export interface DomainConfig {
  name: string;
  space_ids: number[];
  color: string;
  bg: string;
  icon: string;
  background_image: string;
  enabled: boolean;
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
  knowledge_space_ids: number[];
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

export interface BishengRuntimeConfig {
  base_url: string;
  asset_base_url: string;
  username: string;
  timeout_seconds: number;
  has_token: boolean;
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

export interface SpaceOption {
  id: number;
  name: string;
  description: string;
  file_count: number;
  space_level?: string;
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
}

export interface PortalConfig {
  spaces: SpaceConfig[];
  domains: DomainConfig[];
  sections: SectionConfig[];
  qa: QAConfig;
  recommendation: RecommendationConfig;
  display: DisplayConfig;
  apps: AppConfig[];
  banners: BannerSlide[];
  integrations: IntegrationsConfig;
  site: SiteConfig;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(response.ok ? '响应内容为空' : `请求失败：${response.status}`);
  }
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? '响应不是有效 JSON' : `请求失败：${response.status}`);
  }
  if (!response.ok) {
    throw new Error(payload?.status_message || '请求失败');
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  return parseResponse<T>(response);
}

export function fetchAdminConfig() {
  return request<PortalConfig>('/api/v1/admin/config');
}

export function updateSpacesConfig(spaces: SpaceConfig[]) {
  return request<{ spaces: SpaceConfig[] }>('/api/v1/admin/config/spaces', {
    method: 'POST',
    body: JSON.stringify({ spaces }),
  });
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

export async function uploadBannerImage(file: File): Promise<{ image_url: string }> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/v1/admin/upload/banner', {
    method: 'POST',
    body: form,
  });
  return parseResponse<{ image_url: string }>(response);
}
