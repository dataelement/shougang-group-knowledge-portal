export const GUEST_NOTICE_TEXT = '您当前为访客身份，仅可查阅公共库内容，内部资料无访问权限';

/** Build the /login path for a guest who hit a gated action, carrying the return path + a flag so the login page can toast the notice. */
export function buildGuestLoginPath(returnTo: string): string {
  const params = new URLSearchParams();
  params.set('redirect', returnTo);
  params.set('guest', '1');
  return `/login?${params.toString()}`;
}
