import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import s from './FloatingQaButton.module.css';

// 嵌入 iframe(如文件预览详情弹窗内的 embed=1 页面)时,不渲染悬浮按钮
const IS_EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;

const PORTAL_PAGE_PREFIXES = [
  '/',
  '/domains',
  '/domain/',
  '/search',
  '/space/',
  '/list',
  '/knowledge-spaces',
  '/expert-qa',
  '/wiki',
  '/course',
  '/apps',
];

const HIDDEN_PAGE_PREFIXES = [
  '/login',
  '/share/document',
  '/qa',
  '/portal/qa',
  '/admin',
  '/bootstrap/bisheng',
];

function isHiddenPath(pathname: string): boolean {
  return HIDDEN_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPortalPage(pathname: string): boolean {
  if (pathname === '/') return true;
  return PORTAL_PAGE_PREFIXES.some((prefix) => prefix !== '/' && pathname.startsWith(prefix));
}

export default function FloatingQaButton() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const visible = useMemo(() => {
    if (!user) return false;
    if (isHiddenPath(location.pathname)) return false;
    return isPortalPage(location.pathname);
  }, [location.pathname, user]);

  if (!visible || IS_EMBEDDED) return null;

  return (
    <button
      type="button"
      className={s.button}
      aria-label="进入钢小智"
      title="钢小智"
      onClick={() => navigate('/apps?tab=qa')}
    >
      <span className={s.label}>钢小智</span>
      <img className={s.icon} src="/qa-floating-icon.png" alt="" aria-hidden="true" />
    </button>
  );
}
