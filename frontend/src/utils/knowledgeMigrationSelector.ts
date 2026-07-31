import type { MigrationSpace } from '../api/knowledgeMigration';

export type MigrationSpaceLevel =
  | 'public'
  | 'department'
  | 'team'
  | 'personal'
  | 'other';

interface MigrationSpaceLevelOption {
  value: MigrationSpaceLevel;
  label: string;
}

const LEVEL_OPTIONS: MigrationSpaceLevelOption[] = [
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队/科室知识库' },
  { value: 'personal', label: '个人知识库' },
  { value: 'other', label: '其他知识库' },
];

export function normalizeMigrationSpaceLevel(
  level: string | null | undefined,
): MigrationSpaceLevel {
  const normalized = (level || '').trim().toLowerCase();
  if (normalized === 'team_ks') return 'team';
  if (
    normalized === 'public'
    || normalized === 'department'
    || normalized === 'team'
    || normalized === 'personal'
  ) {
    return normalized;
  }
  return 'other';
}

export function getMigrationSpaceLevelOptions(
  spaces: MigrationSpace[],
): MigrationSpaceLevelOption[] {
  const present = new Set(
    spaces.map((space) => normalizeMigrationSpaceLevel(space.level)),
  );
  return LEVEL_OPTIONS.filter((option) => present.has(option.value));
}

export function filterMigrationSpacesByLevel(
  spaces: MigrationSpace[],
  level: MigrationSpaceLevel | '',
): MigrationSpace[] {
  if (!level) return [];
  return spaces
    .filter((space) => normalizeMigrationSpaceLevel(space.level) === level)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'zh-CN')
        || left.id - right.id,
    );
}
