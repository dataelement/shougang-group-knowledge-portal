import { buildUnifiedAuthStartUrl, fetchUnifiedAuthConfig, normalizePortalRedirect } from '../api/auth';

export type LoginRedirectOptions = {
  guest?: boolean;
};

export function buildLocalLoginPath(
  returnTo: string | null | undefined,
  options: LoginRedirectOptions = {},
): string {
  const params = new URLSearchParams();
  params.set('redirect', normalizePortalRedirect(returnTo));
  if (options.guest) params.set('guest', '1');
  return `/login?${params.toString()}`;
}

/** Direct unified-auth entry; prefer triggerLoginRedirect for UI actions. */
export function buildPortalLoginStartUrl(returnTo: string | null | undefined): string {
  return buildUnifiedAuthStartUrl(returnTo);
}

export function startPortalLogin(returnTo: string | null | undefined): void {
  window.location.assign(buildPortalLoginStartUrl(returnTo));
}

export async function redirectToLogin(
  returnTo: string | null | undefined,
  options: LoginRedirectOptions = {},
): Promise<void> {
  try {
    const config = await fetchUnifiedAuthConfig();
    if (config.enabled) {
      startPortalLogin(returnTo);
      return;
    }
  } catch {
    // Fall back to the local login page when unified auth config is unavailable.
  }
  window.location.assign(buildLocalLoginPath(returnTo, options));
}

export function triggerLoginRedirect(
  returnTo: string | null | undefined,
  options: LoginRedirectOptions = {},
): void {
  void redirectToLogin(returnTo, options);
}

export function normalizePortalReturnTo(returnTo: string | null | undefined): string {
  return normalizePortalRedirect(returnTo);
}
