import type { DeptBinding } from '../api/adminConfig';

export interface BindingDraft {
  spaceId: number | null;
  departmentId: number | null;
}

export function createBindingDraft(): BindingDraft {
  return { spaceId: null, departmentId: null };
}

export function validateBindingDraft(draft: BindingDraft): string | null {
  if (draft.spaceId == null) return '请选择要绑定的团队/科室知识库';
  if (draft.departmentId == null) return '请选择部门';
  return null;
}

export function groupBindingsByDepartment(bindings: DeptBinding[]): DeptBinding[] {
  return [...bindings].sort((a, b) =>
    (a.department_name || '').localeCompare(b.department_name || '', 'zh-Hans-CN'));
}
