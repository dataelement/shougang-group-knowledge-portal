export const PORTAL_AUTH_NOTICE_PARAM = 'portal_auth_notice';
export const PORTAL_AUTH_NOTICE_USER_UNREGISTERED = 'user_unregistered';

export const PORTAL_AUTH_NOTICE_MESSAGES: Record<string, string> = {
  [PORTAL_AUTH_NOTICE_USER_UNREGISTERED]: '您未在本系统注册，请联系管理员',
};

export function getPortalAuthNoticeMessage(code: string | null | undefined): string {
  if (!code) return '';
  return PORTAL_AUTH_NOTICE_MESSAGES[code] || '';
}

export function stripPortalAuthNoticeFromSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete(PORTAL_AUTH_NOTICE_PARAM);
  const next = params.toString();
  return next ? `?${next}` : '';
}
