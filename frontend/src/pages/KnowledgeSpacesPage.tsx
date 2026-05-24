import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageShell from '../components/PageShell';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { resolveKnowledgeEmbedUrl } from '../utils/bishengEmbed';
import {
  PORTAL_APPROVAL_EVENT,
  type PortalApprovalAction,
  isPortalApprovalAction,
  postPortalApprovalMessageToFrame,
  takePendingPortalApprovalAction,
} from '../utils/portalApprovalBridge';
import s from './KnowledgeSpacesPage.module.css';

export default function KnowledgeSpacesPage() {
  const { config } = usePortalConfig();
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pendingActionRef = useRef<PortalApprovalAction | null>(null);

  useEffect(() => {
    let active = true;
    void fetchBishengRuntimeConfig()
      .then((runtime) => {
        if (!active) return;
        setRuntimeAssetBaseUrl(runtime.asset_base_url || '');
      })
      .catch((err) => {
        if (!active) return;
        console.warn(err instanceof Error ? err.message : 'BiSheng 运行配置加载失败');
      });
    return () => {
      active = false;
    };
  }, []);

  const embedUrl = useMemo(
    () => resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );

  const sendActionToFrame = useCallback((action: PortalApprovalAction) => {
    const posted = postPortalApprovalMessageToFrame(frameRef.current, action);
    pendingActionRef.current = posted ? null : action;
  }, []);

  useEffect(() => {
    function handlePortalApprovalEvent(event: Event) {
      const detail = (event as CustomEvent<{ action?: unknown }>).detail;
      if (!isPortalApprovalAction(detail?.action)) return;
      sendActionToFrame(detail.action);
    }

    window.addEventListener(PORTAL_APPROVAL_EVENT, handlePortalApprovalEvent);
    return () => window.removeEventListener(PORTAL_APPROVAL_EVENT, handlePortalApprovalEvent);
  }, [sendActionToFrame]);

  const handleFrameLoad = useCallback(() => {
    let action = pendingActionRef.current;
    if (!action) {
      try {
        action = takePendingPortalApprovalAction(window.sessionStorage);
      } catch {
        action = null;
      }
    }
    if (!action) return;
    sendActionToFrame(action);
  }, [sendActionToFrame]);

  return (
    <PageShell hideFooter>
      <div className={s.embedPage}>
        <div className={s.frameShell}>
          <iframe
            ref={frameRef}
            id="bisheng-knowledge-frame"
            className={s.frame}
            src={embedUrl}
            title="BiSheng 知识空间"
            allow="clipboard-read; clipboard-write"
            onLoad={handleFrameLoad}
          />
        </div>
      </div>
    </PageShell>
  );
}
