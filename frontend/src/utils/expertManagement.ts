import type {
  ExpertListOptions,
  ExpertProfileResponse,
  ExpertSortField,
  ExpertSortOrder,
} from '../api/expertQa';

type ExpertContribution = Pick<
  ExpertProfileResponse,
  'answer_count' | 'adoption_count' | 'vote_count'
>;

export interface ExpertSortState {
  field: ExpertSortField;
  order: ExpertSortOrder;
}

export function calculateExpertScore(expert: ExpertContribution): number {
  return (
    Number(expert.answer_count || 0)
    + Number(expert.adoption_count || 0) * 5
    + Number(expert.vote_count || 0) * 2
  );
}

function normalizeFilterValue(value: string | number | null | undefined): string {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}

function compareText(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number {
  const normalizedLeft = normalizeFilterValue(left);
  const normalizedRight = normalizeFilterValue(right);

  if (!normalizedLeft && normalizedRight) return 1;
  if (normalizedLeft && !normalizedRight) return -1;
  return normalizedLeft.localeCompare(normalizedRight, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function compareExpertField(
  left: ExpertProfileResponse,
  right: ExpertProfileResponse,
  field: ExpertSortField,
): number {
  switch (field) {
    case 'expert_score':
      return calculateExpertScore(left) - calculateExpertScore(right);
    case 'department':
      return compareText(left.depart_ment, right.depart_ment);
    case 'created_at':
      return (
        (Date.parse(left.created_at) || 0)
        - (Date.parse(right.created_at) || 0)
      );
    case 'expert_name':
    case 'job_family':
    case 'job_category':
    case 'position':
    case 'major':
      return compareText(left[field], right[field]);
    default:
      return 0;
  }
}

/**
 * 兼容尚未实现职业字段筛选与排序的旧版首钢后端。
 * 搜索仍交给接口完成；这里对接口返回的候选集做精确筛选和稳定排序。
 */
export function applyExpertListOptions(
  experts: ExpertProfileResponse[],
  options: ExpertListOptions,
): ExpertProfileResponse[] {
  const filtered = experts.filter((expert) => (
    (!options.departmentId
      || normalizeFilterValue(expert.department_id) === normalizeFilterValue(options.departmentId))
    && (!options.jobFamily
      || normalizeFilterValue(expert.job_family) === normalizeFilterValue(options.jobFamily))
    && (!options.jobCategory
      || normalizeFilterValue(expert.job_category) === normalizeFilterValue(options.jobCategory))
    && (!options.position
      || normalizeFilterValue(expert.position) === normalizeFilterValue(options.position))
    && (!options.major
      || normalizeFilterValue(expert.major) === normalizeFilterValue(options.major))
  ));

  if (!options.sortBy) return filtered;

  const direction = options.sortOrder === 'asc' ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const comparison = compareExpertField(left, right, options.sortBy!);
    if (comparison !== 0) return comparison * direction;
    return compareText(left.expert_name, right.expert_name);
  });
}

export function getNextExpertSort(
  current: ExpertSortState,
  field: ExpertSortField,
): ExpertSortState {
  if (current.field !== field) {
    return { field, order: 'asc' };
  }
  return {
    field,
    order: current.order === 'asc' ? 'desc' : 'asc',
  };
}
