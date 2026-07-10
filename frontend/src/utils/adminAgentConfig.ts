import type { AgentCategoryConfig, AgentConfig, AgentItemConfig } from '../api/adminConfig';

export interface AgentCategoryDraft {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AgentDraft {
  id: string;
  type: 'workflow' | 'url';
  workflowId: string;
  url: string;
  name: string;
  desc: string;
  categoryId: string;
  tagsText: string;
  icon: string;
  iconImageUrl: string;
  color: string;
  bg: string;
  enabled: boolean;
}

export const AGENT_ICON_OPTIONS = [
  'BookOpen',
  'CheckCircle2',
  'Globe',
  'FileText',
  'Send',
  'BarChart3',
  'PenLine',
  'Search',
  'Eye',
  'AlertCircle',
  'ClipboardList',
] as const;

export const AGENT_COLOR_PRESETS = [
  { color: '#0f766e', bg: '#ccfbf1' },
  { color: '#2563eb', bg: '#eff6ff' },
  { color: '#d97706', bg: '#fef3c7' },
  { color: '#4f46e5', bg: '#eef2ff' },
  { color: '#0891b2', bg: '#cffafe' },
  { color: '#16a34a', bg: '#dcfce7' },
  { color: '#ea580c', bg: '#ffedd5' },
  { color: '#e11d48', bg: '#ffe4e6' },
] as const;

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `agent-${Date.now()}`;
}

function splitTags(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createAgentCategoryDraft(category?: Partial<AgentCategoryConfig>): AgentCategoryDraft {
  return {
    id: category?.id ?? '',
    name: category?.name ?? '',
    enabled: category?.enabled ?? true,
  };
}

export function createAgentDraft(agent?: Partial<AgentItemConfig>): AgentDraft {
  return {
    id: agent?.id ?? '',
    type: agent?.type ?? 'workflow',
    workflowId: agent?.workflow_id ?? '',
    url: agent?.url ?? '',
    name: agent?.name ?? '',
    desc: agent?.desc ?? '',
    categoryId: agent?.category_id ?? '',
    tagsText: (agent?.tags ?? []).join('，'),
    icon: agent?.icon ?? 'BookOpen',
    iconImageUrl: agent?.icon_image_url ?? '',
    color: agent?.color ?? AGENT_COLOR_PRESETS[0].color,
    bg: agent?.bg ?? AGENT_COLOR_PRESETS[0].bg,
    enabled: agent?.enabled ?? true,
  };
}

export function createUrlApplicationDraft(categoryId = '', application?: Partial<AgentItemConfig>): AgentDraft {
  return {
    ...createAgentDraft(application),
    type: 'url',
    workflowId: '',
    categoryId: application?.category_id ?? categoryId,
    icon: application?.icon ?? 'Globe',
  };
}

export function toAgentCategoryConfig(draft: AgentCategoryDraft): AgentCategoryConfig {
  return {
    id: normalizeId(draft.id || draft.name),
    name: draft.name.trim(),
    enabled: draft.enabled,
  };
}

export function toAgentItemConfig(draft: AgentDraft): AgentItemConfig {
  return {
    id: normalizeId(draft.id || draft.name || draft.workflowId || draft.url),
    type: draft.type,
    workflow_id: draft.type === 'workflow' ? draft.workflowId.trim() : '',
    url: draft.type === 'url' ? draft.url.trim() : '',
    name: draft.name.trim(),
    desc: draft.desc.trim(),
    category_id: draft.categoryId.trim(),
    tags: splitTags(draft.tagsText),
    icon: draft.icon.trim() || 'BookOpen',
    icon_image_url: draft.iconImageUrl.trim(),
    color: draft.color.trim() || AGENT_COLOR_PRESETS[0].color,
    bg: draft.bg.trim() || AGENT_COLOR_PRESETS[0].bg,
    enabled: draft.enabled,
  };
}

export function validateAgentCategoryDraft(draft: AgentCategoryDraft): string {
  if (!draft.name.trim()) return '分类名称不能为空。';
  if (!normalizeId(draft.id || draft.name)) return '分类 ID 不能为空。';
  return '';
}

export function validateAgentDraft(draft: AgentDraft): string {
  if (draft.type === 'workflow' && !draft.workflowId.trim()) return '请选择 Bisheng 已发布 workflow。';
  if (draft.type === 'url' && !isHttpUrl(draft.url)) return '请输入以 http:// 或 https:// 开头的有效 URL。';
  if (!draft.name.trim()) return '应用展示名称不能为空。';
  if (!draft.categoryId.trim()) return '请选择应用分类。';
  if (!draft.icon.trim()) return '请选择应用图标。';
  if (!draft.color.trim() || !draft.bg.trim()) return '请选择应用颜色。';
  return '';
}

export function validateAgentConfig(config: AgentConfig): string {
  const categoryIds = config.categories.map((category) => category.id.trim()).filter(Boolean);
  if (new Set(categoryIds).size !== categoryIds.length) return 'Agent 分类 ID 不能重复。';
  const validCategoryIds = new Set(categoryIds);
  const applicationIds = config.applications.map((application) => application.id.trim()).filter(Boolean);
  if (new Set(applicationIds).size !== applicationIds.length) return '应用 ID 不能重复。';
  const workflowIds = config.applications
    .filter((application) => application.type === 'workflow')
    .map((application) => application.workflow_id.trim())
    .filter(Boolean);
  if (new Set(workflowIds).size !== workflowIds.length) return 'Agent workflow_id 不能重复。';
  for (const application of config.applications) {
    if (application.type === 'workflow' && !application.workflow_id.trim()) return `${application.name || application.id} 缺少 workflow_id。`;
    if (application.type === 'url' && !isHttpUrl(application.url)) return `${application.name || application.id} 缺少有效 URL。`;
    if (!application.name.trim()) return '应用展示名称不能为空。';
    if (!validCategoryIds.has(application.category_id)) return `${application.name || application.id} 绑定的分类不存在。`;
  }
  return '';
}

export function canDeleteAgentCategory(
  category: AgentCategoryConfig,
  applications: AgentItemConfig[],
): { canDelete: boolean; reason: string } {
  const used = applications.some((application) => application.category_id === category.id);
  if (used) {
    return {
      canDelete: false,
      reason: `分类“${category.name}”正在使用，需先移动或删除关联应用。`,
    };
  }
  return { canDelete: true, reason: '' };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.host)
      && !url.username
      && !url.password
    );
  } catch {
    return false;
  }
}
