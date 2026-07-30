/**
 * PWA 安装能力封装：
 * - 捕获浏览器的 beforeinstallprompt 事件（拦截浏览器自带提示，改由「立即添加」按钮触发）
 * - 注册极简 Service Worker（满足可安装判定）
 * - 对外暴露：是否可安装、订阅变化、触发安装、是否已安装
 *
 * 注意：仅在 HTTPS（或 localhost）下浏览器才会派发 beforeinstallprompt；
 * 纯 HTTP 环境下 isInstallAvailable() 恒为 false，安装弹窗不会出现。
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // 忽略单个订阅者异常
    }
  });
}

export function initPwa(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    deferredPrompt = null;
    notify();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Service Worker 注册失败（如 HTTP 环境）时静默降级
      });
    });
  }
}

/** 当前是否处于「已安装的独立窗口」模式 */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari 私有字段
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return Boolean(mm || iosStandalone || appInstalled);
}

/** 是否可以触发安装（拿到了 beforeinstallprompt 且尚未安装） */
export function isInstallAvailable(): boolean {
  return deferredPrompt !== null && !isRunningStandalone();
}

/** 订阅安装能力变化，返回取消订阅函数 */
export function subscribePwa(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 触发浏览器原生安装确认框 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const evt = deferredPrompt;
  if (!evt) return 'unavailable';
  deferredPrompt = null;
  notify();
  try {
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}
