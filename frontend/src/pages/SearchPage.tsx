import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
import FavoriteDocumentModal from '../components/FavoriteDocumentModal';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import {
  fetchKnowledgeSpaces,
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
import s from './SearchPage.module.css';

type SpaceOption = {
  id: number;
  name: string;
  spaceLevel: string;
};

const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共空间' },
  { value: 'department', label: '部门空间' },
  { value: 'team', label: '团队空间' },
  { value: 'personal', label: '个人空间' },
];

function normalizeFileExt(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '');
}

function addStringOption(target: Set<string>, value: string) {
  const normalized = value.trim();
  if (normalized) target.add(normalized);
}

export default function SearchPage() {
  const { params, resultsTopRef, setFilter, setParams } = useListControls();
  const q = params.get('q') || '';
  const displayKeyword = getSearchDisplayKeyword(params);
  const [draft, setDraft] = useState(displayKeyword);
  const spaceLevel = params.get('space_level') || '';
  const spaceId = params.get('space_id') || '';
  const fileExt = params.get('file_ext') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'relevance';
  const hasSearch = hasSearchContext(params);
  const { config } = usePortalConfig();
  const { user } = useAuth();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  // 登录用户个人可见空间（按个人权限），用于扩充二级「知识空间」筛选
  const [visibleSpaces, setVisibleSpaces] = useState<SpaceOption[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [total, setTotal] = useState(0);
  const [aiText, setAiText] = useState('');
  const [aiCitations, setAiCitations] = useState<Citation[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const { openFavorite, favoriteModalProps } = useFavoriteDocument();
  // const { openShare, shareModalProps } = useShareDocument();
  const { openDocumentQa, documentQaModalProps } = useDocumentQa();
  const canDownload = Boolean(user);

  const handleDownload = useCallback(async (file: FileItem) => {
    setError('');
    try {
      const downloadUrl = await resolveFileDownloadUrl(file);
      if (!downloadUrl) {
        setError('该文档暂不可下载');
        return;
      }
      openFileDownloadUrl(downloadUrl, buildDownloadFileName(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载链接获取失败');
    }
  }, []);

  // 选中具体空间时按该空间检索；否则为整个范围
  const sids = useMemo(() => (spaceId ? [Number(spaceId)] : undefined), [spaceId]);

  useEffect(() => {
    setDraft(displayKeyword);
  }, [displayKeyword]);

  // 登录后拉取个人可见空间；未登录则清空（二级仅用启用库）
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

  // 搜索页空间元数据：未登录=后台启用库；登录=启用库 ∪ 个人可见库；按 id 去重。
  const searchSpaces = useMemo<SpaceOption[]>(() => {
    const byId = new Map<number, SpaceOption>();
    for (const sp of config?.spaces ?? []) {
      if (sp.enabled) byId.set(sp.id, { id: sp.id, name: sp.name, spaceLevel: sp.space_level ?? '' });
    }
    for (const sp of visibleSpaces) {
      if (!byId.has(sp.id)) byId.set(sp.id, sp);
    }
    return [...byId.values()];
  }, [config, visibleSpaces]);

  const spaceById = useMemo(() => new Map(searchSpaces.map((sp) => [sp.id, sp])), [searchSpaces]);
  const selectedSpaceId = Number(spaceId);
  const selectedSpace = Number.isFinite(selectedSpaceId) ? spaceById.get(selectedSpaceId) : undefined;

  const resultSpaceLevelOptions = useMemo(() => {
    const levelSet = new Set<string>();
    for (const file of files) {
      const level = spaceById.get(file.spaceId)?.spaceLevel ?? '';
      addStringOption(levelSet, level);
    }
    addStringOption(levelSet, spaceLevel);
    return SPACE_LEVEL_OPTIONS.filter((item) => levelSet.has(item.value));
  }, [files, spaceById, spaceLevel]);

  const resultSpaceOptions = useMemo<SpaceOption[]>(() => {
    const optionIds: number[] = [];
    const seen = new Set<number>();
    const resultSpaceNames = new Map<number, string>();
    const addSpaceId = (id: number) => {
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return;
      seen.add(id);
      optionIds.push(id);
    };
    for (const file of files) {
      addSpaceId(file.spaceId);
      if (file.source) resultSpaceNames.set(file.spaceId, file.source);
    }
    addSpaceId(selectedSpaceId);
    return optionIds.map((id) => (
      spaceById.get(id) ?? {
        id,
        name: resultSpaceNames.get(id) ?? String(id),
        spaceLevel: '',
      }
    ));
  }, [files, selectedSpaceId, spaceById]);

  const resultFileExtOptions = useMemo(() => {
    const extSet = new Set<string>();
    for (const file of files) {
      addStringOption(extSet, normalizeFileExt(file.ext));
    }
    addStringOption(extSet, normalizeFileExt(fileExt));
    const knownOptions = FILE_EXT_OPTIONS.filter((item) => extSet.has(item));
    const customOptions = [...extSet]
      .filter((item) => !FILE_EXT_OPTIONS.includes(item as (typeof FILE_EXT_OPTIONS)[number]))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return [...knownOptions, ...customOptions];
  }, [fileExt, files]);

  const resultTagOptions = useMemo(() => {
    const tagSet = new Set<string>();
    for (const file of files) {
      for (const item of file.tags) addStringOption(tagSet, item.tag_name);
    }
    addStringOption(tagSet, tag);
    return [...tagSet].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [files, tag]);

  const resultHeading = q
    ? `搜索 “${q}”`
    : selectedSpace
      ? `知识库 “${selectedSpace.name}”`
      : `筛选 “${displayKeyword}”`;

  useEffect(() => {
    let active = true;
    if (!hasSearch) {
      setFiles([]);
      setTotal(0);
      setAiText('');
      setAiCitations([]);
      setAiThinking(false);
      requestSeq.current += 1;
      return;
    }
    setLoading(true);
    setError('');
    setAiText('');
    setAiCitations([]);
    setAiThinking(true);
    void (async () => {
      try {
        const result = await searchFiles({
          q: q || undefined,
          tag: tag || undefined,
          spaceIds: sids,
          spaceLevel: spaceLevel || undefined,
          fileExt: fileExt || undefined,
          sort,
        });
        if (!active) return;
        setFiles(result.data);
        setTotal(result.total);
        const currentRequest = ++requestSeq.current;
        void streamChatCompletion({
          scene: 'search',
          text: q,
          knowledgeSpaceIds: sids ?? [],
          spaceLevel: spaceLevel || undefined,
          searchResults: result.data.slice(0, 10),
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
  }, [fileExt, hasSearch, q, sids, spaceLevel, sort, tag]);

  const submitSearch = () => {
    setParams(createSubmittedSearchParams(params, draft));
  };

  return (
    <PageShell>
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
          ) : (
            <div className={s.resultCount}>
              {resultHeading} 共找到 {total} 个相关文件
            </div>
          )}
        </div>

        {hasSearch && (
          <div className={s.filterBar}>
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
              <option value="">文档类型</option>
              {resultFileExtOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className={s.filterSelect} value={tag} onChange={(e) => setFilter('tag', e.target.value, false)}>
              <option value="">标签</option>
              {resultTagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className={s.sortWrap}>
              排序：
              <select className={s.filterSelect} value={sort} onChange={(e) => setFilter('sort', e.target.value, false)}>
                <option value="relevance">相关性优先</option>
                <option value="updated_at">最近更新</option>
              </select>
            </div>
          </div>
        )}

        {hasSearch && (() => {
          // 临时隐藏 AI 总结下方的溯源文件列表，保留数据接收与正文引用渲染，便于后续恢复。
          // const referenced = aiCitations;
          return (
            <div className={s.aiOverview}>
              <div className={s.aiBadge}>
                <Search size={12} />
                搜索助手
              </div>
              {aiThinking ? (
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
            visibleTagCount={displayConfig.search.visibleTagCount}
            onFavorite={openFavorite}
            onDownload={canDownload ? handleDownload : undefined}
            // onShare={openShare}
            onAsk={openDocumentQa}
            onOpen={setPreviewFile}
          />
        ))}
        <FavoriteDocumentModal {...favoriteModalProps} />
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      </div>
    </PageShell>
  );
}
