import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
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
  recordPortalSearchEvent,
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
import {
  getRuntimeDocumentTypeGroups,
  normalizeDocumentTypeCode,
  normalizeTimeSort,
  TIME_SORT_OPTIONS,
} from '../utils/documentTypes';
import {
  getBusinessDomainFilterOptions,
  normalizeBusinessDomainCode,
} from '../utils/businessDomains';
import { downloadWatermarkedFile } from '../utils/fileDownload';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import { triggerLoginRedirect } from '../utils/loginRedirect';
import { createSubmittedSearchParams } from '../utils/searchParams';
import { ActionToast } from '../components/ActionToast';
import { useActionToast } from '../hooks/useActionToast';
import s from './ListPage.module.css';

const EMPTY_SPACE_IDS: number[] = [];
const LATEST_SELECTED_RECOMMENDATION = 'latest_selected';
const PERSONALIZED_RECOMMENDATION = 'personalized_v1';
const DEFAULT_PERSONALIZED_TOTAL_COUNT = 20;
const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队/科室知识库' },
  { value: 'personal', label: '个人知识库' },
];

type SpaceOption = Pick<KnowledgeSpace, 'id' | 'name' | 'spaceLevel'>;

export default function ListPage() {
  const { spaceId: spaceIdStr, domainName } = useParams<{ spaceId?: string; domainName?: string }>();
  const location = useLocation();
  const { params, resultsTopRef, setFilter, setFilters, setParams } = useListControls();
  const { config, error: configError } = usePortalConfig();
  const tagParam = params.get('tag') || '';
  const filterTag = params.get('filter_tag') || '';
  const keyword = (params.get('q') || '').trim();
  const titleParam = params.get('title') || '';
  const recommendationParam = params.get('recommendation') || '';
  const publicOnly = params.get('public_only') === 'true';
  const spaceLevel = params.get('space_level') || '';
  const selectedSpaceFilter = params.get('space_id') || '';
  const fileExt = params.get('file_ext') || '';
  const businessDomainFilter = normalizeBusinessDomainCode(params.get('business_domain_code'));
  const documentType = normalizeDocumentTypeCode(params.get('document_type'));
  const fileSubcategoryCode = normalizeDocumentTypeCode(params.get('file_subcategory_code'));
  const timeSort = normalizeTimeSort(params.get('sort'));
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [visibleSpaces, setVisibleSpaces] = useState<SpaceOption[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const isPersonalizedRecommendation = recommendationParam === PERSONALIZED_RECOMMENDATION;
  const previewRecommendationScene = isPersonalizedRecommendation
    ? PERSONALIZED_RECOMMENDATION
    : recommendationParam === LATEST_SELECTED_RECOMMENDATION
      ? LATEST_SELECTED_RECOMMENDATION
      : null;
  const configuredPersonalizedTotalCount = Number(config?.recommendation?.home_total_count);
  const personalizedTotalCount = Number.isInteger(configuredPersonalizedTotalCount)
    && configuredPersonalizedTotalCount >= 1
    && configuredPersonalizedTotalCount <= 50
    ? configuredPersonalizedTotalCount
    : DEFAULT_PERSONALIZED_TOTAL_COUNT;
  const pageLimit = isPersonalizedRecommendation
    ? personalizedTotalCount
    : displayConfig.list.pageSize;
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(keyword);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { toast, showError } = useActionToast();
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
    if (!user && !publicOnly) {
      setVisibleSpaces([]);
      return;
    }
    let active = true;
    void fetchKnowledgeSpaces({ publicOnly })
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
  }, [publicOnly, user]);

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
      await downloadWatermarkedFile({
        spaceId: file.spaceId,
        fileId: file.id,
        entryPoint: 'knowledge_list',
        title: file.title,
        ext: file.ext,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '文档下载失败';
      showError(message);
    }
  }, [showError]);

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
    setDraft(keyword);
  }, [keyword]);

  const submitSearch = useCallback(() => {
    const submitted = draft.trim();
    if (user && submitted) {
      void recordPortalSearchEvent(submitted, 'search_page').catch(() => undefined);
    }
    setParams(createSubmittedSearchParams(params, draft));
  }, [draft, params, setParams, user]);

  const clearKeyword = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('q');
    next.delete('page');
    setDraft('');
    setParams(next);
  }, [params, setParams]);

  const fetchFilePage = useCallback((cursor?: string | null) => {
    const isLatestSelectedRecommendation = recommendationParam === LATEST_SELECTED_RECOMMENDATION;
    const isRecommendationList = isLatestSelectedRecommendation || isPersonalizedRecommendation;
    const selectedSpaceAllowed = Number.isFinite(selectedSpaceFilterId)
      && selectedSpaceFilterId > 0
      && (!isDomainList || spaceIds.includes(selectedSpaceFilterId))
      && (!spaceId || selectedSpaceFilterId === spaceId);
    const requestedSpaceIds = selectedSpaceAllowed ? [selectedSpaceFilterId] : undefined;
    const hasUserFilterTag = Boolean(filterTag);
    const baseParams = {
      q: keyword || undefined,
      baseTag: !isRecommendationList && hasUserFilterTag ? tagParam || undefined : undefined,
      tag: isRecommendationList ? undefined : filterTag || tagParam || undefined,
      spaceLevel: spaceLevel || undefined,
      fileExt: fileExt || undefined,
      documentType: documentType || undefined,
      fileSubcategoryCode: fileSubcategoryCode || undefined,
      businessDomainCode: showBusinessDomainFilter ? businessDomainFilter || undefined : undefined,
      recommendation: isRecommendationList ? recommendationParam : undefined,
      publicOnly,
      sort: isPersonalizedRecommendation
        ? undefined
        : timeSort || (keyword ? 'relevance' : (isLatestSelectedRecommendation ? 'portal_read_count_desc' : 'updated_at_desc')),
      cursor: isPersonalizedRecommendation ? undefined : cursor || undefined,
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
    keyword,
    isDomainList,
    isPersonalizedRecommendation,
    pageLimit,
    publicOnly,
    recommendationParam,
    selectedSpaceFilterId,
    showBusinessDomainFilter,
    spaceId,
    spaceIds,
    spaceLevel,
    tagParam,
    timeSort,
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
        const tags = await fetchAggregatedTags(undefined, undefined, undefined, publicOnly);
        if (active) setAvailableTags(tags);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '标签加载失败');
      }
    })();
    return () => {
      active = false;
    };
  }, [businessDomainCode, config, isDomainList, listContext, publicOnly, spaceId, spaceIds]);

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
        setHasMore(isPersonalizedRecommendation ? false : result.hasMore);
        setNextCursor(isPersonalizedRecommendation ? null : result.nextCursor);
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
  }, [config, fetchFilePage, isPersonalizedRecommendation, listContext, resultsTopRef]);

  const handleLoadMore = useCallback(async () => {
    if (isPersonalizedRecommendation || !hasMore || !nextCursor || loading || loadingMore) return;
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
  }, [fetchFilePage, hasMore, isPersonalizedRecommendation, loading, loadingMore, nextCursor]);

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
      <ActionToast toast={toast} />
      <div className={s.container}>
        <div ref={resultsTopRef} />
        <Link to="/" className={s.backLink}>
          <ArrowLeft size={16} />
          返回首页
        </Link>

        <h1 className={s.pageTitle}>{pageTitle}</h1>

        <div className={s.listSearchBar}>
          <div className={s.listSearchInputWrap}>
            <Search size={18} className={s.listSearchIcon} />
            <input
              className={s.listSearchInput}
              placeholder={`在「${pageTitle}」内搜索`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch();
              }}
              aria-label="列表关键词搜索"
            />
            {keyword ? (
              <button type="button" className={s.listSearchClear} onClick={clearKeyword}>
                清除
              </button>
            ) : null}
            <button type="button" className={s.listSearchBtn} onClick={submitSearch}>
              搜索
            </button>
          </div>
        </div>

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
          {/* Business-domain entry has its own scope: hide the file-format filter there. */}
          {!isDomainList && (
            <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value)}>
              <option value="">文件格式</option>
              {FILE_EXT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
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
          <select
            className={s.filterSelect}
            value={timeSort}
            onChange={(e) => setFilter('sort', e.target.value)}
            aria-label="按更新时间排序"
          >
            <option value="">时间排序</option>
            {TIME_SORT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>

        <div className={s.fileCount}>
          {keyword ? `共找到 ${files.length} 篇相关文档` : `已加载 ${files.length} 篇文档`}
        </div>

        {error ? <div className={s.fileCount}>{error}</div> : null}
        {loading ? <div className={s.fileCount}>正在加载列表...</div> : null}
        {!loading && keyword && files.length === 0 ? (
          <div className={s.fileCount}>当前列表下未找到包含「{keyword}」的文档</div>
        ) : null}

        {!loading && files.map((f) => (
          <FileListItem
            key={f.id}
            file={f}
            highlightQuery={keyword || undefined}
            visibleTagCount={displayConfig.list.visibleTagCount}
            onFavorite={canFavorite ? handleToggleFavorite : undefined}
            favorited={isFavorited(f.spaceId, f.id)}
            favoritePending={pending(f.spaceId, f.id)}
            onDownload={canDownload && (!f.isDepartmentFile || f.canDownload) ? handleDownload : undefined}
            // onShare={openShare}
            onAsk={user ? openDocumentQa : () => triggerLoginRedirect(`${location.pathname}${location.search}`, { guest: true })}
            onOpen={user ? setPreviewFile : () => triggerLoginRedirect(`${location.pathname}${location.search}`, { guest: true })}
          />
        ))}

        <div ref={loadMoreRef} className={s.fileCount}>
          {loadingMore ? '正在加载更多...' : null}
          {!loading && !loadingMore && files.length > 0 && !hasMore ? '已加载全部文档' : null}
        </div>
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal
          file={previewFile}
          context={{
            entryPoint: recommendationParam ? 'recommendation_list' : 'knowledge_space',
            recommendationScene: previewRecommendationScene,
          }}
          onClose={() => setPreviewFile(null)}
        />
      </div>
    </PageShell>
  );
}
