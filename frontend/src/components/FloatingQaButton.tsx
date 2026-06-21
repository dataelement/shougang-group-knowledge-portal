import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import s from './FloatingQaButton.module.css';

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

  if (!visible) return null;

  return (
    <button
      type="button"
      className={s.button}
      aria-label="进入智能问答"
      title="智能问答"
      onClick={() => navigate('/qa')}
    >
      <img className={s.icon} src="/qa-floating-icon.png" alt="" aria-hidden="true" />
    </button>
  );
}
