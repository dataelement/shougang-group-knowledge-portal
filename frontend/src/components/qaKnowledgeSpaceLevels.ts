/** Space-level tabs for the portal QA knowledge picker (under「按知识库」). */

export type QaSpaceLevelTab = 'public' | 'department' | 'team' | 'personal';

export const QA_SPACE_LEVEL_ORDER: readonly QaSpaceLevelTab[] = [
  'public',
  'department',
  'team',
  'personal',
] as const;

export const QA_SPACE_LEVEL_LABELS: Record<QaSpaceLevelTab, string> = {
  public: '公共知识库',
  department: '部门知识库',
  team: '团队知识库',
  personal: '个人知识库',
};

/** True when value is one of the four picker tabs (excludes other/unknown). */
export function isQaSpaceLevelTab(value: string): value is QaSpaceLevelTab {
  return (QA_SPACE_LEVEL_ORDER as readonly string[]).includes(value);
}

/**
 * Default tab: first level in order that has at least one space.
 * Empty or only-other spaces → public.
 */
export function pickDefaultSpaceLevel(
  spaces: Array<{ spaceLevel?: string | null }>,
): QaSpaceLevelTab {
  for (const level of QA_SPACE_LEVEL_ORDER) {
    if (spaces.some((space) => space.spaceLevel === level)) {
      return level;
    }
  }
  return 'public';
}

/** Spaces belonging to the active tab; other/unknown levels never match. */
export function filterSpacesByLevel<T extends { spaceLevel?: string | null }>(
  spaces: T[],
  level: QaSpaceLevelTab,
): T[] {
  return spaces.filter((space) => space.spaceLevel === level);
}
