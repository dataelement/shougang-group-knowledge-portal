import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogIn,
  LogOut,
  Send,
  Upload,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useNotificationSummary } from '../hooks/useNotificationSummary';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { isPortalAdmin } from '../utils/adminAccess';
import { buildGuestLoginPath } from '../utils/guestAccess';
import {
  PORTAL_APPROVAL_EVENT,
  postPortalApprovalMessageToFrame,
  type PortalApprovalAction,
} from '../utils/portalApprovalBridge';
import adminIcon from '../assets/admin-icon.svg';
import s from './Header.module.css';

type HeaderNavItem =
  | { label: string; to: string; placeholder?: false; requiresAuth?: boolean }
  | { label: string; placeholder: true };

const NAV_ITEMS: HeaderNavItem[] = [
  { label: '首页', to: '/' },
  { label: '知识库', to: '/knowledge-spaces', requiresAuth: true },
  { label: '专家问答', to: '/expert-qa', requiresAuth: true },
  { label: '智能应用', to: '/apps', requiresAuth: true },
];

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const badges = useNotificationSummary(Boolean(user));
  const { config } = usePortalConfig();
  const bishengAdminUrl = config?.integrations?.bisheng_admin_entry_url?.trim() || '';
  const headerBrandName = config?.site?.header_brand_name?.trim() || '首钢股份知库';
  const headerLogoUrl = config?.site?.header_logo_url?.trim() || '/site-logo-new.png';
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuKey === location.pathname;
  const [msgKey, setMsgKey] = useState<string | null>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const msgOpen = msgKey === location.pathname;

  // Never render the portal header when loaded inside an iframe.
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  useEffect(() => {
    if (!menuOpen) return;
    function handleAway(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuKey(null);
    }
    document.addEventListener('mousedown', handleAway);
    return () => document.removeEventListener('mousedown', handleAway);
  }, [menuOpen]);

  useEffect(() => {
    if (!msgOpen) return;
    function handleAway(event: MouseEvent) {
      if (!msgRef.current) return;
      if (msgRef.current.contains(event.target as Node)) return;
      setMsgKey(null);
    }
    document.addEventListener('mousedown', handleAway);
    return () => document.removeEventListener('mousedown', handleAway);
  }, [msgOpen]);

  const closeMenu = useMemo(() => () => setMenuKey(null), []);

  const initial = user ? (user.initial || user.name.slice(0, 1)) : '';
  const externalId = user?.externalId?.trim() || user?.account || '';
  const canOpenAdmin = Boolean(bishengAdminUrl && isPortalAdmin(user));
  const showMyUploadsEntry = location.pathname === '/knowledge-spaces';

  const goLogin = () => {
    const redirect = `${location.pathname}${location.search}`;
    navigate(`/login?redirect=${encodeURIComponent(redirect)}`);
  };

  const openPortalApprovalAction = (action: PortalApprovalAction) => {
    closeMenu();
    setMsgKey(null);
    // The global ApprovalDialogHost listens for this event and opens the
    // BiSheng dialog as an overlay on whatever page the user is on, so we no
    // longer navigate to the knowledge workbench.
    window.dispatchEvent(new CustomEvent(PORTAL_APPROVAL_EVENT, { detail: { action } }));
  };

  const openMyUploads = () => {
    closeMenu();
    const knowledgeFrame = document.getElementById('bisheng-knowledge-frame') as HTMLIFrameElement | null;
    postPortalApprovalMessageToFrame(knowledgeFrame, 'my_uploads');
  };

  if (isInIframe) return null;

  return (
    <header className={s.header}>
      <div className={s.inner}>
        <div className={s.logo} onClick={() => navigate('/')}>
          <img
            className={s.logoImage}
            src={headerLogoUrl}
            alt={headerBrandName}
          />
          <span>{headerBrandName}</span>
        </div>

        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => (
            item.placeholder ? (
              <button
                key={item.label}
                type="button"
                className={s.navLink}
                aria-disabled="true"
              >
                {item.label}
              </button>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `${s.navLink} ${isActive ? s.navLinkActive : ''}`
                }
                onClick={(event) => {
                  if (item.requiresAuth && !user) {
                    event.preventDefault();
                    navigate(buildGuestLoginPath(item.to));
                  }
                }}
              >
                {item.label}
              </NavLink>
            )
          ))}
        </nav>

        <div className={s.spacer} />

        {user ? (
          <div className={s.userArea}>
            {/* 消息中心:待办 / 申请 / 消息 */}
            <div className={s.msgWrap} ref={msgRef}>
              <button
                type="button"
                className={s.msgTrigger}
                aria-haspopup="menu"
                aria-expanded={msgOpen}
                aria-label="消息中心"
                onClick={() => setMsgKey((current) => (current === location.pathname ? null : location.pathname))}
              >
                <Bell size={18} />
                {badges.total > 0 ? (
                  <span className={s.triggerDot} aria-label={`有 ${badges.total} 条新消息`} />
                ) : null}
              </button>
              {msgOpen ? (
                <div className={`${s.userMenu} ${s.msgMenu}`} role="menu">
                  <button
                    type="button"
                    className={s.userMenuItem}
                    onClick={() => openPortalApprovalAction('tasks')}
                  >
                    <ClipboardList size={15} />
                    待办
                    {badges.todo > 0 ? (
                      <span className={s.menuBadge}>{formatBadgeCount(badges.todo)}</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={s.userMenuItem}
                    onClick={() => openPortalApprovalAction('requests')}
                  >
                    <Send size={15} />
                    申请
                  </button>
                  <button
                    type="button"
                    className={s.userMenuItem}
                    onClick={() => openPortalApprovalAction('notifications')}
                  >
                    <Bell size={15} />
                    消息
                    {badges.messages > 0 ? (
                      <span className={s.menuBadge}>{formatBadgeCount(badges.messages)}</span>
                    ) : null}
                  </button>
                </div>
              ) : null}
            </div>

            {/* 用户名下拉 */}
            <div className={s.userMenuWrap} ref={menuRef}>
              <button
                type="button"
                className={s.userTrigger}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuKey((current) => (current === location.pathname ? null : location.pathname))}
              >
                <img src={adminIcon} alt="" className={s.userTriggerIcon} />
                <span className={s.userTriggerName}>{user.name}</span>
                <ChevronDown size={12} className={s.userTriggerCaret} />
              </button>
              {menuOpen ? (
                <div className={s.userMenu} role="menu">
                  <div className={s.userMenuHead}>
                    <div className={s.userMenuAvatar}>{initial}</div>
                    <div>
                      <div className={s.userMenuName}>{user.name}</div>
                      {externalId ? (
                        <div className={s.userMenuRole}>工号 {externalId}</div>
                      ) : null}
                    </div>
                  </div>
                  {canOpenAdmin ? (
                    <button
                      type="button"
                      className={s.userMenuItem}
                      onClick={() => {
                        closeMenu();
                        window.open(bishengAdminUrl, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <LayoutDashboard size={15} />
                      知识管理后台
                    </button>
                  ) : null}
                  {showMyUploadsEntry ? (
                    <button
                      type="button"
                      className={s.userMenuItem}
                      onClick={openMyUploads}
                    >
                      <Upload size={15} />
                      我的上传
                    </button>
                  ) : null}
                  {canOpenAdmin || showMyUploadsEntry ? (
                    <div className={s.userMenuDivider} />
                  ) : null}
                  <button
                    type="button"
                    className={`${s.userMenuItem} ${s.userMenuItemDanger}`}
                    onClick={() => {
                      logout();
                      closeMenu();
                    }}
                  >
                    <LogOut size={15} />
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <button type="button" className={s.loginEntry} onClick={goLogin}>
            <LogIn size={14} />
            <span>登录</span>
          </button>
        )}
      </div>
    </header>
  );
}
