import { useEffect, useMemo, useState } from 'react';
import PageShell from '../components/PageShell';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, resolveKnowledgeEmbedUrl } from '../utils/bishengEmbed';
import s from './KnowledgeSpacesPage.module.css';

export default function KnowledgeSpacesPage() {
  const { config } = usePortalConfig();
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');

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
      applyEmbedOriginOverride(
        resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
        import.meta.env.VITE_BISHENG_EMBED_ORIGIN,
      ),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );

  return (
    <PageShell hideFooter>
      <div className={s.embedPage}>
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
