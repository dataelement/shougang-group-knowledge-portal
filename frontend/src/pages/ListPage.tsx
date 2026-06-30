import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import Pagination from '../components/Pagination';
import {
  fetchAggregatedTags,
  fetchSpaceFiles,
  fetchSpaceTags,
  searchFiles,
  type FileItem,
} from '../api/content';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';
// import { useShareDocument } from '../hooks/useShareDocument';
import { useDocumentQa } from '../hooks/useDocumentQa';
import { useListControls } from '../hooks/useListControls';
import { getVisibleRange } from '../utils/listControls';
import { resolveListContext } from '../utils/listPageContext';
import { getRuntimeDocumentTypes, normalizeDocumentTypeCode } from '../utils/documentTypes';
import {
  buildDownloadFileName,
  openFileDownloadUrl,
  resolveFileDownloadUrl,
} from '../utils/fileDownload';
import { recordFileDownloadEvent } from '../api/content';
import { getEnabledSpaces, toRuntimeDisplayConfig } from '../utils/portalConfig';
import s from './ListPage.module.css';

const EMPTY_SPACE_IDS: number[] = [];

export default function ListPage() {
  const { spaceId: spaceIdStr, domainName } = useParams<{ spaceId?: string; domainName?: string }>();
  const { params, page, resultsTopRef, setFilter } = useListControls();
  const { config, error: configError } = usePortalConfig();
  const tagParam = params.get('tag') || '';
  const titleParam = params.get('title') || '';
  const fileExt = params.get('file_ext') || '';
  const documentType = normalizeDocumentTypeCode(params.get('document_type'));
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [total, setTotal] = useState(0);
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [pageSize, setPageSize] = useState<number>(displayConfig.list.pageSize);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const { loadStatuses, isFavorited, toggleFavorite, pending } = useFavoriteDocument();
  // const { openShare, shareModalProps } = useShareDocument();
  const { openDocumentQa, documentQaModalProps } = useDocumentQa();
  const canDownload = Boolean(user);
  const canFavorite = Boolean(user);
  const listContext = useMemo(() => (
    config ? resolveListContext(config, domainName, spaceIdStr, tagParam, titleParam) : undefined
  ), [config, domainName, spaceIdStr, tagParam, titleParam]);
  const pageTitle = listContext?.pageTitle ?? '知识列表';
  const spaceId = listContext?.spaceId;
  const spaceIds = listContext?.spaceIds ?? EMPTY_SPACE_IDS;
  const isDomainList = listContext?.mode === 'domain';
  const documentTypes = useMemo(() => getRuntimeDocumentTypes(config?.document_types), [config?.document_types]);

  const handleDownload = useCallback(async (file: FileItem) => {
    setError('');
    try {
      const downloadUrl = await resolveFileDownloadUrl(file);
      if (!downloadUrl) {
        setError('该文档暂不可下载');
        return;
      }
      openFileDownloadUrl(downloadUrl, buildDownloadFileName(file));
      void recordFileDownloadEvent(file.spaceId, file.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载链接获取失败');
    }
  }, []);

  const handleToggleFavorite = useCallback(async (file: FileItem) => {
    setError('');
    try {
      await toggleFavorite(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : '收藏操作失败');
    }
  }, [toggleFavorite]);

  useEffect(() => {
    if (!configError) return;
    setError(configError);
  }, [configError]);

  useEffect(() => {
    let active = true;
    if (!config || !listContext) return;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        if (isDomainList) {
          if (spaceIds.length === 0) {
            if (!active) return;
            setFiles([]);
            setTotal(0);
            setPageSize(displayConfig.list.pageSize);
            setAvailableTags([]);
            return;
          }
          const [result, tags] = await Promise.all([
            searchFiles({
              spaceIds,
              fileExt: fileExt || undefined,
              documentType: documentType || undefined,
              tag: tagParam || undefined,
              sort: 'updated_at_desc',
              page,
              pageSize: displayConfig.list.pageSize,
            }),
            fetchAggregatedTags(spaceIds),
          ]);
          if (!active) return;
          setFiles(result.data);
          setTotal(result.total);
          setPageSize(result.pageSize);
          setAvailableTags(tags);
        } else if (spaceId) {
          const [result, tags] = await Promise.all([
            fetchSpaceFiles({
              spaceId,
              fileExt: fileExt || undefined,
              documentType: documentType || undefined,
              tag: tagParam || undefined,
              page,
              pageSize: displayConfig.list.pageSize,
            }),
            fetchSpaceTags(spaceId),
          ]);
          if (!active) return;
          setFiles(result.data);
          setTotal(result.total);
          setPageSize(result.pageSize);
          setAvailableTags(tags);
        } else {
          const [result, tags] = await Promise.all([
            searchFiles({
              tag: tagParam || undefined,
              fileExt: fileExt || undefined,
              documentType: documentType || undefined,
              page,
              pageSize: displayConfig.list.pageSize,
            }),
            fetchAggregatedTags(getEnabledSpaces(config.spaces).map((item) => item.id)),
          ]);
          if (!active) return;
          setFiles(result.data);
          setTotal(result.total);
          setPageSize(result.pageSize);
          setAvailableTags(tags);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '列表加载失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [config, displayConfig.list.pageSize, documentType, fileExt, isDomainList, listContext, page, spaceId, spaceIds, tagParam]);

  useEffect(() => {
    if (canFavorite && files.length) void loadStatuses(files);
  }, [files, canFavorite, loadStatuses]);

  const visibleRange = getVisibleRange(total, page, pageSize, files.length);

  return (
    <PageShell>
      <div className={s.container}>
        <div ref={resultsTopRef} />
        <Link to="/" className={s.backLink}>
          <ArrowLeft size={16} />
          返回首页
        </Link>

        <h1 className={s.pageTitle}>{pageTitle}</h1>

        <div className={s.filterBar}>
          <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value)}>
            <option value="">文件格式</option>
            {FILE_EXT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={s.filterSelect} value={documentType} onChange={(e) => setFilter('document_type', e.target.value)}>
            <option value="">文件分类</option>
            {documentTypes.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <select className={s.filterSelect} value={tagParam} onChange={(e) => setFilter('tag', e.target.value)}>
            <option value="">标签</option>
            {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className={s.fileCount}>
          共 {total} 篇文档
          {total > 0 ? `，当前显示 ${visibleRange.start}-${visibleRange.end} 篇` : ''}
        </div>

        {error ? <div className={s.fileCount}>{error}</div> : null}
        {loading ? <div className={s.fileCount}>正在加载列表...</div> : null}

        {!loading && files.map((f) => (
          <FileListItem
            key={f.id}
            file={f}
            visibleTagCount={displayConfig.list.visibleTagCount}
            onFavorite={canFavorite ? handleToggleFavorite : undefined}
            favorited={isFavorited(f.spaceId, f.id)}
            favoritePending={pending(f.spaceId, f.id)}
            onDownload={canDownload ? handleDownload : undefined}
            // onShare={openShare}
            onAsk={openDocumentQa}
            onOpen={setPreviewFile}
          />
        ))}

        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onChange={(nextPage) => setFilter('page', String(nextPage), false)}
        />
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      </div>
    </PageShell>
  );
}
