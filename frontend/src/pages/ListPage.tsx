import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import DocumentTypeFilterDropdown from '../components/DocumentTypeFilterDropdown';
import {
  fetchAggregatedTags,
  fetchKnowledgeSpaces,
  fetchSpaceTags,
  searchFiles,
  type FileItem,
  type KnowledgeSpace,
} from '../api/content';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';
// import { useShareDocument } from '../hooks/useShareDocument';
import { useDocumentQa } from '../hooks/useDocumentQa';
import { useListControls } from '../hooks/useListControls';
import { resolveListContext } from '../utils/listPageContext';
import { getRuntimeDocumentTypeGroups, normalizeDocumentTypeCode } from '../utils/documentTypes';
import {
  getBusinessDomainFilterOptions,
  normalizeBusinessDomainCode,
} from '../utils/businessDomains';
import {
  buildDownloadFileName,
  openFileDownloadUrl,
  resolveFileDownloadUrl,
} from '../utils/fileDownload';
import { recordFileDownloadEvent } from '../api/content';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import { buildGuestLoginPath } from '../utils/guestAccess';
import s from './ListPage.module.css';

const EMPTY_SPACE_IDS: number[] = [];
const LATEST_SELECTED_RECOMMENDATION = 'latest_selected';
const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队知识库' },
  { value: 'personal', label: '个人知识库' },
];

type SpaceOption = Pick<KnowledgeSpace, 'id' | 'name' | 'spaceLevel'>;

export default function ListPage() {
  const { spaceId: spaceIdStr, domainName } = useParams<{ spaceId?: string; domainName?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { params, resultsTopRef, setFilter, setFilters, setParams } = useListControls();
  const { config, error: configError } = usePortalConfig();
  const tagParam = params.get('tag') || '';
  const filterTag = params.get('filter_tag') || '';
  const titleParam = params.get('title') || '';
  const recommendationParam = params.get('recommendation') || '';
  const spaceLevel = params.get('space_level') || '';
  const selectedSpaceFilter = params.get('space_id') || '';
  const fileExt = params.get('file_ext') || '';
  const businessDomainFilter = normalizeBusinessDomainCode(params.get('business_domain_code'));
  const documentType = normalizeDocumentTypeCode(params.get('document_type'));
  const fileSubcategoryCode = normalizeDocumentTypeCode(params.get('file_subcategory_code'));
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [visibleSpaces, setVisibleSpaces] = useState<SpaceOption[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const pageLimit = displayConfig.list.pageSize;
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
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
  const businessDomainCode = listContext?.businessDomainCode ?? '';
  const isDomainList = listContext?.mode === 'domain';
  const isGlobalList = listContext?.mode === 'global';
  const showBusinessDomainFilter = Boolean(isGlobalList && (recommendationParam || tagParam || titleParam));
  const selectedSpaceFilterId = Number(selectedSpaceFilter);
  const documentTypeGroups = useMemo(
    () => getRuntimeDocumentTypeGroups(config?.document_types),
    [config?.document_types],
  );
  const businessDomainOptions = useMemo(
    () => getBusinessDomainFilterOptions(config?.domains),
    [config?.domains],
  );

  useEffect(() => {
    if (!user) {
      setVisibleSpaces([]);
      return;
    }
    let active = true;
    void fetchKnowledgeSpaces()
      .then((res) => {
        if (!active) return;
        setVisibleSpaces(res.data.map((sp) => ({ id: sp.id, name: sp.name, spaceLevel: sp.spaceLevel })));
      })
      .catch(() => {
        if (active) setVisibleSpaces([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const spaceOptions = useMemo<SpaceOption[]>(() => {
    const contextSpaceIds = new Set<number>();
    if (isDomainList) {
      for (const id of spaceIds) contextSpaceIds.add(id);
    } else if (spaceId) {
      contextSpaceIds.add(spaceId);
    }

    const byId = new Map<number, SpaceOption>();
    for (const sp of visibleSpaces) {
      if (contextSpaceIds.size > 0 && !contextSpaceIds.has(sp.id)) continue;
      byId.set(sp.id, sp);
    }
    for (const id of contextSpaceIds) {
      if (!byId.has(id)) byId.set(id, { id, name: String(id), spaceLevel: '' });
    }
    if (Number.isFinite(selectedSpaceFilterId) && selectedSpaceFilterId > 0 && !byId.has(selectedSpaceFilterId)) {
      byId.set(selectedSpaceFilterId, { id: selectedSpaceFilterId, name: String(selectedSpaceFilterId), spaceLevel: '' });
    }
    return [...byId.values()];
  }, [isDomainList, selectedSpaceFilterId, spaceId, spaceIds, visibleSpaces]);

  const spaceLevelOptions = useMemo(() => {
    const levelSet = new Set(spaceOptions.map((item) => item.spaceLevel).filter(Boolean));
    if (spaceLevel) levelSet.add(spaceLevel);
    if (levelSet.size === 0) return SPACE_LEVEL_OPTIONS;
    return SPACE_LEVEL_OPTIONS.filter((item) => levelSet.has(item.value));
  }, [spaceLevel, spaceOptions]);

  const filteredSpaceOptions = useMemo(
    () => (spaceLevel ? spaceOptions.filter((item) => item.spaceLevel === spaceLevel || !item.spaceLevel) : spaceOptions),
    [spaceLevel, spaceOptions],
  );

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

  const fetchFilePage = useCallback((cursor?: string | null) => {
    const isLatestSelectedRecommendation = recommendationParam === LATEST_SELECTED_RECOMMENDATION;
    const selectedSpaceAllowed = Number.isFinite(selectedSpaceFilterId)
      && selectedSpaceFilterId > 0
      && (!isDomainList || spaceIds.includes(selectedSpaceFilterId))
      && (!spaceId || selectedSpaceFilterId === spaceId);
    const requestedSpaceIds = selectedSpaceAllowed ? [selectedSpaceFilterId] : undefined;
    const baseParams = {
      baseTag: isLatestSelectedRecommendation ? undefined : tagParam || undefined,
      tag: filterTag || undefined,
      spaceLevel: spaceLevel || undefined,
      fileExt: fileExt || undefined,
      documentType: documentType || undefined,
      fileSubcategoryCode: fileSubcategoryCode || undefined,
      businessDomainCode: showBusinessDomainFilter ? businessDomainFilter || undefined : undefined,
      recommendation: isLatestSelectedRecommendation ? LATEST_SELECTED_RECOMMENDATION : undefined,
      sort: isLatestSelectedRecommendation ? 'portal_read_count_desc' : 'updated_at_desc',
      cursor: cursor || undefined,
      limit: pageLimit,
    };
    if (isDomainList) {
      if (spaceIds.length === 0 || !businessDomainCode) {
        return Promise.resolve({ data: [], hasMore: false, nextCursor: null });
      }
      return searchFiles({
        ...baseParams,
        spaceIds: requestedSpaceIds ?? spaceIds,
        businessDomainCode: businessDomainCode || undefined,
      });
    }
    if (spaceId) {
      return searchFiles({
        ...baseParams,
        spaceIds: requestedSpaceIds ?? [spaceId],
      });
    }
    return searchFiles({
      ...baseParams,
      spaceIds: requestedSpaceIds,
    });
  }, [
    businessDomainCode,
    businessDomainFilter,
    documentType,
    filterTag,
    fileExt,
    fileSubcategoryCode,
    isDomainList,
    pageLimit,
    recommendationParam,
    selectedSpaceFilterId,
    showBusinessDomainFilter,
    spaceId,
    spaceIds,
    spaceLevel,
    tagParam,
  ]);

  useEffect(() => {
    let active = true;
    if (!config || !listContext) return;
    void (async () => {
      try {
        if (isDomainList) {
          if (spaceIds.length === 0 || !businessDomainCode) {
            if (active) setAvailableTags([]);
            return;
          }
          const tags = await fetchAggregatedTags(spaceIds, undefined, businessDomainCode || undefined);
          if (active) setAvailableTags(tags);
          return;
        }
        if (spaceId) {
          const tags = await fetchSpaceTags(spaceId);
          if (active) setAvailableTags(tags);
          return;
        }
        const tags = await fetchAggregatedTags();
        if (active) setAvailableTags(tags);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '标签加载失败');
      }
    })();
    return () => {
      active = false;
    };
  }, [businessDomainCode, config, isDomainList, listContext, spaceId, spaceIds]);

  useEffect(() => {
    let active = true;
    if (!config || !listContext) return;
    setLoading(true);
    setLoadingMore(false);
    setError('');
    setFiles([]);
    setHasMore(false);
    setNextCursor(null);
    resultsTopRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    void (async () => {
      try {
        const result = await fetchFilePage(null);
        if (!active) return;
        setFiles(result.data);
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
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
  }, [config, fetchFilePage, listContext, resultsTopRef]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loading || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await fetchFilePage(nextCursor);
      setFiles((current) => {
        const seen = new Set(current.map((file) => `${file.spaceId}:${file.id}`));
        const appended = result.data.filter((file) => !seen.has(`${file.spaceId}:${file.id}`));
        return [...current, ...appended];
      });
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchFilePage, hasMore, loading, loadingMore, nextCursor]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void handleLoadMore();
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [handleLoadMore, hasMore, loading, loadingMore]);

  useEffect(() => {
    if (canFavorite && files.length) void loadStatuses(files);
  }, [files, canFavorite, loadStatuses]);

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
          <select
            className={s.filterSelect}
            value={spaceLevel}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('space_level', e.target.value);
              else next.delete('space_level');
              next.delete('space_id');
              next.delete('page');
              setParams(next);
            }}
          >
            <option value="">知识库类型</option>
            {spaceLevelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select className={s.filterSelect} value={selectedSpaceFilter} onChange={(e) => setFilter('space_id', e.target.value)}>
            <option value="">知识库</option>
            {filteredSpaceOptions.map((sp) => <option key={sp.id} value={String(sp.id)}>{sp.name}</option>)}
          </select>
          <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value)}>
            <option value="">文件格式</option>
            {FILE_EXT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <DocumentTypeFilterDropdown
            groups={documentTypeGroups}
            documentType={documentType}
            fileSubcategoryCode={fileSubcategoryCode}
            onChange={(next) => {
              setFilters({
                document_type: next.documentType,
                file_subcategory_code: next.fileSubcategoryCode,
              });
            }}
          />
          {showBusinessDomainFilter ? (
            <select className={s.filterSelect} value={businessDomainFilter} onChange={(e) => setFilter('business_domain_code', e.target.value)}>
              <option value="">业务域</option>
              {businessDomainOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          ) : null}
          <select className={s.filterSelect} value={filterTag} onChange={(e) => setFilter('filter_tag', e.target.value)}>
            <option value="">标签</option>
            {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className={s.fileCount}>
          已加载 {files.length} 篇文档
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
            onAsk={user ? openDocumentQa : () => navigate(buildGuestLoginPath(`${location.pathname}${location.search}`))}
            onOpen={user ? setPreviewFile : () => navigate(buildGuestLoginPath(`${location.pathname}${location.search}`))}
          />
        ))}

        <div ref={loadMoreRef} className={s.fileCount}>
          {loadingMore ? '正在加载更多...' : null}
          {!loading && !loadingMore && files.length > 0 && !hasMore ? '已加载全部文档' : null}
        </div>
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      </div>
    </PageShell>
  );
}
