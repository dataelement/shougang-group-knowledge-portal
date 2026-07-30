import type { PortalUser } from '../api/auth';
import { buildLocalLoginPath } from './loginRedirect';

export type AdminAccessState = 'login' | 'forbidden' | 'allowed';

type AdminAccessUser = Partial<Pick<PortalUser, 'account' | 'role'>>;

const ADMIN_ROLES = new Set(['管理员', '系统管理员', 'admin']);
const ADMIN_ACCOUNTS = new Set(['admin']);
const SYSTEM_ADMIN_ROLES = new Set(['系统管理员', 'admin']);

function normalizeIdentity(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function isPortalAdmin(user: AdminAccessUser | null | undefined): boolean {
  const role = normalizeIdentity(user?.role);
  const account = normalizeIdentity(user?.account);
  return ADMIN_ROLES.has(role) || ADMIN_ACCOUNTS.has(account);
}

export function getAdminAccessState(user: AdminAccessUser | null | undefined): AdminAccessState {
  if (!user) return 'login';
  return isPortalAdmin(user) ? 'allowed' : 'forbidden';
}

export function isSystemAdministrator(
  user: AdminAccessUser | null | undefined,
): boolean {
  return SYSTEM_ADMIN_ROLES.has(normalizeIdentity(user?.role));
}

export function getSystemAdministratorAccessState(
  user: AdminAccessUser | null | undefined,
): AdminAccessState {
  if (!user) return 'login';
  return isSystemAdministrator(user) ? 'allowed' : 'forbidden';
}

export function buildAdminLoginRedirect(pathname: string, search = ''): string {
  return buildLocalLoginPath(`${pathname}${search}`);
}
