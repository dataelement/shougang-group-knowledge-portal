import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate, Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Sparkles, Star } from 'lucide-react';
import PageShell from '../components/PageShell';
import DepartmentFileAccessGate from '../components/DepartmentFileAccessGate';
import PreviewWatermark from '../components/PreviewWatermark';
import SectionHeader from '../components/SectionHeader';
import TagPill from '../components/TagPill';
import {
  applyDepartmentFileView,
  fetchDepartmentFileViewAccess,
  fetchFileChunks,
  fetchFileDetail,
  fetchFilePreview,
  fetchRelatedFiles,
  type DepartmentFileViewAccess,
  type FileChunkItem,
  type FileDetail,
  type FileItem,
  type FilePreviewContext,
  type FilePreviewManifest,
  type PortalDownloadEntryPoint,
} from '../api/content';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { buildKnowledgeFileDeepLinkPath } from '../utils/bishengEmbed';
import { resolveDetailBackTarget } from '../utils/detailPage';
import { formatDisplayDateTime } from '../utils/dateTime';
import { resolveFilePreview } from '../utils/filePreview';
import { buildDownloadFileName, downloadWatermarkedFile } from '../utils/fileDownload';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import { triggerLoginRedirect } from '../utils/loginRedirect';
import { PORTAL_APPROVAL_EVENT } from '../utils/portalApprovalBridge';
import { ActionToast } from '../components/ActionToast';
import { useActionToast } from '../hooks/useActionToast';
import s from './DetailPage.module.css';

const DocumentPreview = lazy(() => import('../components/DocumentPreview'));

function resolveDownloadEntryPoint(
  requestedEntryPoint: string,
  shareToken: string,
): PortalDownloadEntryPoint {
  if (shareToken) return 'share';
  if (requestedEntryPoint === 'recommendation_list' || requestedEntryPoint === 'knowledge_space') {
    return 'knowledge_list';
  }
  if (requestedEntryPoint === 'direct' || !requestedEntryPoint) return 'detail';
  if (
    requestedEntryPoint === 'search'
    || requestedEntryPoint === 'detail'
    || requestedEntryPoint === 'home_recommendation'
    || requestedEntryPoint === 'favorite'
    || requestedEntryPoint === 'expert_qa'
    || requestedEntryPoint === 'qa_citation'
    || requestedEntryPoint === 'other'
  ) {
    return requestedEntryPoint;
  }
  return 'detail';
}

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
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [viewAccess, setViewAccess] = useState<DepartmentFileViewAccess | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [accessRevision, setAccessRevision] = useState(0);
  const { toast, showError } = useActionToast();

  const fileId = Number(fileIdStr);
  const spaceId = Number(spaceIdStr);
  const shareToken = searchParams.get('share_token') || '';
  // When embedded inside an iframe (e.g. the search/list preview modal) we render
  // only the document card without the portal chrome or related recommendations.
  const embed = searchParams.get('embed') === '1';
  const requestedEntryPoint = searchParams.get('entry_point') || '';
  const previewEntryPoint: FilePreviewContext['entryPoint'] = (
    requestedEntryPoint === 'home_recommendation'
    || requestedEntryPoint === 'recommendation_list'
    || requestedEntryPoint === 'search'
    || requestedEntryPoint === 'knowledge_space'
    || requestedEntryPoint === 'direct'
    || requestedEntryPoint === 'favorite'
    || requestedEntryPoint === 'other'
  ) ? requestedEntryPoint : (embed ? 'other' : 'direct');
  const requestedRecommendationScene = searchParams.get('recommendation_scene');
  const recommendationScene = requestedRecommendationScene === 'personalized_v1'
    || requestedRecommendationScene === 'latest_selected'
    ? requestedRecommendationScene
    : null;
  // Documents opened from a chat citation link carry ?hideBack=1 — there is no
  // list context to return to, so the "返回列表" bar is omitted.
  const hideBack = searchParams.get('hideBack') === '1';
  const relatedFilesCount = embed || shareToken ? 0 : displayConfig.detail.relatedFilesCount;
  const backTarget = resolveDetailBackTarget(location.state?.returnTo, spaceIdStr);
  const canPreview = Boolean(user);
  const previewUserKey = user ? `${user.account}:${user.externalId || ''}` : '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setClientFallbackActive(false);
    setDetail(null);
    setPreview(null);
    setChunks([]);
    setRelated([]);
    setViewAccess(null);
    setApplyError('');
    void (async () => {
      try {
        if (canPreview) {
          const accessResult = await fetchDepartmentFileViewAccess(
            spaceId,
            fileId,
          );
          if (!active) return;
          setViewAccess(accessResult);
          if (accessResult.status !== 'allowed') return;
        }
        const [detailResult, previewResult, relatedResult] = await Promise.all([
          fetchFileDetail(spaceId, fileId, shareToken || undefined),
          canPreview ? fetchFilePreview(spaceId, fileId, shareToken || undefined, {
            entryPoint: previewEntryPoint,
            recommendationScene,
          }) : Promise.resolve(null),
          relatedFilesCount === 0
            ? Promise.resolve([])
            : fetchRelatedFiles(spaceId, fileId, relatedFilesCount),
        ]);
        if (!active) return;
        const chunkResult = (canPreview && previewResult?.mode === 'chunks' && detailResult)
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
  }, [accessRevision, canPreview, fileId, previewEntryPoint, previewUserKey, recommendationScene, relatedFilesCount, shareToken, spaceId]);

  const wrap = (children: ReactNode) =>
    embed ? (
      <div className={s.embedRoot}>
        <ActionToast toast={toast} />
        {children}
      </div>
    ) : (
      <PageShell>
        <ActionToast toast={toast} />
        {children}
      </PageShell>
    );

  if (loading) {
    return wrap(
      <div className={s.container}>
        <p style={{ padding: '48px 0', textAlign: 'center', color: 'var(--neutral-400)' }}>
          正在加载文档详情...
        </p>
      </div>,
    );
  }

  if (viewAccess && viewAccess.status !== 'allowed') {
    const gateTitle = String(
      viewAccess.safeMetadata.file_name || `文件 ${fileId}`,
    );
    return wrap(
      <div className={s.container}>
        <DepartmentFileAccessGate
          access={viewAccess}
          applying={applying}
          error={applyError}
          onApply={async (reason) => {
            setApplying(true);
            setApplyError('');
            try {
              await applyDepartmentFileView(spaceId, fileId, reason);
              setAccessRevision((current) => current + 1);
            } catch (err) {
              setApplyError(
                err instanceof Error ? err.message : '查看申请提交失败',
              );
            } finally {
              setApplying(false);
            }
          }}
          onOpenRequests={() => {
            window.dispatchEvent(
              new CustomEvent(PORTAL_APPROVAL_EVENT, {
                detail: {
                  action: 'requests',
                  instanceId: viewAccess.instanceId,
                },
              }),
            );
          }}
          onDownload={viewAccess.canDownload ? async () => {
            setDownloadError('');
            try {
              await downloadWatermarkedFile({
                spaceId,
                fileId,
                entryPoint: resolveDownloadEntryPoint(
                  requestedEntryPoint,
                  shareToken,
                ),
                shareToken: shareToken || undefined,
                title: gateTitle,
                ext: String(viewAccess.safeMetadata.file_ext || ''),
              });
            } catch (err) {
              setApplyError(
                err instanceof Error ? err.message : '文档下载失败',
              );
            }
          } : undefined}
        />
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
  const displayTags = (detail.tag_infos ?? []).filter((t) => !META_TAGS.includes(t.tag_name));
  const canDownload = Boolean(user && (!detail.isDepartmentFile || detail.canDownload));
  const downloadEntryPoint = resolveDownloadEntryPoint(requestedEntryPoint, shareToken);
  const formattedUpdatedAt = formatDisplayDateTime(detail.date) || '—';
  const knowledgeFileName = buildDownloadFileName(detail);
  const resolvedPreview = resolveFilePreview(preview);
  let effectivePreview = resolvedPreview;
  if (clientFallbackActive) {
    effectivePreview = resolvedPreview.supportsChunksFallback ? {
      ...resolvedPreview,
      mode: 'chunks' as const,
      prefersChunks: true,
      reason: '当前文件预览失败，已回退到正文分段内容。',
      viewerUrl: '',
    } : {
      ...resolvedPreview,
      mode: 'unsupported' as const,
      prefersChunks: false,
      reason: '当前文件预览失败，请下载文件查看。',
      viewerUrl: '',
    };
  }

  async function handlePreviewFailure() {
    if (!canPreview) return;
    if (!clientFallbackActive) setClientFallbackActive(true);
    if (!resolvedPreview.supportsChunksFallback) return;
    if (chunks.length > 0) return;
    try {
      const fallbackChunks = await fetchFileChunks(spaceId, fileId, shareToken || undefined);
      setChunks(fallbackChunks);
    } catch {
      setError((current) => current || '文档预览失败，且无法加载正文分段内容');
    }
  }

  async function handleDownload() {
    if (!canDownload || downloadPending) return;
    setDownloadPending(true);
    setDownloadError('');
    try {
      await downloadWatermarkedFile({
        spaceId,
        fileId,
        entryPoint: downloadEntryPoint,
        shareToken: shareToken || undefined,
        title: detail?.title ?? '',
        ext: detail?.ext ?? '',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '文档下载失败';
      setDownloadError(message);
      showError(message);
    } finally {
      setDownloadPending(false);
    }
  }

  const previewContent = (
    <Suspense fallback={<div className={s.previewLoading}>正在加载阅读器...</div>}>
      <DocumentPreview
        chunks={chunks}
        onPreviewFailure={() => void handlePreviewFailure()}
        preview={effectivePreview}
        title={detail.title}
      />
    </Suspense>
  );
  const hasPreviewContent = effectivePreview.mode === 'chunks'
    ? chunks.length > 0
    : effectivePreview.mode !== 'unsupported' && Boolean(effectivePreview.viewerUrl);
  const canEnterKnowledge = (
    viewAccess?.accessSource !== 'approval_grant'
    && detail.accessSource !== 'approval_grant'
  );

  return wrap(
    <div className={s.container}>
        {embed ? null : (
          <div className={`${s.topBar} ${hideBack ? s.topBarEnd : ''}`}>
            {hideBack ? null : (
              <Link to={backTarget} className={s.backLink}>
                <ArrowLeft size={16} />
                返回列表
              </Link>
            )}
            <span className={s.sourceLabel}>来源：{detail.space.name}</span>
          </div>
        )}

        <div className={s.card}>
          <div className={s.titleRow}>
            <h1 className={s.title} title={detail.title}>
              {detail.title}
            </h1>
            {canEnterKnowledge ? (
              <button
                type="button"
                className={s.readAssistBtn}
                onClick={() => {
                  if (window.parent !== window) {
                    window.parent.postMessage(
                      {
                        type: 'OPEN_KNOWLEDGE_READ',
                        spaceId,
                        fileId,
                        fileName: knowledgeFileName,
                        openChat: true,
                      },
                      window.location.origin,
                    );
                  } else {
                    navigate(buildKnowledgeFileDeepLinkPath({
                      spaceId,
                      fileId,
                      fileName: knowledgeFileName,
                      openChat: true,
                    }));
                  }
                }}
              >
                进入知识库
              </button>
            ) : null}
          </div>
          <div className={s.metaGrid}>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>文件大小</span>
              <span className={s.metaValue}>{detail.sizeLabel || '—'}</span>
            </div>
            <div className={s.metaItem}>
              <span className={s.metaLabel}>标签</span>
              <div className={s.metaTags}>
                {displayTags.length > 0
                  ? displayTags.map((t) => <TagPill key={t.tag_name} name={t.tag_name} neutral />)
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
            {canPreview && user ? (
              hasPreviewContent ? (
                <PreviewWatermark key={previewUserKey} user={user}>
                  {previewContent}
                </PreviewWatermark>
              ) : previewContent
            ) : (
              <div className={s.previewLoginRequired} role="status">
                <strong>登录后预览</strong>
                <span>登录后可查看文档正文，文件信息与 AI 概览仍可继续浏览。</span>
                <button
                  type="button"
                  className={s.previewLoginLink}
                  onClick={() => triggerLoginRedirect(`${location.pathname}${location.search}`, { guest: true })}
                >
                  去登录
                </button>
              </div>
            )}
          </div>
          {canDownload ? (
            <div className={s.downloadArea}>
              {downloadError ? <span className={s.downloadError}>{downloadError}</span> : null}
              <div className={s.downloadBar}>
                <button
                  type="button"
                  className={s.downloadBtn}
                  disabled={downloadPending}
                  aria-busy={downloadPending}
                  onClick={() => void handleDownload()}
                >
                  {downloadPending ? <Loader2 size={16} className={s.downloadSpinner} /> : <Download size={16} />}
                  {downloadPending ? '正在生成 PDF' : '下载 PDF'}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {related.length > 0 && (
          <div className={s.relatedSection}>
            <SectionHeader icon={Star} title="相关推荐" />
            <div className={s.relatedGrid}>
              {related.map((f) => {
                const rTags = (f.tag_infos ?? []).filter((t) => !META_TAGS.includes(t.tag_name));
                return (
                  <div
                    key={f.id}
                    className={s.relatedCard}
                    onClick={() =>
                      navigate(`/space/${f.spaceId}/file/${f.id}?entry_point=detail`, {
                        state: { returnTo: `${location.pathname}${location.search}` },
                      })}
                  >
                    <div className={s.relatedTitle}>{f.title}</div>
                    <div className={s.relatedSummary}>{f.summary}</div>
                    <div className={s.relatedTags}>
                      {rTags.map((t) => <TagPill key={t.tag_name} name={t.tag_name} neutral />)}
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
