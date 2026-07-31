import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ensureAuthSynced, useAuth } from '../hooks/useAuth';
import { triggerLoginRedirect } from '../utils/loginRedirect';

/**
 * 登录拦截：未登录用户跳转到登录页（携带 redirect 返回当前页）。
 * 因 user 来自 localStorage 快照,先等一次 /auth/me 校验完成再判定,
 * 避免误伤「有服务端 session 但本地未同步」的用户。
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const redirectedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void ensureAuthSynced().finally(() => {
      if (alive) setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (user || !checked || redirectedRef.current) return;
    redirectedRef.current = true;
    triggerLoginRedirect(`${location.pathname}${location.search}`);
  }, [user, checked, location.pathname, location.search]);

  if (user) return <>{children}</>;
  // 校验中或即将跳转登录页,不渲染受保护内容
  return null;
}
