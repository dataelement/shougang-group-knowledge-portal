import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { useAuth } from '../hooks/useAuth';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, resolvePortalDialogsEmbedUrl } from '../utils/bishengEmbed';
import {
  PORTAL_APPROVAL_EVENT,
  PORTAL_DIALOG_CLOSED_MESSAGE,
  type PortalApprovalAction,
  isPortalApprovalAction,
  postPortalApprovalMessageToFrame,
} from '../utils/portalApprovalBridge';
import s from './ApprovalDialogHost.module.css';

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
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pendingActionRef = useRef<PortalApprovalAction | null>(null);

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

  const sendActionToFrame = useCallback((action: PortalApprovalAction) => {
    const posted = postPortalApprovalMessageToFrame(frameRef.current, action);
    // If the iframe has not finished loading, defer until onLoad fires.
    pendingActionRef.current = posted ? null : action;
  }, []);

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
      if (event.data?.type === PORTAL_DIALOG_CLOSED_MESSAGE) setOpen(false);
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleFrameLoad = useCallback(() => {
    const action = pendingActionRef.current;
    if (action) sendActionToFrame(action);
  }, [sendActionToFrame]);

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
        onLoad={handleFrameLoad}
      />
    </div>
  );
}
