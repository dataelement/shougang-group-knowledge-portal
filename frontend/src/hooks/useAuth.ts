import { useCallback, useEffect, useState } from 'react';

import { buildPortalLogoutStartUrl, fetchPortalMe, type PortalUser } from '../api/auth';
import { ApiRequestError } from '../api/content';

export type { PortalUser };

const STORAGE_KEY = 'sg_portal_user';

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

export function savePortalUser(user: PortalUser) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearPortalUser() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function useAuth() {
  const [user, setUser] = useState<PortalUser | null>(() => readStoredUser());

  useEffect(() => {
    function syncFromStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      setUser(readStoredUser());
    }
    window.addEventListener('storage', syncFromStorage);
    return () => window.removeEventListener('storage', syncFromStorage);
  }, []);

  // localStorage 是前端登录态，BFF 重启 / session 过期 / cookie 丢失会让它和后端脱钩。
  // 挂载时始终拉一次 /auth/me：后端可用门户 session 或 Bisheng cookie 恢复用户态。
  useEffect(() => {
    let active = true;
    void fetchPortalMe()
      .then((next) => {
        if (!active) return;
        savePortalUser(next);
        setUser(next);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          clearPortalUser();
          setUser(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback((next: PortalUser) => {
    savePortalUser(next);
    setUser(next);
  }, []);

  const logout = useCallback(() => {
    clearPortalUser();
    setUser(null);
    window.location.assign(buildPortalLogoutStartUrl());
  }, []);

  return { user, login, logout };
}
