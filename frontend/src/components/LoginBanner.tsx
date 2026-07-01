import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogIn, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import s from './LoginBanner.module.css';

const DELAY_MS = 3 * 60 * 1000;
const DISMISSED_KEY = 'sg_login_banner_dismissed';

export default function LoginBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (user) {
      setVisible(false);
      return;
    }
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const timer = setTimeout(() => {
      if (!sessionStorage.getItem(DISMISSED_KEY)) {
        setVisible(true);
      }
    }, DELAY_MS);

    return () => clearTimeout(timer);
  }, [user]);

  if (!visible || user) return null;

  const handleLogin = () => {
    const redirect = `${location.pathname}${location.search}`;
    navigate(`/login?redirect=${encodeURIComponent(redirect)}`);
  };

  const handleClose = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <div className={s.banner} role="banner" aria-label="登录提示">
      <span className={s.text}>登录解锁完整知库</span>
      <button type="button" className={s.loginBtn} onClick={handleLogin}>
        <LogIn size={14} />
        立即登录
      </button>
      <button type="button" className={s.closeBtn} aria-label="关闭" onClick={handleClose}>
        <X size={16} />
      </button>
    </div>
  );
}
