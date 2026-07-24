import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logoutPortal } from '../api/auth';
import { clearPortalUser } from '../hooks/useAuth';
import {
  getPortalAuthNoticeMessage,
  PORTAL_AUTH_NOTICE_PARAM,
  PORTAL_AUTH_NOTICE_USER_UNREGISTERED,
  stripPortalAuthNoticeFromSearch,
} from '../utils/portalAuthNotice';
import s from './PortalAuthNoticeHost.module.css';

export default function PortalAuthNoticeHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const handledRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const notice = params.get(PORTAL_AUTH_NOTICE_PARAM);
    if (!notice) {
      handledRef.current = null;
      return;
    }

    const signature = `${location.pathname}${location.search}`;
    if (handledRef.current === signature) return;
    handledRef.current = signature;

    const nextSearch = stripPortalAuthNoticeFromSearch(location.search);
    navigate(`${location.pathname}${nextSearch}${location.hash}`, { replace: true });

    clearPortalUser();
    void logoutPortal().catch(() => undefined);

    const noticeMessage = getPortalAuthNoticeMessage(notice);
    if (noticeMessage) {
      setMessage(noticeMessage);
      setOpen(true);
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  if (!open) return null;

  return (
    <div className={s.backdrop} role="presentation" onClick={() => setOpen(false)}>
      <div
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-auth-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={s.icon}>
          <AlertCircle size={22} />
        </div>
        <h3 id="portal-auth-notice-title" className={s.title}>登录提示</h3>
        <p className={s.text}>{message}</p>
        <button type="button" className={s.action} onClick={() => setOpen(false)}>
          我知道了
        </button>
      </div>
    </div>
  );
}

export { PORTAL_AUTH_NOTICE_USER_UNREGISTERED };
