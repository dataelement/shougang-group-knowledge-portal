import type { DomainConfig, SpaceConfig } from '../api/adminConfig';

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

export interface DomainDraft {
  name: string;
  spaceId: string;
  icon: string;
  backgroundImage: string;
  color: string;
  bg: string;
  enabled: boolean;
}

export function createDomainDraft(current?: DomainConfig): DomainDraft {
  return {
    name: current?.name ?? '',
    spaceId: current?.space_ids[0] === undefined ? '' : String(current.space_ids[0]),
    icon: current?.icon ?? 'Factory',
    backgroundImage: current?.background_image ?? '',
    color: current?.color ?? '#2563eb',
    bg: current?.bg ?? '#eff6ff',
    enabled: current?.enabled ?? true,
  };
}

export function validateDomainDraft(draft: DomainDraft, spaces: SpaceConfig[]): { domain?: DomainConfig; error?: string } {
  const name = draft.name.trim();
  if (!name) return { error: '请输入业务域名称' };

  const spaceIdRaw = draft.spaceId.trim();
  let spaceIds: number[] = [];
  if (spaceIdRaw) {
    const spaceId = Number(spaceIdRaw);
    if (!Number.isInteger(spaceId) || spaceId <= 0) return { error: '绑定空间格式有误' };
    if (!spaces.some((space) => space.id === spaceId)) return { error: '绑定空间不存在' };
    spaceIds = [spaceId];
  }

  const icon = draft.icon.trim();
  if (!icon) return { error: '请输入图标名' };

  const color = draft.color.trim();
  if (!color) return { error: '请输入主色值' };

  const bg = draft.bg.trim();
  if (!bg) return { error: '请输入背景色值' };

  return {
    domain: {
      name,
      space_ids: spaceIds,
      icon,
      background_image: draft.backgroundImage.trim(),
      color,
      bg,
      enabled: true,
    },
  };
}

export function isSelectedDomainColor(
  draft: Pick<DomainDraft, 'color' | 'bg'>,
  option: Pick<(typeof DOMAIN_COLOR_OPTIONS)[number], 'color' | 'bg'>,
): boolean {
  return draft.color === option.color && draft.bg === option.bg;
}
