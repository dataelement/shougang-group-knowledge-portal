import type { QATemplateCategoryConfig, QATemplateConfig } from '../api/adminConfig';

export interface QaTemplateCategoryDraft {
  id: string;
  name: string;
  enabled: boolean;
}

export interface QaTemplateDraft {
  id: string;
  name: string;
  desc: string;
  categoryId: string;
  prompt: string;
  icon: string;
  color: string;
  bg: string;
  enabled: boolean;
  showOnHome: boolean;
}

const ID_PRESETS: Record<string, string> = {
  工作汇报: 'work-report',
  方案策划: 'plan',
  研究报告: 'research-report',
  政务公文: 'official-document',
  思想汇报: 'thought-report',
  心得体会: 'experience-note',
  工作计划: 'work-plan',
  述职报告: 'debriefing-report',
  办公材料撰写: 'office-writing',
  项目实施方案: 'project-impl-plan',
  工作推进方案: 'work-push-plan',
  专项行动方案: 'special-action-plan',
  运营策划方案: 'ops-plan',
  课题研究报告: 'topic-research-report',
  技术白皮书: 'tech-whitepaper',
  产品需求说明书: 'product-prd',
  人才培养发展报告: 'talent-dev-report',
  党建专题讲话: 'party-speech',
  政务工作总结: 'gov-summary',
  语义搜索: 'hero-semantic-search',
  智能问答: 'hero-open-qa',
  文档翻译: 'hero-doc-translate',
};

export const QA_TEMPLATE_ICON_OPTIONS = [
  'PenLine',
  'Search',
  'MessageSquare',
  'Globe',
  'BriefcaseBusiness',
  'Layers3',
  'FileText',
  'ScrollText',
  'Bot',
] as const;

export function createQaTemplateCategoryDraft(current?: QATemplateCategoryConfig): QaTemplateCategoryDraft {
  return {
    id: current?.id ?? '',
    name: current?.name ?? '',
    enabled: current?.enabled ?? true,
  };
}

export function validateQaTemplateCategoryDraft(
  draft: QaTemplateCategoryDraft,
  categories: QATemplateCategoryConfig[] = [],
  currentId?: string,
): { category?: QATemplateCategoryConfig; error?: string } {
  const name = draft.name.trim();
  if (!name) return { error: '请输入分类名称' };
  const id = (draft.id.trim() || buildStableId(name, 'category')).trim();
  if (categories.some((category) => category.id === id && category.id !== currentId)) {
    return { error: '分类 ID 已存在' };
  }
  if (categories.some((category) => category.name === name && category.id !== currentId)) {
    return { error: '分类名称已存在' };
  }
  return {
    category: {
      id,
      name,
      enabled: draft.enabled,
    },
  };
}

export function createQaTemplateDraft(current?: QATemplateConfig): QaTemplateDraft {
  return {
    id: current?.id ?? '',
    name: current?.name ?? '',
    desc: current?.desc ?? '',
    categoryId: current?.category_id ?? '',
    prompt: current?.prompt ?? '',
    icon: current?.icon ?? 'FileText',
    color: current?.color ?? '#2563eb',
    bg: current?.bg ?? '#eff6ff',
    enabled: current?.enabled ?? true,
    showOnHome: current?.show_on_home ?? false,
  };
}

export function validateQaTemplateDraft(
  draft: QaTemplateDraft,
  categories: QATemplateCategoryConfig[],
  templates: QATemplateConfig[] = [],
  currentId?: string,
): { template?: QATemplateConfig; error?: string } {
  const name = draft.name.trim();
  if (!name) return { error: '请输入模板名称' };
  const categoryId = draft.categoryId.trim();
  if (!categories.some((category) => category.id === categoryId)) return { error: '请选择有效分类' };
  const prompt = draft.prompt.trim();
  if (!prompt) return { error: '请输入提示词' };
  const icon = draft.icon.trim();
  if (!icon) return { error: '请输入图标名' };
  const color = draft.color.trim();
  if (!color) return { error: '请输入主色' };
  const bg = draft.bg.trim();
  if (!bg) return { error: '请输入背景色' };
  const id = (draft.id.trim() || buildStableId(name, 'template')).trim();
  if (templates.some((template) => template.id === id && template.id !== currentId)) {
    return { error: '模板 ID 已存在' };
  }
  return {
    template: {
      id,
      name,
      desc: draft.desc.trim(),
      category_id: categoryId,
      prompt,
      icon,
      color,
      bg,
      enabled: draft.enabled,
      show_on_home: draft.showOnHome,
    },
  };
}

export function canDeleteQaTemplateCategory(categoryId: string, templates: QATemplateConfig[]): boolean {
  return !templates.some((template) => template.category_id === categoryId);
}

function buildStableId(value: string, fallbackPrefix: string): string {
  const preset = ID_PRESETS[value.trim()];
  if (preset) return preset;
  const asciiSlug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (asciiSlug) return asciiSlug;
  const codeSlug = Array.from(value.trim())
    .map((char) => char.charCodeAt(0).toString(36))
    .join('-');
  return codeSlug ? `${fallbackPrefix}-${codeSlug}` : fallbackPrefix;
}
