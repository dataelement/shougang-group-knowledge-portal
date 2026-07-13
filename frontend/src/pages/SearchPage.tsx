import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import DocumentTypeFilterDropdown from '../components/DocumentTypeFilterDropdown';
import {
  fetchKnowledgeSpaces,
  recordFileDownloadEvent,
  searchFiles,
  streamChatCompletion,
  type Citation,
  type FileItem,
} from '../api/content';
import { renderChatMarkdown } from '../utils/chatMessage';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';
// import { useShareDocument } from '../hooks/useShareDocument';
import { useDocumentQa } from '../hooks/useDocumentQa';
import { useListControls } from '../hooks/useListControls';
import {
  findRuntimeDocumentTypeChild,
  getDocumentTypeCodeFromFileEncoding,
  getRuntimeDocumentTypeGroups,
  normalizeDocumentTypeCode,
  normalizeSearchSort,
  type RuntimeDocumentTypeGroupOption,
  SEARCH_SORT_OPTIONS,
} from '../utils/documentTypes';
import {
  getBusinessDomainCodeFromFileEncoding,
  getBusinessDomainFilterOptions,
  normalizeBusinessDomainCode,
} from '../utils/businessDomains';
import {
  buildDownloadFileName,
  openFileDownloadUrl,
  resolveFileDownloadUrl,
} from '../utils/fileDownload';
import { toRuntimeDisplayConfig } from '../utils/portalConfig';
import {
  createSubmittedSearchParams,
  getSearchDisplayKeyword,
  hasSearchContext,
} from '../utils/searchParams';
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
  { value: 'team', label: '团队知识库' },
  { value: 'personal', label: '个人知识库' },
];

const SEARCH_FULL_RESULT_PAGE_SIZE = 100;

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

async function fetchCompleteSearchResults(params: {
  q?: string;
  sort?: string;
  limit: number;
}): Promise<FileItem[]> {
  const allFiles: FileItem[] = [];
  let cursor: string | null = null;
  do {
    const result = await searchFiles({
      q: params.q,
      sort: params.sort,
      cursor,
      limit: params.limit,
    });
    allFiles.push(...result.data);
    cursor = result.hasMore ? result.nextCursor : null;
  } while (cursor);
  return allFiles;
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
  const sort = normalizeSearchSort(params.get('sort'));
  const hasSearch = hasSearchContext(params);
  const { config } = usePortalConfig();
  const { user } = useAuth();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const pageLimit = displayConfig.search.pageSize > 0 ? displayConfig.search.pageSize : SEARCH_FULL_RESULT_PAGE_SIZE;
  // 登录用户个人可见空间（按个人权限），用于扩充二级「知识空间」筛选
  const [visibleSpaces, setVisibleSpaces] = useState<SpaceOption[]>([]);
  const [rawFiles, setRawFiles] = useState<FileItem[]>([]);
  const [rawTotal, setRawTotal] = useState(0);
  const [resultsReady, setResultsReady] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [total, setTotal] = useState(0);
  const [aiText, setAiText] = useState('');
  const [aiCitations, setAiCitations] = useState<Citation[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const { loadStatuses, isFavorited, toggleFavorite, pending } = useFavoriteDocument();
  // const { openShare, shareModalProps } = useShareDocument();
  const { documentQaModalProps } = useDocumentQa();
  const canDownload = Boolean(user);
  const canFavorite = Boolean(user);

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
    setDraft(displayKeyword);
  }, [displayKeyword]);

  // 登录后拉取个人可见空间；未登录由后端按公共空间限制范围。
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

  // 搜索页空间元数据来自登录用户可见空间；未登录时从结果里补充来源名称。
  const searchSpaces = useMemo<SpaceOption[]>(() => {
    const byId = new Map<number, SpaceOption>();
    for (const sp of visibleSpaces) {
      if (!byId.has(sp.id)) byId.set(sp.id, sp);
    }
    return [...byId.values()];
  }, [visibleSpaces]);

  const spaceById = useMemo(() => new Map(searchSpaces.map((sp) => [sp.id, sp])), [searchSpaces]);
  const selectedSpaceId = Number(spaceId);
  const selectedSpace = Number.isFinite(selectedSpaceId) ? spaceById.get(selectedSpaceId) : undefined;
  const documentTypeGroups = useMemo(
    () => getRuntimeDocumentTypeGroups(config?.document_types),
    [config?.document_types],
  );
  const businessDomainOptions = useMemo(
    () => getBusinessDomainFilterOptions(config?.domains),
    [config?.domains],
  );

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
    const levelSet = new Set<string>();
    for (const file of rawFiles) {
      addStringOption(levelSet, getFileSpaceLevel(file, spaceById));
    }
    addStringOption(levelSet, spaceLevel);
    return SPACE_LEVEL_OPTIONS.filter((item) => levelSet.has(item.value));
  }, [rawFiles, spaceById, spaceLevel]);

  const resultSpaceOptions = useMemo<SpaceOption[]>(() => {
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
  }, [rawFiles, selectedSpaceId, spaceById]);

  const resultFileExtOptions = useMemo(() => {
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
  }, [fileExt, rawFiles]);

  const resultTagOptions = useMemo(() => {
    const tagSet = new Set<string>();
    for (const file of rawFiles) {
      for (const item of file.tags) addStringOption(tagSet, item);
    }
    addStringOption(tagSet, tag);
    return [...tagSet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [rawFiles, tag]);

  const resultHeading = q
    ? `搜索 “${q}”`
    : selectedSpace
      ? `知识库 “${selectedSpace.name}”`
      : `筛选 “${displayKeyword}”`;

  useEffect(() => {
    let active = true;
    if (!hasSearch) {
      setResultsReady(false);
      setRawFiles([]);
      setRawTotal(0);
      setFiles([]);
      setTotal(0);
      setAiText('');
      setAiCitations([]);
      setAiThinking(false);
      requestSeq.current += 1;
      return;
    }
    setLoading(true);
    setResultsReady(false);
    setError('');
    setRawFiles([]);
    setRawTotal(0);
    setFiles([]);
    setTotal(0);
    setAiText('');
    setAiCitations([]);
    setAiThinking(true);
    requestSeq.current += 1;
    void (async () => {
      try {
        const data = await fetchCompleteSearchResults({
          q: q || undefined,
          sort,
          limit: pageLimit,
        });
        if (!active) return;
        setRawFiles(data);
        setRawTotal(data.length);
        setResultsReady(true);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '搜索失败');
        setAiThinking(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [hasSearch, q, sort, pageLimit]);

  useEffect(() => {
    if (!hasSearch || loading || !resultsReady) return;
    setFiles(filteredFiles);
    setTotal(filteredFiles.length);
  }, [filteredFiles, hasSearch, loading, resultsReady]);

  useEffect(() => {
    if (!hasSearch || loading || !resultsReady) return;
    let active = true;
    setAiText('');
    setAiCitations([]);
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
      },
      onCitations(list) {
        if (!active || requestSeq.current !== currentRequest) return;
        setAiCitations(list);
      },
    }).finally(() => {
      if (active && requestSeq.current === currentRequest) {
        setAiThinking(false);
      }
    });
    return () => {
      active = false;
    };
  }, [hasSearch, loading, q, rawFiles, rawTotal, resultsReady]);

  useEffect(() => {
    if (canFavorite && files.length) void loadStatuses(files);
  }, [files, canFavorite, loadStatuses]);

  const submitSearch = () => {
    setParams(createSubmittedSearchParams(params, draft));
  };

  return (
    <PageShell
      mainStyle={{
        background: `#EAF0F7 url(${searchHeroBg}) top center / 100% auto no-repeat`,
      }}
    >
      <div className={s.container}>
        <div className={s.searchHero}>
          <div ref={resultsTopRef} />
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
              autoFocus
            />
            <button className={s.searchHeroBtn} onClick={submitSearch}>搜索</button>
          </div>
          {!hasSearch ? (
            <div className={s.emptyState}>
              <div className={s.emptyTitle}>输入关键词开始搜索</div>
              <div className={s.emptyDesc}>
                支持按设备、工艺、质量、安全等主题检索知识文档。
              </div>
            </div>
          ) : null}
        </div>

        {hasSearch && !user && (
          <div className={s.guestNotice} role="note">
            您当前为访客身份，仅可查阅公共库内容，内部资料无访问权限
          </div>
        )}

        {hasSearch && (
          <div className={s.resultBar}>
            <div className={s.resultCount}>
              <span className={s.resultMark} />
              {resultHeading} 共找到 <strong className={s.resultTotal}>{total}</strong> 个相关文件
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
              groups={documentTypeGroups}
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
              {businessDomainOptions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
            <select className={s.filterSelect} value={tag} onChange={(e) => setFilter('tag', e.target.value, false)}>
              <option value="">标签</option>
              {resultTagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className={s.filterSelect} value={sort} onChange={(e) => setFilter('sort', e.target.value, false)}>
              {SEARCH_SORT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            </div>
          </div>
        )}

        {hasSearch && (() => {
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
                    <span>思考中...</span>
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

        {hasSearch && loading ? (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>正在加载搜索结果</div>
          </div>
        ) : null}

        {hasSearch && !loading && files.map((f) => (
          <FileListItem
            key={f.id}
            file={f}
            highlightQuery={q}
            visibleTagCount={displayConfig.search.visibleTagCount}
            onFavorite={canFavorite ? handleToggleFavorite : undefined}
            favorited={isFavorited(f.spaceId, f.id)}
            favoritePending={pending(f.spaceId, f.id)}
            onDownload={canDownload ? handleDownload : undefined}
            // onShare={openShare}
            onOpen={setPreviewFile}
          />
        ))}
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      </div>
    </PageShell>
  );
}
