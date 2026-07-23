import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { buildPortalLogoutStartUrl, fetchPortalMe, loadPortalAuthSource, logoutPortal, type PortalUser } from '../api/auth';
import { ApiRequestError, invalidatePortalContentConfigCache } from '../api/content';
import { invalidatePortalConfigStore } from './usePortalConfig';

export type { PortalUser };

const STORAGE_KEY = 'sg_portal_user';
const PORTAL_USER_CHANGED_EVENT = 'sg_portal_user_changed';
export const PORTAL_LOGOUT_IN_PROGRESS_KEY = 'sg_portal_logging_out';
const PORTAL_AUTH_RECOVERY_SUPPRESS_UNTIL_KEY = 'sg_portal_auth_recovery_suppress_until';
const AUTH_RECOVERY_SUPPRESS_MS = 5 * 60 * 1000;

export function markPortalLogoutInProgress(): void {
  try {
    sessionStorage.setItem(PORTAL_LOGOUT_IN_PROGRESS_KEY, '1');
    sessionStorage.setItem(
      PORTAL_AUTH_RECOVERY_SUPPRESS_UNTIL_KEY,
      String(Date.now() + AUTH_RECOVERY_SUPPRESS_MS),
    );
  } catch {
    // ignore session storage errors
  }
}

export function isPortalLogoutInProgress(): boolean {
  return shouldSuppressAuthRecovery();
}

export function shouldSuppressAuthRecovery(): boolean {
  try {
    if (sessionStorage.getItem(PORTAL_LOGOUT_IN_PROGRESS_KEY) === '1') {
      return true;
    }
    const until = Number(sessionStorage.getItem(PORTAL_AUTH_RECOVERY_SUPPRESS_UNTIL_KEY) || '0');
    return until > Date.now();
  } catch {
    return false;
  }
}

export function clearPortalLogoutInProgress(): void {
  clearAuthRecoverySuppress();
}

export function clearAuthRecoverySuppress(): void {
  try {
    sessionStorage.removeItem(PORTAL_LOGOUT_IN_PROGRESS_KEY);
    sessionStorage.removeItem(PORTAL_AUTH_RECOVERY_SUPPRESS_UNTIL_KEY);
  } catch {
    // ignore session storage errors
  }
}

function readStoredUser(): PortalUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortalUser;
  } catch {
    return null;
  }
}

export function loadPortalUser(): PortalUser | null {
  return readStoredUser();
}

// 全局单例用户态：所有 useAuth() 消费者共享同一份 currentUser + 同一组 window 监听。
// 目的是消除“每个组件各自拉一次 /auth/me + 各自持有会抖动的 user 引用”导致的重复请求风暴。
let currentUser: PortalUser | null = readStoredUser();
const listeners = new Set<() => void>();

function usersEqual(a: PortalUser | null, b: PortalUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// 只有当用户数据真正变化时才替换引用；否则保持引用稳定，
// 避免 readStoredUser() 每次 JSON.parse 产生新对象，令 [user] 依赖的 effect 无谓重跑。
function setCurrentUser(next: PortalUser | null) {
  if (usersEqual(currentUser, next)) return;
  currentUser = next;
  for (const listener of listeners) listener();
}

function handleUserChanged() {
  setCurrentUser(readStoredUser());
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  handleUserChanged();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // window 监听在“首个订阅者接入 / 最后一个订阅者离开”时统一装卸，全局仅注册一份。
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
    window.addEventListener(PORTAL_USER_CHANGED_EVENT, handleUserChanged);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(PORTAL_USER_CHANGED_EVENT, handleUserChanged);
    }
  };
}

function getSnapshot(): PortalUser | null {
  return currentUser;
}

export function savePortalUser(user: PortalUser) {
  const userChanged = !usersEqual(currentUser, user);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  if (!userChanged) return;
  invalidatePortalContentConfigCache();
  setCurrentUser(user);
  window.dispatchEvent(new Event(PORTAL_USER_CHANGED_EVENT));
  invalidatePortalConfigStore();
}

export function clearPortalUser() {
  invalidatePortalContentConfigCache();
  window.localStorage.removeItem(STORAGE_KEY);
  setCurrentUser(null);
  window.dispatchEvent(new Event(PORTAL_USER_CHANGED_EVENT));
  invalidatePortalConfigStore();
}

// 单飞 /auth/me：同一批组件挂载时共享同一个在途请求，只发一次；
// 请求结束后释放，SPA 内再次进入相关页面时仍可重新校验登录态。
// localStorage 是前端登录态，BFF 重启 / session 过期 / cookie 丢失会让它和后端脱钩，
// 因此挂载时始终校验一次：后端可用门户 session 或 Bisheng cookie 恢复用户态。
let mePromise: Promise<void> | null = null;

function ensureAuthSynced(): Promise<void> {
  if (typeof window !== 'undefined') {
    if (shouldSuppressAuthRecovery()) {
      return Promise.resolve();
    }
    if (window.location.pathname === '/login') {
      return Promise.resolve();
    }
  }
  if (mePromise) return mePromise;
  mePromise = fetchPortalMe()
    .then((next) => {
      savePortalUser(next);
    })
    .catch((err: unknown) => {
      if (err instanceof ApiRequestError && err.status === 401) {
        clearPortalUser();
      }
    })
    .finally(() => {
      mePromise = null;
    });
  return mePromise;
}

export function useAuth() {
  const user = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensureAuthSynced();
  }, []);

  const login = useCallback((next: PortalUser) => {
    savePortalUser(next);
  }, []);

  const logout = useCallback(() => {
    markPortalLogoutInProgress();
    const authSource = loadPortalAuthSource();
    clearPortalUser();
    if (authSource === 'unified_auth') {
      window.location.assign(buildPortalLogoutStartUrl());
      return;
    }
    void logoutPortal().finally(() => {
      window.location.assign('/login?logged_out=1');
    });
  }, []);

  return { user, login, logout };
}
