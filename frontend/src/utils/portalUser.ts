import type { PortalUser } from '../api/auth';

/** 比较会影响门户身份与权限的稳定字段，忽略每次会话恢复都会变化的 loginAt。 */
export function arePortalUsersEquivalent(a: PortalUser | null, b: PortalUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.account === b.account
    && a.name === b.name
    && a.initial === b.initial
    && a.role === b.role
    && a.departmentName === b.departmentName
    && a.externalId === b.externalId
    && a.authSource === b.authSource
    && a.isDepartmentAdmin === b.isDepartmentAdmin
  );
}
