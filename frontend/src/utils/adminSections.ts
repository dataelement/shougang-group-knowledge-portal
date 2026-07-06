import type { SectionConfig } from '../api/adminConfig';
import { DOMAIN_COLOR_OPTIONS } from './adminDomains';

export const SECTION_ICON_OPTIONS = [
  'Star',
  'AlertTriangle',
  'Tag',
  'TrendingUp',
  'FolderOpen',
  'LayoutGrid',
] as const;

export interface SectionDraft {
  title: string;
  tag: string;
  icon: string;
  builtinKey?: string;
  color: string;
  bg: string;
}

export const LATEST_SELECTED_SECTION_KEY = 'latest_selected';

const SECTION_COLOR_BY_ICON: Record<string, { color: string; bg: string }> = {
  Star: { color: '#2563eb', bg: '#eff6ff' },
  AlertTriangle: { color: '#dc2626', bg: '#fee2e2' },
  Tag: { color: '#059669', bg: '#d1fae5' },
  TrendingUp: { color: '#d97706', bg: '#fef3c7' },
  FolderOpen: { color: '#6366f1', bg: '#ede9fe' },
  LayoutGrid: { color: '#475569', bg: '#e2e8f0' },
};

export function resolveSectionVisual(section: Pick<SectionConfig, 'icon' | 'color' | 'bg'>) {
  const fallback = SECTION_COLOR_BY_ICON[section.icon] ?? {
    color: DOMAIN_COLOR_OPTIONS[0].color,
    bg: DOMAIN_COLOR_OPTIONS[0].bg,
  };

  return {
    color: section.color?.trim() || fallback.color,
    bg: section.bg?.trim() || fallback.bg,
  };
}

export function createSectionDraft(current?: SectionConfig): SectionDraft {
  const visual = current ? resolveSectionVisual(current) : {
    color: DOMAIN_COLOR_OPTIONS[0].color,
    bg: DOMAIN_COLOR_OPTIONS[0].bg,
  };
  return {
    title: current?.title ?? '',
    tag: current?.tag ?? '',
    icon: current?.icon ?? 'Star',
    builtinKey: current?.builtin_key,
    color: visual.color,
    bg: visual.bg,
  };
}

export function buildSectionLink(tag: string, builtinKey?: string): string {
  if (builtinKey === LATEST_SELECTED_SECTION_KEY) {
    return `/list?recommendation=${LATEST_SELECTED_SECTION_KEY}`;
  }
  return `/list?tag=${encodeURIComponent(tag.trim())}`;
}

export function validateSectionDraft(draft: SectionDraft): { section?: SectionConfig; error?: string } {
  const title = draft.title.trim();
  if (!title) return { error: '请输入分区标题' };

  const tag = draft.tag.trim();
  if (!tag) return { error: '请输入关联标签' };

  const icon = draft.icon.trim();
  if (!icon) return { error: '请选择分区图标' };

  const color = draft.color.trim();
  if (!color) return { error: '请选择分区颜色' };

  const bg = draft.bg.trim();
  if (!bg) return { error: '请选择分区颜色' };

  const section: SectionConfig = {
    title,
    tag,
    link: buildSectionLink(tag, draft.builtinKey),
    icon,
    color,
    bg,
    enabled: true,
  };
  if (draft.builtinKey) {
    section.builtin_key = draft.builtinKey;
  }

  return { section };
}
