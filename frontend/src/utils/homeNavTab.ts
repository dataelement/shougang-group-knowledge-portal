export type HomeNavTab = 'domain' | 'category';

export const DEFAULT_HOME_NAV_TAB: HomeNavTab = 'category';
export const HOME_NAV_RESET_EVENT = 'portal-home-nav-reset';

const STORAGE_KEY = 'sg_home_nav_tab';
const CARD_PATH_STORAGE_KEY = 'sg_home_nav_card_path';

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

export function rememberHomeNavCardPath(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(CARD_PATH_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage failures
  }
}

export function consumeHomeNavCardPath(): string | null {
  try {
    const stored = sessionStorage.getItem(CARD_PATH_STORAGE_KEY);
    sessionStorage.removeItem(CARD_PATH_STORAGE_KEY);
    if (!stored?.trim()) return null;
    return stored.trim();
  } catch {
    // ignore storage failures
  }
  return null;
}

export function clearHomeNavCardPath(): void {
  try {
    sessionStorage.removeItem(CARD_PATH_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function inferHomeNavCardPathFromPathname(pathname: string): string | null {
  if (pathname.startsWith('/domain/') || pathname.startsWith('/category/')) {
    return pathname;
  }
  return null;
}

export function scrollHomeNavCardIntoView(container: HTMLElement, path: string): boolean {
  const cards = container.querySelectorAll<HTMLElement>('[data-domain-path]');
  for (const card of cards) {
    if (card.dataset.domainPath === path) {
      card.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
      return true;
    }
  }
  return false;
}

export function dispatchHomeNavReset(): void {
  window.dispatchEvent(new CustomEvent(HOME_NAV_RESET_EVENT));
}
