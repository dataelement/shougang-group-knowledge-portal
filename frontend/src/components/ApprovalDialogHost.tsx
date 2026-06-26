import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { useAuth } from '../hooks/useAuth';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, resolvePortalDialogsEmbedUrl } from '../utils/bishengEmbed';
import {
  PORTAL_APPROVAL_EVENT,
  PORTAL_DIALOG_CLOSED_MESSAGE,
  PORTAL_DIALOG_READY_MESSAGE,
  type PortalApprovalAction,
  isPortalApprovalAction,
  postPortalApprovalMessageToFrame,
} from '../utils/portalApprovalBridge';
import s from './ApprovalDialogHost.module.css';

const FRAME_READY_TIMEOUT_MS = 8000;

/**
 * Global host for the BiSheng approval / notification dialogs so they can be
 * opened from any portal page (not only the knowledge workbench). It keeps a
 * hidden, full-viewport iframe pointing at BiSheng's chrome-less dialog route;
 * on a trigger it shows the iframe as an overlay and postMessages the action.
 * The iframe is mounted eagerly once the user is logged in so the BiSheng SPA
 * preloads in the background; otherwise the first click would white-screen
 * while the whole SPA loads behind the (full-viewport) overlay. BiSheng renders
 * the dialog (with its own dim backdrop) and posts back when it closes, which
 * hides the overlay.
 */
export default function ApprovalDialogHost() {
  const { user } = useAuth();
  const { config } = usePortalConfig();
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [waitingForFrame, setWaitingForFrame] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pendingActionRef = useRef<PortalApprovalAction | null>(null);
  const readyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBishengRuntimeConfig()
      .then((runtime) => {
        if (active) setRuntimeAssetBaseUrl(runtime.asset_base_url || '');
      })
      .catch(() => {
        // Fall back to the deployment default embed URL.
      });
    return () => {
      active = false;
    };
  }, []);

  const embedUrl = useMemo(
    () =>
      applyEmbedOriginOverride(
        resolvePortalDialogsEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
        import.meta.env.VITE_BISHENG_EMBED_ORIGIN,
      ),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );

  const clearReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current !== null) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
  }, []);

  const waitForFrameReady = useCallback((action: PortalApprovalAction) => {
    pendingActionRef.current = action;
    setWaitingForFrame(true);
    setFrameError(null);
    clearReadyTimeout();
    readyTimeoutRef.current = window.setTimeout(() => {
      if (!pendingActionRef.current) return;
      setFrameError('审批与消息窗口加载失败，请刷新页面或重新登录后再试。');
    }, FRAME_READY_TIMEOUT_MS);
  }, [clearReadyTimeout]);

  const finishPendingAction = useCallback(() => {
    pendingActionRef.current = null;
    setWaitingForFrame(false);
    setFrameError(null);
    clearReadyTimeout();
  }, [clearReadyTimeout]);

  const sendActionToReadyFrame = useCallback((action: PortalApprovalAction) => {
    const posted = postPortalApprovalMessageToFrame(frameRef.current, action);
    if (posted) {
      finishPendingAction();
      return;
    }
    setFrameReady(false);
    waitForFrameReady(action);
  }, [finishPendingAction, waitForFrameReady]);

  const sendActionToFrame = useCallback((action: PortalApprovalAction) => {
    if (!frameReady) {
      waitForFrameReady(action);
      return;
    }
    sendActionToReadyFrame(action);
  }, [frameReady, sendActionToReadyFrame, waitForFrameReady]);

  useEffect(() => {
    function handleOpenEvent(event: Event) {
      const detail = (event as CustomEvent<{ action?: unknown }>).detail;
      if (!isPortalApprovalAction(detail?.action)) return;
      setOpen(true);
      sendActionToFrame(detail.action);
    }
    window.addEventListener(PORTAL_APPROVAL_EVENT, handleOpenEvent);
    return () => window.removeEventListener(PORTAL_APPROVAL_EVENT, handleOpenEvent);
  }, [sendActionToFrame]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === PORTAL_DIALOG_READY_MESSAGE) {
        setFrameReady(true);
        const action = pendingActionRef.current;
        if (action) sendActionToReadyFrame(action);
        return;
      }
      if (event.data?.type === PORTAL_DIALOG_CLOSED_MESSAGE) setOpen(false);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sendActionToReadyFrame]);

  const closeStatus = useCallback(() => {
    setOpen(false);
    finishPendingAction();
  }, [finishPendingAction]);

  useEffect(() => {
    setFrameReady(false);
  }, [embedUrl]);

  useEffect(() => clearReadyTimeout, [clearReadyTimeout]);

  // Logged-out users have no trigger and no BiSheng session; render nothing.
  // Once logged in, the iframe is always mounted (hidden) so it preloads.
  if (!user) return null;

  return (
    <div className={open ? s.overlayOpen : s.overlayHidden} aria-hidden={!open}>
      <iframe
        ref={frameRef}
        className={s.frame}
        src={embedUrl}
        title="审批与消息"
      />
      {waitingForFrame ? (
        <div className={s.statusPanel} role="status" aria-live="polite">
          <div className={s.statusTitle}>{frameError ? '窗口打开失败' : '窗口加载中'}</div>
          <div className={s.statusText}>
            {frameError || '正在连接审批与消息窗口...'}
          </div>
          {frameError ? (
            <button type="button" className={s.statusButton} onClick={closeStatus}>
              关闭
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
