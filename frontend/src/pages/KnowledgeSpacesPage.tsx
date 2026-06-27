import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, mergeKnowledgeDeepLinkParams, resolveKnowledgeEmbedUrl } from '../utils/bishengEmbed';
import s from './KnowledgeSpacesPage.module.css';

const OPEN_DOCUMENT_CHAT_MESSAGE = 'shougang-portal:open-document-chat';

export default function KnowledgeSpacesPage() {
  const { config } = usePortalConfig();
  const [searchParams] = useSearchParams();
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const openChatTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (openChatTimerRef.current !== null) {
        window.clearInterval(openChatTimerRef.current);
        openChatTimerRef.current = null;
      }
    };
  }, []);

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
    () =>
      mergeKnowledgeDeepLinkParams(
        applyEmbedOriginOverride(
          resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
          import.meta.env.VITE_BISHENG_EMBED_ORIGIN,
        ),
        searchParams,
      ),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url, searchParams],
  );

  const shouldOpenChat = searchParams.get('openChat') === '1';

  const handleFrameLoad = () => {
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
          <iframe
            ref={frameRef}
            id="bisheng-knowledge-frame"
            className={s.frame}
            src={embedUrl}
            title="BiSheng 知识库"
            allow="clipboard-read; clipboard-write"
            onLoad={handleFrameLoad}
          />
        </div>
      </div>
    </PageShell>
  );
}
