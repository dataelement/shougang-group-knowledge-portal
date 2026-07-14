import type { DepartmentOption, DeptBinding } from '../api/adminConfig';

export interface BindingDraft {
  spaceId: number | null;
  departmentId: number | null;
}

export function createBindingDraft(): BindingDraft {
  return { spaceId: null, departmentId: null };
}

export function validateBindingDraft(draft: BindingDraft): string | null {
  if (draft.spaceId == null) return '请选择要绑定的团队知识库';
  if (draft.departmentId == null) return '请选择部门';
  return null;
}

export function groupBindingsByDepartment(bindings: DeptBinding[]): DeptBinding[] {
  return [...bindings].sort((a, b) =>
    (a.department_name || '').localeCompare(b.department_name || '', 'zh-Hans-CN'));
}

export function findDepartmentOption(
  departments: DepartmentOption[],
  departmentId: number | null,
): DepartmentOption | undefined {
  for (const department of departments) {
    if (department.id === departmentId) return department;
    const matched = findDepartmentOption(department.children, departmentId);
    if (matched) return matched;
  }
  return undefined;
}

/** 搜索时保留命中部门及其祖先节点，保证树形层级可读。 */
export function filterDepartmentOptions(
  departments: DepartmentOption[],
  keyword: string,
): DepartmentOption[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase('zh-Hans-CN');
  if (!normalizedKeyword) return departments;

  return departments.flatMap((department) => {
    const children = filterDepartmentOptions(department.children, normalizedKeyword);
    const matched = department.name.toLocaleLowerCase('zh-Hans-CN').includes(normalizedKeyword);
    return matched || children.length ? [{ ...department, children }] : [];
  });
}
