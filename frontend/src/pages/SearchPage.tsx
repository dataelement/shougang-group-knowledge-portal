import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2, ChevronUp, ChevronDown, X } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import DocumentTypeFilterDropdown from '../components/DocumentTypeFilterDropdown';
import AdvancedSearchPanel from '../components/AdvancedSearchPanel';
import {
  advancedSearchFiles,
  browseSearchFiles,
  fetchDepartmentFileViewAccess,
  fetchAggregatedTags,
  fetchKnowledgeSpaces,
  recordPortalSearchEvent,
  searchKeywordFiles,
  streamChatCompletion,
  type Citation,
  type FileItem,
} from '../api/content';
import { renderChatMarkdown } from '../utils/chatMessage';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';
import { useDocumentQa } from '../hooks/useDocumentQa';
import { useListControls } from '../hooks/useListControls';
import {
  findRuntimeDocumentTypeChild,
  getDocumentTypeCodeFromFileEncoding,
  getRuntimeDocumentTypeGroups,
  normalizeDocumentTypeCode,
  normalizeSearchSort,
  normalizeTimeSort,
  type RuntimeDocumentTypeGroupOption,
  SEARCH_SORT_OPTIONS,
  TIME_SORT_OPTIONS,
} from '../utils/documentTypes';
import {
  getBusinessDomainCodeFromFileEncoding,
  getBusinessDomainFilterOptions,
  normalizeBusinessDomainCode,
} from '../utils/businessDomains';
import { downloadWatermarkedFile } from '../utils/fileDownload';
import { resolveFileActionAccess } from '../utils/fileActionAccess';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import {
  createSubmittedSearchParams,
  getSearchDisplayKeyword,
} from '../utils/searchParams';
import {
  ADVANCED_SEARCH_ENABLED,
  applyAdvancedSearchForm,
  buildAdvancedRetrievalQuery,
  clearAdvancedSearchConditions,
  EMPTY_ADVANCED_SEARCH_FORM,
  getAdvancedSearchForm,
  isAdvancedSearchOpen,
  type AdvancedSearchForm,
} from '../utils/advancedSearch';
import { ActionToast } from '../components/ActionToast';
import { useActionToast } from '../hooks/useActionToast';
import searchHeroBg from '../assets/search-hero-bg@2x.png';
import s from './SearchPage.module.css';

type SpaceOption = {
  id: number;
  name: string;
  spaceLevel: string;
};

const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队/科室知识库' },
  { value: 'personal', label: '个人知识库' },
];

const DEFAULT_SEARCH_PAGE_SIZE = 10;

function normalizeFileExt(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '');
}

function addStringOption(target: Set<string>, value: string) {
  const normalized = value.trim();
  if (normalized) target.add(normalized);
}

function getFileSpaceLevel(file: FileItem, spaceById: Map<number, SpaceOption>): string {
  return (file.spaceLevel || spaceById.get(file.spaceId)?.spaceLevel || '').trim();
}

function getFileDocumentTypeCode(file: FileItem, groups: RuntimeDocumentTypeGroupOption[]): string {
  const encodingDocumentType = getDocumentTypeCodeFromFileEncoding(file.fileEncoding);
  if (encodingDocumentType) return encodingDocumentType;
  return findRuntimeDocumentTypeChild(groups, file.fileSubcategoryCode || '')?.parentCode ?? '';
}

function matchesLocalSearchFilters(
  file: FileItem,
  filters: {
    spaceLevel: string;
    spaceId: string;
    fileExt: string;
    documentType: string;
    fileSubcategoryCode: string;
    businessDomainCode: string;
    tag: string;
  },
  context: {
    spaceById: Map<number, SpaceOption>;
    documentTypeGroups: RuntimeDocumentTypeGroupOption[];
  },
): boolean {
  if (filters.spaceLevel && getFileSpaceLevel(file, context.spaceById) !== filters.spaceLevel) return false;
  if (filters.spaceId && file.spaceId !== Number(filters.spaceId)) return false;
  if (filters.fileExt && normalizeFileExt(file.ext) !== normalizeFileExt(filters.fileExt)) return false;
  if (filters.businessDomainCode && getBusinessDomainCodeFromFileEncoding(file.fileEncoding) !== filters.businessDomainCode) return false;
  if (filters.tag && !file.tags.some((item) => item === filters.tag)) return false;
  if (filters.documentType) {
    const fileDocumentType = getFileDocumentTypeCode(file, context.documentTypeGroups);
    if (fileDocumentType !== filters.documentType) return false;
  }
  if (filters.fileSubcategoryCode) {
    if (normalizeDocumentTypeCode(file.fileSubcategoryCode) !== filters.fileSubcategoryCode) return false;
  }
  return true;
}

export default function SearchPage() {
  const { params, resultsTopRef, setFilter, setFilters, setParams } = useListControls();
  const q = params.get('q') || '';
  const displayKeyword = getSearchDisplayKeyword(params);
  const [draft, setDraft] = useState(displayKeyword);
  const spaceLevel = params.get('space_level') || '';
  const spaceId = params.get('space_id') || '';
  const fileExt = params.get('file_ext') || '';
  const documentType = normalizeDocumentTypeCode(params.get('document_type'));
  const fileSubcategoryCode = normalizeDocumentTypeCode(params.get('file_subcategory_code'));
  const businessDomainCode = normalizeBusinessDomainCode(params.get('business_domain_code'));
  const tag = params.get('tag') || '';
  const updatedFrom = params.get('updated_from') || '';
  const updatedTo = params.get('updated_to') || '';
  const allKeywords = params.get('all_keywords') || '';
  const exactPhrase = params.get('exact_phrase') || '';
  const anyKeywords = params.get('any_keywords') || '';
  const excludeKeywords = params.get('exclude_keywords') || '';
  const searchField = params.get('search_field') || 'file_name';
  const advancedSearchOpen = ADVANCED_SEARCH_ENABLED && isAdvancedSearchOpen(params);
  const advancedMode = params.has('search_field');
  const keywordMode = Boolean(q.trim()) && !advancedMode;
  const keywordSort = normalizeSearchSort(params.get('sort'));
  const browseSort = normalizeTimeSort(params.get('sort')) || 'updated_at_desc';
  const sort = keywordMode ? keywordSort : browseSort;
  const { config } = usePortalConfig();
  const { user } = useAuth();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const configuredPageSize = Number(displayConfig.search.pageSize);
  const pageLimit = configuredPageSize >= 1 && configuredPageSize <= 100
    ? configuredPageSize
    : DEFAULT_SEARCH_PAGE_SIZE;
  const [visibleSpaces, setVisibleSpaces] = useState<SpaceOption[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [rawFiles, setRawFiles] = useState<FileItem[]>([]);
  const [rawTotal, setRawTotal] = useState(0);
  const [resultsReady, setResultsReady] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(pageLimit);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const [advancedSearchDraft, setAdvancedSearchDraft] = useState<AdvancedSearchForm>(
    () => getAdvancedSearchForm(params, q),
  );
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [total, setTotal] = useState(0);
  const [aiText, setAiText] = useState('');
  const [aiCitations, setAiCitations] = useState<Citation[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiRetryStatus, setAiRetryStatus] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiRetryKey, setAiRetryKey] = useState(0);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentSearchParams = params.toString();
  const requestSeq = useRef(0);
  const latestSearchRequestRef = useRef(0);
  const searchPendingRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { toast, showError } = useActionToast();
  const { loadStatuses, isFavorited, toggleFavorite, pending } = useFavoriteDocument();
  const { documentQaModalProps } = useDocumentQa();
  const canDownload = Boolean(user);
  const canFavorite = Boolean(user);

  const handleDownload = useCallback(async (file: FileItem) => {
    setError('');
    try {
      const access = await resolveFileActionAccess(
        file,
        'download',
        fetchDepartmentFileViewAccess,
      );
      if (access.outcome === 'show_access_gate') {
        setPreviewFile(file);
        return;
      }
      if (access.outcome === 'download_denied') {
        showError('当前账号没有下载该文档的权限');
        return;
      }
      await downloadWatermarkedFile({
        spaceId: file.spaceId,
        fileId: file.id,
        entryPoint: 'search',
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
      const access = await resolveFileActionAccess(
        file,
        'favorite',
        fetchDepartmentFileViewAccess,
      );
      if (access.outcome === 'show_access_gate') {
        setPreviewFile(file);
        return;
      }
      await toggleFavorite(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : '收藏操作失败');
    }
  }, [toggleFavorite]);

  useEffect(() => {
    setDraft(displayKeyword);
  }, [displayKeyword]);

  useEffect(() => {
    setAdvancedSearchDraft(getAdvancedSearchForm(new URLSearchParams(currentSearchParams), q));
  }, [currentSearchParams, q]);

  // 后端会按当前身份返回登录用户可见空间或访客公共空间。
  useEffect(() => {
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

  // 搜索页空间元数据由后端按当前身份裁剪，关键词模式仍可从结果补充来源名称。
  const searchSpaces = useMemo<SpaceOption[]>(() => {
    const byId = new Map<number, SpaceOption>();
    for (const sp of visibleSpaces) {
      if (!byId.has(sp.id)) byId.set(sp.id, sp);
    }
    return [...byId.values()];
  }, [visibleSpaces]);

  const spaceById = useMemo(() => new Map(searchSpaces.map((sp) => [sp.id, sp])), [searchSpaces]);
  const selectedSpaceId = Number(spaceId);
  const documentTypeGroups = useMemo(
    () => getRuntimeDocumentTypeGroups(config?.document_types),
    [config?.document_types],
  );
  const configuredBusinessDomainOptions = useMemo(
    () => getBusinessDomainFilterOptions(config?.domains),
    [config?.domains],
  );

  const resultDocumentTypeGroups = useMemo(() => {
    if (!keywordMode) return documentTypeGroups;
    const parentCodes = new Set<string>();
    const childCodesByParent = new Map<string, Set<string>>();
    for (const file of rawFiles) {
      const parentCode = getFileDocumentTypeCode(file, documentTypeGroups);
      const childCode = normalizeDocumentTypeCode(file.fileSubcategoryCode);
      if (parentCode) parentCodes.add(parentCode);
      if (parentCode && childCode) {
        const childCodes = childCodesByParent.get(parentCode) ?? new Set<string>();
        childCodes.add(childCode);
        childCodesByParent.set(parentCode, childCodes);
      }
    }
    if (documentType) parentCodes.add(documentType);
    if (fileSubcategoryCode) {
      const selectedChild = findRuntimeDocumentTypeChild(documentTypeGroups, fileSubcategoryCode);
      const parentCode = selectedChild?.parentCode || documentType;
      if (parentCode) {
        parentCodes.add(parentCode);
        const childCodes = childCodesByParent.get(parentCode) ?? new Set<string>();
        childCodes.add(fileSubcategoryCode);
        childCodesByParent.set(parentCode, childCodes);
      }
    }

    const configuredGroups = documentTypeGroups.flatMap((group) => {
      const children = group.children.filter((child) => childCodesByParent.get(group.code)?.has(child.code));
      if (!parentCodes.has(group.code) && children.length === 0) return [];
      return [{ ...group, children }];
    });
    const configuredCodes = new Set(documentTypeGroups.map((group) => group.code));
    const unconfiguredGroups = [...parentCodes]
      .filter((code) => !configuredCodes.has(code))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((code) => ({
        code,
        label: code,
        children: [...(childCodesByParent.get(code) ?? new Set<string>())]
          .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
          .map((childCode) => ({
            code: childCode,
            label: childCode,
            parentCode: code,
            parentLabel: code,
          })),
      }));
    return [...configuredGroups, ...unconfiguredGroups];
  }, [documentType, documentTypeGroups, fileSubcategoryCode, keywordMode, rawFiles]);

  const resultBusinessDomainOptions = useMemo(() => {
    if (!keywordMode) return configuredBusinessDomainOptions;
    const domainCodes = new Set<string>();
    for (const file of rawFiles) {
      const code = getBusinessDomainCodeFromFileEncoding(file.fileEncoding);
      if (code) domainCodes.add(code);
    }
    if (businessDomainCode) domainCodes.add(businessDomainCode);

    const configuredOptions = configuredBusinessDomainOptions.filter((item) => domainCodes.delete(item.code));
    const unconfiguredOptions = [...domainCodes]
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((code) => ({ code, label: code }));
    return [...configuredOptions, ...unconfiguredOptions];
  }, [businessDomainCode, configuredBusinessDomainOptions, keywordMode, rawFiles]);

  const filteredFiles = useMemo(() => {
    if (!resultsReady) return [];
    return rawFiles.filter((file) => matchesLocalSearchFilters(
      file,
      {
        spaceLevel,
        spaceId,
        fileExt,
        documentType,
        fileSubcategoryCode,
        businessDomainCode,
        tag,
      },
      {
        spaceById,
        documentTypeGroups,
      },
    ));
  }, [
    businessDomainCode,
    documentType,
    documentTypeGroups,
    fileExt,
    fileSubcategoryCode,
    rawFiles,
    resultsReady,
    spaceById,
    spaceId,
    spaceLevel,
    tag,
  ]);

  const resultSpaceLevelOptions = useMemo(() => {
    if (!keywordMode) {
      const visibleLevels = new Set(visibleSpaces.map((space) => space.spaceLevel).filter(Boolean));
      addStringOption(visibleLevels, spaceLevel);
      return SPACE_LEVEL_OPTIONS.filter((item) => visibleLevels.has(item.value));
    }
    const levelSet = new Set<string>();
    for (const file of rawFiles) {
      addStringOption(levelSet, getFileSpaceLevel(file, spaceById));
    }
    addStringOption(levelSet, spaceLevel);
    return SPACE_LEVEL_OPTIONS.filter((item) => levelSet.has(item.value));
  }, [keywordMode, rawFiles, spaceById, spaceLevel, visibleSpaces]);

  const resultSpaceOptions = useMemo<SpaceOption[]>(() => {
    if (!keywordMode) {
      return visibleSpaces.filter((space) => !spaceLevel || !space.spaceLevel || space.spaceLevel === spaceLevel);
    }
    const optionIds: number[] = [];
    const seen = new Set<number>();
    const resultSpaceNames = new Map<number, string>();
    const resultSpaceLevels = new Map<number, string>();
    const addSpaceId = (id: number) => {
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
      seen.add(id);
      optionIds.push(id);
    };
    for (const file of rawFiles) {
      addSpaceId(file.spaceId);
      if (file.source) resultSpaceNames.set(file.spaceId, file.source);
      if (file.spaceLevel) resultSpaceLevels.set(file.spaceId, file.spaceLevel);
    }
    addSpaceId(selectedSpaceId);
    return optionIds.map((id) => (
      spaceById.get(id) ?? {
        id,
        name: resultSpaceNames.get(id) ?? String(id),
        spaceLevel: resultSpaceLevels.get(id) ?? '',
      }
    ));
  }, [keywordMode, rawFiles, selectedSpaceId, spaceById, spaceLevel, visibleSpaces]);

  const resultFileExtOptions = useMemo(() => {
    if (!keywordMode) {
      const options = new Set<string>(FILE_EXT_OPTIONS);
      addStringOption(options, normalizeFileExt(fileExt));
      return [...options];
    }
    const extSet = new Set<string>();
    for (const file of rawFiles) {
      addStringOption(extSet, normalizeFileExt(file.ext));
    }
    addStringOption(extSet, normalizeFileExt(fileExt));
    const knownOptions = FILE_EXT_OPTIONS.filter((item) => extSet.has(item));
    const customOptions = [...extSet]
      .filter((item) => !FILE_EXT_OPTIONS.includes(item as (typeof FILE_EXT_OPTIONS)[number]))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return [...knownOptions, ...customOptions];
  }, [fileExt, keywordMode, rawFiles]);

  const resultTagOptions = useMemo(() => {
    if (!keywordMode) {
      const options = new Set(availableTags);
      addStringOption(options, tag);
      return [...options].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    }
    const tagSet = new Set<string>();
    for (const file of rawFiles) {
      for (const item of file.tags) addStringOption(tagSet, item);
    }
    addStringOption(tagSet, tag);
    return [...tagSet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [availableTags, keywordMode, rawFiles, tag]);

  useEffect(() => {
    if (keywordMode || params.get('sort') === browseSort) return;
    setFilter('sort', browseSort, false);
  }, [browseSort, keywordMode, params, setFilter]);

  useEffect(() => {
    if (keywordMode) return;
    let active = true;
    const selectedId = Number(spaceId);
    void fetchAggregatedTags(
      Number.isFinite(selectedId) && selectedId > 0 ? [selectedId] : undefined,
      spaceLevel || undefined,
      businessDomainCode || undefined,
    ).then((tags) => {
      if (active) setAvailableTags(tags);
    }).catch(() => {
      if (active) setAvailableTags([]);
    });
    return () => {
      active = false;
    };
  }, [businessDomainCode, keywordMode, spaceId, spaceLevel]);

  const fetchDatabasePage = useCallback((cursor?: string | null) => {
    const selectedId = Number(spaceId);
    if (advancedMode) {
      return advancedSearchFiles({
        tag: tag || undefined,
        spaceIds: Number.isFinite(selectedId) && selectedId > 0 ? [selectedId] : undefined,
        spaceLevel: spaceLevel || undefined,
        fileExt: fileExt || undefined,
        documentType: documentType || undefined,
        fileSubcategoryCode: fileSubcategoryCode || undefined,
        businessDomainCode: businessDomainCode || undefined,
        allKeywords: allKeywords || undefined,
        exactPhrase: exactPhrase || undefined,
        anyKeywords: anyKeywords || undefined,
        excludeKeywords: excludeKeywords || undefined,
        searchField: searchField === 'summary' || searchField === 'tags' ? searchField : 'file_name',
        updatedFrom: updatedFrom || undefined,
        updatedTo: updatedTo || undefined,
        sort: browseSort,
        cursor,
        limit: pageLimit,
      });
    }
    return browseSearchFiles({
      tag: tag || undefined,
      spaceIds: Number.isFinite(selectedId) && selectedId > 0 ? [selectedId] : undefined,
      spaceLevel: spaceLevel || undefined,
      fileExt: fileExt || undefined,
      documentType: documentType || undefined,
      fileSubcategoryCode: fileSubcategoryCode || undefined,
      businessDomainCode: businessDomainCode || undefined,
      sort: browseSort,
      cursor,
      limit: pageLimit,
    });
  }, [
    advancedMode,
    allKeywords,
    anyKeywords,
    browseSort,
    businessDomainCode,
    documentType,
    exactPhrase,
    excludeKeywords,
    fileExt,
    fileSubcategoryCode,
    pageLimit,
    searchField,
    spaceId,
    spaceLevel,
    tag,
    updatedFrom,
    updatedTo,
  ]);

  useEffect(() => {
    if (!keywordMode) return;
    const currentRequest = ++requestSeq.current;
    latestSearchRequestRef.current = currentRequest;
    searchPendingRef.current = true;
    setLoading(true);
    setResultsReady(false);
    setError('');
    setLoadMoreError('');
    setRawFiles([]);
    setFiles([]);
    setHasMore(false);
    setNextCursor(null);
    setAiText('');
    setAiCitations([]);
    void searchKeywordFiles({
      q: q.trim(),
      tag: tag || undefined,
      spaceIds: Number.isFinite(selectedSpaceId) && selectedSpaceId > 0 ? [selectedSpaceId] : undefined,
      spaceLevel: spaceLevel || undefined,
      fileExt: fileExt || undefined,
      documentType: documentType || undefined,
      fileSubcategoryCode: fileSubcategoryCode || undefined,
      businessDomainCode: businessDomainCode || undefined,
      sort: keywordSort,
    })
      .then((result) => {
        if (latestSearchRequestRef.current !== currentRequest) return;
        setRawFiles(result.data);
        setRawTotal(result.data.length);
        setResultsReady(true);
      })
      .catch((err) => {
        if (latestSearchRequestRef.current !== currentRequest) return;
        setError(err instanceof Error ? err.message : '搜索失败');
        setAiThinking(false);
      })
      .finally(() => {
        searchPendingRef.current = false;
        if (latestSearchRequestRef.current === currentRequest) setLoading(false);
      });
  }, [
    businessDomainCode,
    documentType,
    fileExt,
    fileSubcategoryCode,
    keywordMode,
    keywordSort,
    q,
    selectedSpaceId,
    spaceLevel,
    tag,
  ]);

  useEffect(() => {
    if (!keywordMode) return;
    setVisibleLimit(pageLimit);
  }, [keywordMode, pageLimit]);

  useEffect(() => {
    if (keywordMode) return;
    const currentRequest = ++requestSeq.current;
    setLoading(true);
    setLoadingMore(false);
    setResultsReady(false);
    setError('');
    setLoadMoreError('');
    setRawFiles([]);
    setRawTotal(0);
    setFiles([]);
    setTotal(0);
    setHasMore(false);
    setNextCursor(null);
    setAiText('');
    setAiCitations([]);
    setAiThinking(false);
    void fetchDatabasePage(null)
      .then((result) => {
        if (requestSeq.current !== currentRequest) return;
        const seen = new Set<string>();
        const data = result.data.filter((file) => {
          const key = `${file.spaceId}:${file.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setFiles(data);
        setTotal(data.length);
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
        setResultsReady(true);
      })
      .catch((err) => {
        if (requestSeq.current !== currentRequest) return;
        setError(err instanceof Error ? err.message : '文档加载失败');
      })
      .finally(() => {
        if (requestSeq.current === currentRequest) setLoading(false);
      });
  }, [fetchDatabasePage, keywordMode]);

  useEffect(() => {
    if (!keywordMode || loading || !resultsReady) return;
    setTotal(filteredFiles.length);
    setVisibleLimit(pageLimit);
  }, [filteredFiles, keywordMode, loading, pageLimit, resultsReady]);

  useEffect(() => {
    // 未登录用户不触发 AI 总结（会话接口需登录，匿名会失败）
    if (!user || !keywordMode || loading || !resultsReady || searchPendingRef.current) return;
    let active = true;
    setAiText('');
    setAiCitations([]);
    setAiError('');
    setAiRetryStatus('');
    setAiThinking(true);
    const currentRequest = ++requestSeq.current;
    void streamChatCompletion({
      scene: 'search',
      text: q,
      knowledgeSpaceIds: [],
      searchResults: rawFiles.slice(0, 10),
      onUpdate(text) {
        if (!active || requestSeq.current !== currentRequest) return;
        setAiText(text);
        setAiThinking(false);
        setAiRetryStatus('');
      },
      onCitations(list) {
        if (!active || requestSeq.current !== currentRequest) return;
        setAiCitations(list);
      },
      onRetry(progress) {
        if (!active || requestSeq.current !== currentRequest) return;
        setAiRetryStatus(progress.message);
        setAiThinking(true);
      },
    }).catch((err: unknown) => {
      if (!active || requestSeq.current !== currentRequest) return;
      setAiError(err instanceof Error && err.message
        ? err.message
        : '问答请求失败，请稍后重试。');
      setAiRetryStatus('');
    }).finally(() => {
      if (active && requestSeq.current === currentRequest) {
        setAiThinking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [aiRetryKey, keywordMode, loading, q, rawFiles, rawTotal, resultsReady, user]);

  const retryAiSummary = () => {
    setAiError('');
    setAiRetryKey((current) => current + 1);
  };

  const handleLoadMore = useCallback(async () => {
    if (keywordMode) {
      setVisibleLimit((current) => Math.min(current + pageLimit, filteredFiles.length));
      return;
    }
    if (!hasMore || !nextCursor || loading || loadingMore) return;
    const currentRequest = requestSeq.current;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const result = await fetchDatabasePage(nextCursor);
      if (requestSeq.current !== currentRequest) return;
      setFiles((current) => {
        const seen = new Set(current.map((file) => `${file.spaceId}:${file.id}`));
        const appended = result.data.filter((file) => {
          const key = `${file.spaceId}:${file.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const next = [...current, ...appended];
        setTotal(next.length);
        return next;
      });
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (err) {
      if (requestSeq.current === currentRequest) {
        setLoadMoreError(err instanceof Error ? err.message : '加载更多失败');
      }
    } finally {
      if (requestSeq.current === currentRequest) setLoadingMore(false);
    }
  }, [
    fetchDatabasePage,
    filteredFiles.length,
    hasMore,
    keywordMode,
    loading,
    loadingMore,
    nextCursor,
    pageLimit,
  ]);

  const displayedFiles = useMemo(
    () => (keywordMode ? filteredFiles.slice(0, visibleLimit) : files),
    [files, filteredFiles, keywordMode, visibleLimit],
  );
  const canLoadMore = keywordMode ? visibleLimit < filteredFiles.length : hasMore && Boolean(nextCursor);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !canLoadMore || loading || loadingMore || loadMoreError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void handleLoadMore();
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, handleLoadMore, loadMoreError, loading, loadingMore]);

  useEffect(() => {
    if (!canFavorite || !displayedFiles.length) return;
    const statusFiles = displayedFiles.filter((file) => (
      !file.isDepartmentFile || file.contentAccess !== 'check_required'
    ));
    if (statusFiles.length) void loadStatuses(statusFiles);
  }, [displayedFiles, canFavorite, loadStatuses]);

  const submitSearch = () => {
    const submittedQuery = draft.trim();
    if (user && submittedQuery) {
      void recordPortalSearchEvent(submittedQuery, 'search_page').catch(() => undefined);
    }
    setParams(createSubmittedSearchParams(params, draft));
  };

  const toggleAdvancedSearch = () => {
    const next = new URLSearchParams(params);
    if (advancedSearchOpen) next.delete('advanced');
    else {
      next.set('advanced', '1');
      setAdvancedSearchDraft(getAdvancedSearchForm(params, draft));
    }
    setParams(next);
  };

  const submitAdvancedSearch = () => {
    const next = applyAdvancedSearchForm(params, advancedSearchDraft);
    const retrievalQuery = buildAdvancedRetrievalQuery(advancedSearchDraft);
    if (user && retrievalQuery) {
      void recordPortalSearchEvent(retrievalQuery, 'search_page').catch(() => undefined);
    }
    setParams(next);
  };

  const removeAppliedFilter = (keys: string[]) => {
    const next = new URLSearchParams(params);
    for (const key of keys) {
      if (key === 'search_field') next.set('search_field', 'file_name');
      else next.delete(key);
    }
    if (keys.some((key) => (
      key === 'all_keywords'
      || key === 'exact_phrase'
      || key === 'any_keywords'
      || key === 'exclude_keywords'
    ))) {
      const nextForm = getAdvancedSearchForm(next);
      const nextQuery = buildAdvancedRetrievalQuery(nextForm);
      if (nextQuery) next.set('q', nextQuery);
      else next.delete('q');
    }
    next.delete('cursor');
    next.delete('page');
    setParams(next);
  };

  const clearAppliedFilters = () => {
    const next = clearAdvancedSearchConditions(params);
    if (advancedSearchOpen) next.set('advanced', '1');
    setAdvancedSearchDraft({ ...EMPTY_ADVANCED_SEARCH_FORM });
    setParams(next);
  };

  const appliedFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; keys: string[] }> = [];
    const add = (key: string, label: string, keys = [key]) => {
      if (label.trim()) chips.push({ key, label, keys });
    };
    if (allKeywords) add('all_keywords', `全部关键词：${allKeywords}`);
    if (exactPhrase) add('exact_phrase', `完整短语：${exactPhrase}`);
    if (anyKeywords) add('any_keywords', `任意关键词：${anyKeywords}`);
    if (excludeKeywords) add('exclude_keywords', `排除：${excludeKeywords}`);
    if ((allKeywords || exactPhrase || anyKeywords || excludeKeywords) && searchField !== 'file_name') {
      const fieldLabel = searchField === 'summary' ? '摘要' : searchField === 'tags' ? '标签' : '文件名';
      add('search_field', `字段：${fieldLabel}`);
    }
    if (spaceLevel) {
      add('space_level', SPACE_LEVEL_OPTIONS.find((item) => item.value === spaceLevel)?.label || spaceLevel, [
        'space_level',
        'space_id',
      ]);
    }
    if (spaceId) {
      add('space_id', resultSpaceOptions.find((item) => String(item.id) === spaceId)?.name || spaceId);
    }
    if (businessDomainCode) {
      add(
        'business_domain_code',
        resultBusinessDomainOptions.find((item) => item.code === businessDomainCode)?.label || businessDomainCode,
      );
    }
    if (documentType || fileSubcategoryCode) {
      const child = findRuntimeDocumentTypeChild(resultDocumentTypeGroups, fileSubcategoryCode);
      const group = resultDocumentTypeGroups.find((item) => item.code === documentType);
      add(
        'document_type',
        child ? `${child.parentLabel} / ${child.label}` : group?.label || documentType || fileSubcategoryCode,
        ['document_type', 'file_subcategory_code'],
      );
    }
    if (fileExt) add('file_ext', fileExt.toUpperCase());
    if (tag) add('tag', tag);
    if (updatedFrom || updatedTo) {
      add(
        'updated_range',
        `更新时间：${updatedFrom || '不限'} 至 ${updatedTo || '今'}`,
        ['updated_from', 'updated_to'],
      );
    }
    return chips;
  }, [
    allKeywords,
    anyKeywords,
    businessDomainCode,
    documentType,
    exactPhrase,
    excludeKeywords,
    fileExt,
    fileSubcategoryCode,
    resultBusinessDomainOptions,
    resultDocumentTypeGroups,
    resultSpaceOptions,
    searchField,
    spaceId,
    spaceLevel,
    tag,
    updatedFrom,
    updatedTo,
  ]);

  return (
    <PageShell
      mainStyle={{
        background: `#EAF0F7 url(${searchHeroBg}) top center / 100% auto no-repeat`,
      }}
    >
      <ActionToast toast={toast} />
      <div className={s.container}>
        <div className={s.searchHero}>
          <div ref={resultsTopRef} />
          <div className={s.searchHeroControls}>
            <div className={s.searchHeroInputWrap}>
              <Search size={18} className={s.searchHeroIcon} />
              <input
                className={s.searchHeroInput}
                placeholder="请输入关键词开始搜索"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSearch();
                }}
                disabled={advancedSearchOpen}
                autoFocus={!advancedSearchOpen}
              />
              <button className={s.searchHeroBtn} onClick={submitSearch} disabled={advancedSearchOpen}>搜索</button>
            </div>
            {ADVANCED_SEARCH_ENABLED ? (
              <button
                type="button"
                className={`${s.advancedSearchButton} ${advancedSearchOpen ? s.advancedSearchButtonActive : ''}`}
                aria-expanded={advancedSearchOpen}
                onClick={toggleAdvancedSearch}
              >
                高级检索
                {advancedSearchOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : null}
          </div>
        </div>

        {ADVANCED_SEARCH_ENABLED && advancedSearchOpen ? (
          <AdvancedSearchPanel
            value={advancedSearchDraft}
            onChange={setAdvancedSearchDraft}
            onSubmit={submitAdvancedSearch}
            onReset={() => setAdvancedSearchDraft({ ...EMPTY_ADVANCED_SEARCH_FORM })}
            onCollapse={toggleAdvancedSearch}
          />
        ) : null}

        {!user && (
          <div className={s.guestNotice} role="note">
            您当前为访客身份，仅可查阅公共库内容，内部资料无访问权限
          </div>
        )}

        <div className={s.resultBar}>
            <div className={s.resultCount}>
              <span className={s.resultMark} />
              {keywordMode ? (
                <>共找到 <strong className={s.resultTotal}>{total}</strong> 个相关文件</>
              ) : (
                <>已加载 <strong className={s.resultTotal}>{files.length}</strong> 篇文档</>
              )}
            </div>
            <div className={s.filters}>
              <select
                className={s.filterSelect}
                value={spaceLevel}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  if (e.target.value) next.set('space_level', e.target.value);
                  else next.delete('space_level');
                  next.delete('space_id'); // 切换级别时重置二级「知识空间」
                  next.delete('page');
                  setParams(next);
                }}
              >
                <option value="">知识库类型</option>
                {resultSpaceLevelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select className={s.filterSelect} value={spaceId} onChange={(e) => setFilter('space_id', e.target.value, false)}>
                <option value="">知识库</option>
                {resultSpaceOptions.map((sp) => <option key={sp.id} value={String(sp.id)}>{sp.name}</option>)}
              </select>
              <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value, false)}>
                <option value="">文件格式</option>
                {resultFileExtOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <DocumentTypeFilterDropdown
                groups={resultDocumentTypeGroups}
                documentType={documentType}
                fileSubcategoryCode={fileSubcategoryCode}
                compact
                onChange={(next) => {
                  setFilters({
                    document_type: next.documentType,
                    file_subcategory_code: next.fileSubcategoryCode,
                  }, false);
                }}
              />
              <select className={s.filterSelect} value={businessDomainCode} onChange={(e) => setFilter('business_domain_code', e.target.value, false)}>
                <option value="">业务域</option>
                {resultBusinessDomainOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
              <select className={s.filterSelect} value={tag} onChange={(e) => setFilter('tag', e.target.value, false)}>
                <option value="">标签</option>
                {resultTagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={s.filterSelect} value={sort} onChange={(e) => setFilter('sort', e.target.value, false)}>
                {(keywordMode ? SEARCH_SORT_OPTIONS : TIME_SORT_OPTIONS).map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

        {appliedFilterChips.length ? (
          <div className={s.appliedFilters}>
            <span className={s.appliedFiltersLabel}>当前筛选：</span>
            <div className={s.appliedFilterChips}>
              {appliedFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={s.appliedFilterChip}
                  onClick={() => removeAppliedFilter(chip.keys)}
                  aria-label={`移除筛选：${chip.label}`}
                >
                  <span>{chip.label}</span>
                  <X size={13} />
                </button>
              ))}
            </div>
            <button type="button" className={s.clearFiltersButton} onClick={clearAppliedFilters}>
              清空条件
            </button>
          </div>
        ) : null}

        {keywordMode && user && (() => {
          // 未登录用户隐藏 AI 总结模块（会话接口需登录）
          // 临时隐藏 AI 总结下方的溯源文件列表，保留数据接收与正文引用渲染，便于后续恢复。
          // const referenced = aiCitations;
          return (
            <div className={s.aiOverview}>
              <div className={s.aiBody}>
                <div className={s.aiHeader}>
                  <span className={s.aiTitle}>{`${q || displayKeyword || '搜索'}总结`}</span>
                  <button
                    type="button"
                    className={s.aiToggle}
                    onClick={() => setSummaryCollapsed((v) => !v)}
                  >
                    {summaryCollapsed ? '展开' : '收起'}
                    {summaryCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
                {summaryCollapsed ? null : aiThinking ? (
                  <div className={s.aiThinking}>
                    <Loader2 size={16} className={s.spinner} />
                    <span>{aiRetryStatus || '思考中...'}</span>
                  </div>
                ) : aiError ? (
                  <div className={s.aiError} role="alert">
                    <span>{aiError}</span>
                    <button type="button" className={s.retryButton} onClick={retryAiSummary}>重试</button>
                  </div>
                ) : (
                  <div
                    className={s.aiText}
                    dangerouslySetInnerHTML={{ __html: renderChatMarkdown(aiText, aiCitations) }}
                  />
                )}
              </div>
              {/*
              {referenced.length > 0 && (
                <ol className={s.citations}>
                  {referenced.map((c, idx) => {
                    const sp = c.sourcePayload ?? {};
                    const href = sp.knowledgeId && sp.documentId
                      ? `/space/${sp.knowledgeId}/file/${sp.documentId}`
                      : undefined;
                    const label = sp.documentName || c.key;
                    return (
                      <li key={c.key} className={s.citationItem}>
                        <span className={s.citationIndex}>{idx + 1}</span>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={s.citationLink}
                            title={label}
                          >
                            {label}
                          </a>
                        ) : (
                          <span className={s.citationLink}>{label}</span>
                        )}
                        {sp.knowledgeName ? <span className={s.citationHint}>· {sp.knowledgeName}</span> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
              */}
            </div>
          );
        })()}

        {error ? (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>搜索失败</div>
            <div className={s.emptyDesc}>{error}</div>
          </div>
        ) : null}

        {loading ? (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>正在加载搜索结果</div>
          </div>
        ) : null}

        {!loading && displayedFiles.map((f) => (
          <FileListItem
            key={`${f.spaceId}:${f.id}`}
            file={f}
            highlightQuery={q}
            visibleTagCount={displayConfig.search.visibleTagCount}
            onFavorite={canFavorite ? handleToggleFavorite : undefined}
            favorited={isFavorited(f.spaceId, f.id)}
            favoritePending={pending(f.spaceId, f.id)}
            onDownload={canDownload && (!f.isDepartmentFile || f.canDownload) ? handleDownload : undefined}
            onOpen={setPreviewFile}
          />
        ))}
        {!loading && canLoadMore ? (
          <div ref={loadMoreRef} className={s.loadMoreState}>
            {loadingMore ? <><Loader2 size={16} className={s.spinner} /> 正在加载更多</> : '继续下滑加载更多'}
          </div>
        ) : null}
        {loadMoreError ? (
          <div className={s.loadMoreState}>
            <span>{loadMoreError}</span>
            <button type="button" className={s.retryButton} onClick={() => void handleLoadMore()}>重试</button>
          </div>
        ) : null}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal
          file={previewFile}
          context={{ entryPoint: 'search', recommendationScene: null }}
          onClose={() => setPreviewFile(null)}
        />
      </div>
    </PageShell>
  );
}
