import type { DomainConfig, SpaceOption } from '../api/adminConfig';

export const DOMAIN_ICON_OPTIONS = [
  'Settings',
  'Factory',
  'Snowflake',
  'Zap',
  'Shield',
  'CheckCircle',
  'Leaf',
  'Truck',
  'Network',
  'Wrench',
  'GraduationCap',
] as const;

export const DOMAIN_COLOR_OPTIONS = [
  { label: '工业蓝', color: '#2563eb', bg: '#eff6ff' },
  { label: '生产绿', color: '#059669', bg: '#d1fae5' },
  { label: '冷轧紫', color: '#6366f1', bg: '#ede9fe' },
  { label: '能源橙', color: '#d97706', bg: '#fef3c7' },
  { label: '安全红', color: '#dc2626', bg: '#fee2e2' },
  { label: '设备灰', color: '#475569', bg: '#e2e8f0' },
] as const;

export const DOMAIN_BINDABLE_SPACE_GROUPS = [
  { level: 'public', label: '公共空间' },
  { level: 'department', label: '部门空间' },
] as const;

export interface DomainCodeOption {
  code: string;
  label: string;
}

export interface DomainDraft {
  name: string;
  spaceIds: string[];
  icon: string;
  backgroundImage: string;
  color: string;
  bg: string;
  enabled: boolean;
  code: string;
}

export function createDomainDraft(current?: DomainConfig): DomainDraft {
  return {
    name: current?.name ?? '',
    spaceIds: (current?.space_ids ?? []).map((spaceId) => String(spaceId)),
    icon: current?.icon ?? 'Factory',
    backgroundImage: current?.background_image ?? '',
    color: current?.color ?? '#2563eb',
    bg: current?.bg ?? '#eff6ff',
    enabled: current?.enabled ?? true,
    code: current?.code ?? '',
  };
}

export function buildDomainCodeOptions(domains: DomainConfig[]): DomainCodeOption[] {
  const options: DomainCodeOption[] = [];
  domains.forEach((domain) => {
    const code = domain.code.trim().toUpperCase();
    if (!code) return;
    options.push({ code, label: domain.name });
  });
  return options;
}

export function validateDomainDraft(draft: DomainDraft, spaces: SpaceOption[]): { domain?: DomainConfig; error?: string } {
  const name = draft.name.trim();
  if (!name) return { error: '请输入业务域名称' };

  let spaceIds: number[] = [];
  for (const spaceIdRaw of draft.spaceIds) {
    if (!spaceIdRaw.trim()) continue;
    const spaceId = Number(spaceIdRaw);
    if (!Number.isInteger(spaceId) || spaceId <= 0) return { error: '绑定空间格式有误' };
    const boundSpace = spaces.find((space) => space.id === spaceId);
    if (!boundSpace) return { error: '绑定空间不存在' };
    if (!isDomainBindableSpace(boundSpace)) {
      return { error: '绑定空间必须是公共或部门知识空间' };
    }
    if (!spaceIds.includes(spaceId)) spaceIds.push(spaceId);
  }

  const icon = draft.icon.trim();
  if (!icon) return { error: '请输入图标名' };

  const color = draft.color.trim();
  if (!color) return { error: '请输入主色值' };

  const bg = draft.bg.trim();
  if (!bg) return { error: '请输入背景色值' };

  const code = draft.code.trim().toUpperCase();

  return {
    domain: {
      name,
      space_ids: spaceIds,
      icon,
      background_image: draft.backgroundImage.trim(),
      color,
      bg,
      enabled: true,
      code,
    },
  };
}

export function isSelectedDomainColor(
  draft: Pick<DomainDraft, 'color' | 'bg'>,
  option: Pick<(typeof DOMAIN_COLOR_OPTIONS)[number], 'color' | 'bg'>,
): boolean {
  return draft.color === option.color && draft.bg === option.bg;
}

export function getDomainBindableSpaceGroups(spaces: SpaceOption[]) {
  return DOMAIN_BINDABLE_SPACE_GROUPS.map((group) => ({
    ...group,
    options: spaces.filter((space) => normalizeSpaceLevel(space) === group.level),
  }));
}

function isDomainBindableSpace(space: SpaceOption): boolean {
  return DOMAIN_BINDABLE_SPACE_GROUPS.some((group) => group.level === normalizeSpaceLevel(space));
}

function normalizeSpaceLevel(space: SpaceOption): string {
  return (space.space_level ?? '').trim().toLowerCase();
}
