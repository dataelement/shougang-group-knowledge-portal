import { useMemo, useRef, useState } from 'react';
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialLeft: 0,
    initialTop: 0,
    moved: false,
  });

  const visible = useMemo(() => {
    if (!user) return false;
    if (isHiddenPath(location.pathname)) return false;
    return isPortalPage(location.pathname);
  }, [location.pathname, user]);

  if (!visible || IS_EMBEDDED) return null;

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      isDragging: true,
      startX: event.clientX,
      startY: event.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
      moved: false,
    };
    setIsDragging(true);
    el.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const el = buttonRef.current;
    if (!drag.isDragging || !el) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;
    const maxLeft = window.innerWidth - el.offsetWidth;
    const maxTop = window.innerHeight - el.offsetHeight;
    const newLeft = Math.max(0, Math.min(maxLeft, drag.initialLeft + deltaX));
    const newTop = Math.max(0, Math.min(maxTop, drag.initialTop + deltaY));
    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const el = buttonRef.current;
    if (!el) return;
    dragRef.current.isDragging = false;
    setIsDragging(false);
    try {
      el.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (dragRef.current.moved) {
      event.preventDefault();
      dragRef.current.moved = false;
      return;
    }
    navigate('/apps?tab=qa');
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`${s.button} ${isDragging ? s.dragging : ''}`}
      aria-label="进入钢小智"
      title="钢小智"
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <span className={s.label}>钢小智</span>
      <img className={s.icon} src="/qa-floating-icon.png" alt="" aria-hidden="true" />
    </button>
  );
}
