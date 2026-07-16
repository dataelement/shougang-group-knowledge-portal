import type { DepartmentBusinessDomainBinding, DepartmentOption } from '../api/adminConfig';

export type FlatDepartment = {
  id: number;
  label: string;
};

export function normalizeBusinessDomainCode(value: string): string {
  return value.trim().toUpperCase();
}

export function flattenDepartmentOptions(items: DepartmentOption[], depth = 0): FlatDepartment[] {
  return items.flatMap((item) => [
    { id: item.id, label: '　'.repeat(depth) + item.name },
    ...flattenDepartmentOptions(item.children ?? [], depth + 1),
  ]);
}

export function normalizeDepartmentBusinessDomainBindings(
  bindings: DepartmentBusinessDomainBinding[],
): DepartmentBusinessDomainBinding[] {
  return bindings
    .map((binding) => ({
      department_id: Number(binding.department_id),
      business_domain_codes: [...new Set(
        binding.business_domain_codes.map(normalizeBusinessDomainCode).filter(Boolean),
      )].sort(),
    }))
    .filter((binding) => Number.isInteger(binding.department_id) && binding.department_id > 0)
    .sort((left, right) => left.department_id - right.department_id);
}

export function validateDepartmentBusinessDomainBindings(
  bindings: DepartmentBusinessDomainBinding[],
  validDomainCodes: string[],
): string {
  const validCodes = new Set(validDomainCodes.map(normalizeBusinessDomainCode).filter(Boolean));
  const departments = new Set<number>();
  for (const binding of bindings) {
    if (!Number.isInteger(binding.department_id) || binding.department_id <= 0) {
      return '请为每一行选择一个部门。';
    }
    if (departments.has(binding.department_id)) {
      return '同一部门只能配置一次，请合并重复行。';
    }
    departments.add(binding.department_id);
    if (binding.business_domain_codes.length === 0) {
      return '请为每个部门至少选择一个业务域。';
    }
    if (binding.business_domain_codes.some((code) => !validCodes.has(normalizeBusinessDomainCode(code)))) {
      return '绑定中包含不存在或已停用的业务域，请重新选择。';
    }
  }
  return '';
}
