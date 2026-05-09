import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderLock, RefreshCw } from 'lucide-react';
import PageShell from '../components/PageShell';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { resolveKnowledgeEmbedUrl } from '../utils/bishengEmbed';
import s from './KnowledgeSpacesPage.module.css';

export default function KnowledgeSpacesPage() {
  const { config, loading, error } = usePortalConfig();
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const [runtimeError, setRuntimeError] = useState('');

  useEffect(() => {
    let active = true;
    void fetchBishengRuntimeConfig()
      .then((runtime) => {
        if (!active) return;
        setRuntimeAssetBaseUrl(runtime.asset_base_url || '');
      })
      .catch((err) => {
        if (!active) return;
        setRuntimeError(err instanceof Error ? err.message : 'BiSheng 运行配置加载失败');
      });
    return () => {
      active = false;
    };
  }, []);

  const embedUrl = useMemo(
    () => resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );

  return (
    <PageShell>
      <div className={s.embedPage}>
        <section className={s.embedHeader}>
          <div className={s.embedTitleWrap}>
            <span className={s.embedIcon}>
              <FolderLock size={18} />
            </span>
            <div>
              <h1 className={s.embedTitle}>我的知识</h1>
              <p className={s.embedSub}>已嵌入 BiSheng 知识空间页面。</p>
            </div>
          </div>
          <div className={s.embedActions}>
            <button
              type="button"
              className={s.iconBtn}
              title="刷新"
              aria-label="刷新"
              onClick={() => {
                const frame = document.getElementById('bisheng-knowledge-frame') as HTMLIFrameElement | null;
                if (frame) frame.src = embedUrl;
              }}
            >
              <RefreshCw size={15} />
            </button>
            <a
              className={s.iconBtn}
              href={embedUrl}
              target="_blank"
              rel="noreferrer"
              title="新窗口打开"
              aria-label="新窗口打开"
            >
              <ExternalLink size={15} />
            </a>
          </div>
        </section>

        {loading ? <div className={s.embedNotice}>正在加载门户配置...</div> : null}
        {!loading && error ? <div className={s.embedNotice}>配置加载失败，已使用默认嵌入地址。</div> : null}
        {!loading && runtimeError ? (
          <div className={s.embedNotice}>BiSheng 前端地址未读取到，已使用默认嵌入地址。</div>
        ) : null}

        <div className={s.frameShell}>
          <iframe
            id="bisheng-knowledge-frame"
            className={s.frame}
            src={embedUrl}
            title="BiSheng 知识空间"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      </div>
    </PageShell>
  );
}
