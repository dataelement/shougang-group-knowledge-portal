import type { PortalUser } from '../api/auth';
import { buildLocalLoginPath } from './loginRedirect';

export type AdminAccessState = 'login' | 'forbidden' | 'allowed';

type AdminAccessUser = Partial<Pick<PortalUser, 'account' | 'role'>>;
type TagReviewAccessUser = Partial<Pick<PortalUser, 'isDepartmentAdmin'>>;

const ADMIN_ROLES = new Set(['管理员', '系统管理员', 'admin']);
const ADMIN_ACCOUNTS = new Set(['admin']);

function normalizeIdentity(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function isPortalAdmin(user: AdminAccessUser | null | undefined): boolean {
  const role = normalizeIdentity(user?.role);
  const account = normalizeIdentity(user?.account);
  return ADMIN_ROLES.has(role) || ADMIN_ACCOUNTS.has(account);
}

/**
 * Whether the user may open portal tag review.
 * Uses org department-admin flag from BiSheng department settings — not portal site admin / RBAC.
 */
export function canAccessTagReview(user: TagReviewAccessUser | null | undefined): boolean {
  return Boolean(user?.isDepartmentAdmin);
}

export function getAdminAccessState(user: AdminAccessUser | null | undefined): AdminAccessState {
  if (!user) return 'login';
  return isPortalAdmin(user) ? 'allowed' : 'forbidden';
}

export function buildAdminLoginRedirect(pathname: string, search = ''): string {
  return buildLocalLoginPath(`${pathname}${search}`);
}
