import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  isInstallAvailable,
  isRunningStandalone,
  promptInstall,
  subscribeInstallHoverIntent,
  subscribePwa,
} from '../pwa/pwaInstall';
import s from './PwaInstallPrompt.module.css';

// localStorage 键：永久不再提示 / 当天不再提示
const KEY_NEVER = 'gxz-pwa-install-never';
const KEY_DISMISS_DAY = 'gxz-pwa-install-dismiss-day';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 是否被用户静音（永久不再提示，或当天已关闭）
function isMuted(): boolean {
  try {
    if (localStorage.getItem(KEY_NEVER) === '1') return true;
    if (localStorage.getItem(KEY_DISMISS_DAY) === todayStr()) return true;
  } catch {
    // localStorage 不可用时不静音
  }
  return false;
}

function setNever() {
  try {
    localStorage.setItem(KEY_NEVER, '1');
  } catch {
    // 忽略
  }
}

function setDismissedToday() {
  try {
    localStorage.setItem(KEY_DISMISS_DAY, todayStr());
  } catch {
    // 忽略
  }
}

export default function PwaInstallPrompt() {
  const location = useLocation();
  const onAppsPage = location.pathname === '/apps';

  const [visible, setVisible] = useState(false);
  const [available, setAvailable] = useState(isInstallAvailable());

  // 跟踪安装能力变化（beforeinstallprompt 可能晚于组件挂载才触发）
  useEffect(() => subscribePwa(() => setAvailable(isInstallAvailable())), []);

  // 鼠标移入浮动钢小智按钮时显示；离开智能应用页则不显示
  useEffect(() => {
    if (!onAppsPage) {
      setVisible(false);
      return;
    }
    return subscribeInstallHoverIntent(() => {
      if (isRunningStandalone() || isMuted()) return;
      if (isInstallAvailable()) setVisible(true);
    });
  }, [onAppsPage]);

  if (!onAppsPage || !visible || !available) return null;

  const handleInstall = async () => {
    setVisible(false);
    setNever(); // 点了「立即添加」即视为已处理，以后不再提示
    await promptInstall();
  };

  const handleNever = () => {
    setNever();
    setVisible(false);
  };

  const handleClose = () => {
    setDismissedToday();
    setVisible(false);
  };

  return (
    <div className={s.bubble} role="dialog" aria-label="把钢小智放到桌面">
      <button type="button" className={s.close} aria-label="关闭" onClick={handleClose}>
        ×
      </button>
      <div className={s.title}>把钢小智放到桌面</div>
      <div className={s.subtitle}>双击桌面图标，即可快捷访问钢小智</div>
      <div className={s.actions}>
        <button type="button" className={s.primary} onClick={handleInstall}>
          立即添加
        </button>
        <button type="button" className={s.ghost} onClick={handleNever}>
          不再提示
        </button>
      </div>
      <span className={s.tail} aria-hidden="true" />
    </div>
  );
}
