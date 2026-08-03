import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import PageShell from '../components/PageShell';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { ensureAuthSynced, isPortalLogoutInProgress, useAuth } from '../hooks/useAuth';
import { applyEmbedOriginOverride, resolveKnowledgeEmbedUrl } from '../utils/bishengEmbed';
import { postOpenKnowledgeFileWithRetry } from '../utils/portalApprovalBridge';
import { triggerLoginRedirect } from '../utils/loginRedirect';
import s from './KnowledgeSpacesPage.module.css';

const OPEN_DOCUMENT_CHAT_MESSAGE = 'shougang-portal:open-document-chat';
const KNOWLEDGE_LOCATION_MESSAGE = 'shougang-portal:knowledge-location';
const PORTAL_AUTH_REQUIRED_MESSAGE = 'shougang-portal:auth-required';

function getMessageString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}

function updateKnowledgeLocationUrl(data: Record<string, unknown>) {
  const spaceId = getMessageString(data, 'spaceId');
  if (!spaceId) return;

  const params = new URLSearchParams(window.location.search);
  const folderId = getMessageString(data, 'folderId');
  const folderName = getMessageString(data, 'folderName');
  const fileId = getMessageString(data, 'fileId');
  const fileName = getMessageString(data, 'fileName');

  params.set('spaceId', spaceId);
  if (folderId) {
    params.set('folderId', folderId);
    if (folderName) params.set('folderName', folderName);
  } else {
    params.delete('folderId');
    params.delete('folderName');
  }
  if (fileId) {
    params.set('fileId', fileId);
    if (fileName) params.set('fileName', fileName);
  } else {
    params.delete('fileId');
    params.delete('fileName');
  }
  // openNonce is only for triggering Client restore; drop it from the shareable URL.
  params.delete('openNonce');
  params.delete('openChat');

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, '', nextUrl);
  }
}

export default function KnowledgeSpacesPage() {
  const { config, loading: portalConfigLoading } = usePortalConfig();
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [authChecked, setAuthChecked] = useState(false);
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const [runtimeConfigSettled, setRuntimeConfigSettled] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const openChatTimerRef = useRef<number | null>(null);
  const openFileTimerRef = useRef<number | null>(null);
  const loginRedirectedRef = useRef(false);

  const redirectToPortalLogin = useCallback(() => {
    if (loginRedirectedRef.current || isPortalLogoutInProgress()) return;
    loginRedirectedRef.current = true;
    triggerLoginRedirect(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  useEffect(() => {
    let active = true;
    void ensureAuthSynced().finally(() => {
      if (active) setAuthChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user || !authChecked) return;
    redirectToPortalLogin();
  }, [user, authChecked, redirectToPortalLogin]);

  const clearOpenFileTimer = useCallback(() => {
    if (openFileTimerRef.current !== null) {
      window.clearInterval(openFileTimerRef.current);
      openFileTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (openChatTimerRef.current !== null) {
        window.clearInterval(openChatTimerRef.current);
        openChatTimerRef.current = null;
      }
      clearOpenFileTimer();
    };
  }, [clearOpenFileTimer]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const message = data as Record<string, unknown>;
      if (message.type === PORTAL_AUTH_REQUIRED_MESSAGE) {
        redirectToPortalLogin();
        return;
      }
      if (message.type !== KNOWLEDGE_LOCATION_MESSAGE) return;
      updateKnowledgeLocationUrl(message);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [redirectToPortalLogin]);

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
      })
      .finally(() => {
        if (active) setRuntimeConfigSettled(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep iframe.src stable. File/space deep links are delivered via postMessage so
  // clicking a file (e.g. from tag review) does not remount the Client SPA.
  const embedUrl = useMemo(
    () =>
      applyEmbedOriginOverride(
        resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
        import.meta.env.VITE_BISHENG_EMBED_ORIGIN,
      ),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );
  const iframeReady = authChecked && Boolean(user) && !portalConfigLoading && runtimeConfigSettled;

  const shouldOpenChat = searchParams.get('openChat') === '1';
  const deepLinkSpaceId = searchParams.get('spaceId')?.trim() || '';
  const deepLinkFileId = searchParams.get('fileId')?.trim() || '';
  const deepLinkFileName = searchParams.get('fileName')?.trim() || '';
  const deepLinkFolderId = searchParams.get('folderId')?.trim() || '';
  const deepLinkFolderName = searchParams.get('folderName')?.trim() || '';
  const deepLinkOpenNonce = searchParams.get('openNonce')?.trim() || '';

  const postOpenFileDeepLink = useCallback(() => {
    if (!deepLinkSpaceId || !deepLinkFileId) return;
    clearOpenFileTimer();
    postOpenKnowledgeFileWithRetry(
      frameRef.current,
      {
        spaceId: deepLinkSpaceId,
        fileId: deepLinkFileId,
        fileName: deepLinkFileName || undefined,
        folderId: deepLinkFolderId || undefined,
        folderName: deepLinkFolderName || undefined,
        openNonce: deepLinkOpenNonce || undefined,
      },
      {
        onTimer: (timerId) => {
          openFileTimerRef.current = timerId;
        },
      },
    );
  }, [
    clearOpenFileTimer,
    deepLinkFileId,
    deepLinkFileName,
    deepLinkFolderId,
    deepLinkFolderName,
    deepLinkOpenNonce,
    deepLinkSpaceId,
  ]);

  useEffect(() => {
    postOpenFileDeepLink();
  }, [postOpenFileDeepLink]);

  const handleFrameLoad = () => {
    // File deep link: retry after SPA hydrate (covers cold load / refresh).
    postOpenFileDeepLink();

    if (!shouldOpenChat || !frameRef.current?.contentWindow) return;
    // The embedded BiSheng SPA may still be hydrating when iframe onLoad
    // fires. Send the open-document-chat message immediately and retry a
    // few times to ensure Bisheng's message listener is already mounted.
    if (openChatTimerRef.current !== null) {
      window.clearInterval(openChatTimerRef.current);
    }
    const contentWindow = frameRef.current.contentWindow;
    let attempts = 0;
    const maxAttempts = 8;
    const intervalMs = 250;
    const sendOpenChat = () => {
      contentWindow.postMessage({ type: OPEN_DOCUMENT_CHAT_MESSAGE }, '*');
      console.log('[portal] sent open-document-chat to Bisheng iframe', { attempt: attempts + 1 });
      attempts += 1;
      if (attempts >= maxAttempts && openChatTimerRef.current !== null) {
        window.clearInterval(openChatTimerRef.current);
        openChatTimerRef.current = null;
      }
    };
    sendOpenChat();
    openChatTimerRef.current = window.setInterval(sendOpenChat, intervalMs);
  };

  return (
    <PageShell hideFooter>
      <div className={s.embedPage}>
        <div className={s.frameShell}>
          {iframeReady ? (
            <iframe
              ref={frameRef}
              id="bisheng-knowledge-frame"
              className={s.frame}
              src={embedUrl}
              title="BiSheng 知识库"
              allow="clipboard-read; clipboard-write"
              onLoad={handleFrameLoad}
            />
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
