export type HomeNavTab = 'domain' | 'category';

export const DEFAULT_HOME_NAV_TAB: HomeNavTab = 'category';
export const HOME_NAV_RESET_EVENT = 'portal-home-nav-reset';

const STORAGE_KEY = 'sg_home_nav_tab';

export function rememberHomeNavTab(tab: HomeNavTab): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // ignore storage failures
  }
}

export function consumeHomeNavTab(): HomeNavTab | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    if (stored === 'domain' || stored === 'category') return stored;
  } catch {
    // ignore storage failures
  }
  return null;
}

export function inferHomeNavTabFromPath(pathname: string): HomeNavTab | null {
  if (pathname.startsWith('/domain/')) return 'domain';
  if (pathname.startsWith('/category/')) return 'category';
  return null;
}

export function dispatchHomeNavReset(): void {
  window.dispatchEvent(new CustomEvent(HOME_NAV_RESET_EVENT));
}
