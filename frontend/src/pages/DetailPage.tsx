import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Sparkles, Star } from 'lucide-react';
import PageShell from '../components/PageShell';
import SectionHeader from '../components/SectionHeader';
import TagPill from '../components/TagPill';
import { fetchFileChunks, fetchFileDetail, fetchFilePreview, fetchRelatedFiles, type FileChunkItem, type FileDetail, type FileItem, type FilePreviewManifest } from '../api/content';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { resolveDetailBackTarget } from '../utils/detailPage';
import { formatDisplayDateTime } from '../utils/dateTime';
import { resolveFilePreview } from '../utils/filePreview';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import s from './DetailPage.module.css';

const DocumentPreview = lazy(() => import('../components/DocumentPreview'));

export default function DetailPage() {
  const { spaceId: spaceIdStr = '', fileId: fileIdStr = '' } = useParams<{ spaceId: string; fileId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { config } = usePortalConfig();
  const { user } = useAuth();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [preview, setPreview] = useState<FilePreviewManifest | null>(null);
  const [chunks, setChunks] = useState<FileChunkItem[]>([]);
  const [related, setRelated] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientFallbackActive, setClientFallbackActive] = useState(false);

  const fileId = Number(fileIdStr);
  const spaceId = Number(spaceIdStr);
  const shareToken = searchParams.get('share_token') || '';
  // When embedded inside an iframe (e.g. the search/list preview modal) we render
  // only the document card without the portal chrome or related recommendations.
  const embed = searchParams.get('embed') === '1';
  const relatedFilesCount = embed || shareToken ? 0 : displayConfig.detail.relatedFilesCount;
  const backTarget = resolveDetailBackTarget(location.state?.returnTo, spaceIdStr);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setClientFallbackActive(false);
    void (async () => {
      try {
        const [detailResult, previewResult, relatedResult] = await Promise.all([
          fetchFileDetail(spaceId, fileId, shareToken || undefined),
          fetchFilePreview(spaceId, fileId, shareToken || undefined, embed ? 'search_result_preview' : 'home_result_preview'),
          relatedFilesCount === 0
            ? Promise.resolve([])
            : fetchRelatedFiles(spaceId, fileId, relatedFilesCount),
        ]);
        if (!active) return;
        const chunkResult = (previewResult?.mode === 'chunks' && detailResult)
          ? await fetchFileChunks(spaceId, fileId, shareToken || undefined)
          : [];
        if (!active) return;
        setDetail(detailResult);
        setPreview(previewResult);
        setChunks(chunkResult);
        setRelated(relatedResult);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '详情加载失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [embed, fileId, relatedFilesCount, shareToken, spaceId]);

  const wrap = (children: ReactNode) =>
    embed ? <div className={s.embedRoot}>{children}</div> : <PageShell>{children}</PageShell>;

  if (loading) {
    return wrap(
      <div className={s.container}>
        <p style={{ padding: '48px 0', textAlign: 'center', color: 'var(--neutral-400)' }}>
          正在加载文档详情...
        </p>
      </div>,
    );
  }

  if (error || !detail) {
    return wrap(
      <div className={s.container}>
        <p style={{ padding: '48px 0', textAlign: 'center', color: 'var(--neutral-400)' }}>
          {error || '文档不存在'}
        </p>
      </div>,
    );
  }

  const META_TAGS = ['最新精选', '典型案例'];
  const displayTags = detail.tags.filter((t) => !META_TAGS.includes(t));
  const formattedUpdatedAt = formatDisplayDateTime(detail.date) || '—';
  const resolvedPreview = resolveFilePreview(preview);
  const effectivePreview = clientFallbackActive
    ? {
      ...resolvedPreview,
      mode: 'chunks' as const,
      prefersChunks: true,
      reason: '当前文件预览失败，已回退到正文分段内容。',
      viewerUrl: '',
    }
    : resolvedPreview;

  async function handlePreviewFailure() {
    if (!clientFallbackActive) setClientFallbackActive(true);
    if (chunks.length > 0) return;
    try {
      const fallbackChunks = await fetchFileChunks(spaceId, fileId, shareToken || undefined);
      setChunks(fallbackChunks);
    } catch {
      setError((current) => current || '文档预览失败，且无法加载正文分段内容');
    }
  }

  return wrap(
    <div className={s.container}>
        {embed ? null : (
          <div className={s.topBar}>
            <Link to={backTarget} className={s.backLink}>
              <ArrowLeft size={16} />
              返回列表
            </Link>
            <span className={s.sourceLabel}>来源：{detail.space.name}</span>
          </div>
        )}

        <div className={s.card}>
          <h1 className={s.title}>{detail.title}</h1>
          <div className={s.metaGrid}>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>文件大小</span>
              <span className={s.metaValue}>{detail.sizeLabel || '—'}</span>
            </div>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>标签</span>
              <div className={s.metaTags}>
                {displayTags.length > 0
                  ? displayTags.map((t) => <TagPill key={t} name={t} neutral />)
                  : <span className={s.metaValue}>无</span>}
              </div>
            </div>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>文件编码</span>
              <span className={s.metaValue}>{detail.fileEncoding || '—'}</span>
            </div>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>更新时间</span>
              <span className={s.metaValue}>{formattedUpdatedAt}</span>
            </div>
          </div>
          <div className={s.divider} />
          <div className={s.summaryBlock}>
            <div className={s.summaryHeader}>
              <div className={s.summaryIcon}>
                <Sparkles size={14} />
              </div>
              <span className={s.summaryTitle}>AI概览</span>
            </div>
            <div className={s.summaryText}>{detail.summary}</div>
          </div>
          <div className={s.previewArea}>
            <Suspense fallback={<div className={s.previewLoading}>正在加载阅读器...</div>}>
              <DocumentPreview
                chunks={chunks}
                onPreviewFailure={() => void handlePreviewFailure()}
                preview={effectivePreview}
                title={detail.title}
              />
            </Suspense>
          </div>
          {user ? (
            <div className={s.downloadBar}>
              <a
                className={s.downloadBtn}
                href={effectivePreview.downloadUrl}
                download={effectivePreview.downloadUrl ? `${detail.title}.${detail.ext}` : undefined}
                target={effectivePreview.downloadUrl ? '_blank' : undefined}
                rel={effectivePreview.downloadUrl ? 'noreferrer' : undefined}
                aria-disabled={!effectivePreview.downloadUrl}
                onClick={(event) => {
                  if (!effectivePreview.downloadUrl) event.preventDefault();
                }}
              >
                <Download size={16} />
                下载原文件
              </a>
            </div>
          ) : null}
        </div>

        {related.length > 0 && (
          <div className={s.relatedSection}>
            <SectionHeader icon={Star} title="相关推荐" />
            <div className={s.relatedGrid}>
              {related.map((f) => {
                const rTags = f.tags.filter((t) => !META_TAGS.includes(t));
                return (
                  <div
                    key={f.id}
                    className={s.relatedCard}
                    onClick={() =>
                      navigate(`/space/${f.spaceId}/file/${f.id}`, {
                        state: { returnTo: `${location.pathname}${location.search}` },
                      })}
                  >
                    <div className={s.relatedTitle}>{f.title}</div>
                    <div className={s.relatedSummary}>{f.summary}</div>
                    <div className={s.relatedTags}>
                      {rTags.map((t) => <TagPill key={t} name={t} neutral />)}
                    </div>
                    <div className={s.relatedMeta}>
                      <span className={s.relatedSource}>{f.source}</span>
                      <span className={s.relatedDate}>{formatDisplayDateTime(f.date)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>,
  );
}
