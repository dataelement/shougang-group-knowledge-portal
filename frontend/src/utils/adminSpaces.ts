import type { DomainConfig, QAConfig, SpaceConfig, SpaceOption } from '../api/adminConfig';

export type SpaceBindingState = 'new' | 'enabled' | 'disabled';

export interface SpaceUsage {
  domainNames: string[];
  usedInQa: boolean;
}

export function getSpaceBindingState(spaces: SpaceConfig[], option: SpaceOption): SpaceBindingState {
  const existing = spaces.find((space) => space.id === option.id);
  if (!existing) return 'new';
  return existing.enabled ? 'enabled' : 'disabled';
}

export function getSpaceUsage(spaceId: number, domains: DomainConfig[], qa: QAConfig): SpaceUsage {
  return {
    domainNames: domains
      .filter((domain) => domain.space_ids.includes(spaceId))
      .map((domain) => domain.name),
    usedInQa: qa.knowledge_space_ids.includes(spaceId),
  };
}

export function canDeleteSpace(usage: SpaceUsage): boolean {
  return usage.domainNames.length === 0 && !usage.usedInQa;
}

export function getSpaceUsageSummary(usage: SpaceUsage): string {
  const labels: string[] = [];
  if (usage.domainNames.length) {
    labels.push(`业务域：${usage.domainNames.join('、')}`);
  }
  if (usage.usedInQa) {
    labels.push('问答范围');
  }
  return labels.length ? labels.join(' / ') : '未被其它配置引用';
}

export function upsertSpace(spaces: SpaceConfig[], option: SpaceOption): SpaceConfig[] {
  const existingIndex = spaces.findIndex((space) => space.id === option.id);
  if (existingIndex === -1) {
    return [
      ...spaces,
      {
        id: option.id,
        name: option.name,
        tag_count: 0,
        file_count: option.file_count,
        space_level: option.space_level ?? 'personal',
        enabled: true,
      },
    ];
  }

  return spaces.map((space, index) => (index === existingIndex ? {
    ...space,
    name: option.name,
    file_count: option.file_count,
    space_level: option.space_level ?? space.space_level ?? 'personal',
    enabled: true,
  } : space));
}

export function setSpaceEnabled(spaces: SpaceConfig[], index: number, enabled: boolean): SpaceConfig[] {
  return spaces.map((space, currentIndex) => (currentIndex === index ? {
    ...space,
    enabled,
  } : space));
}
