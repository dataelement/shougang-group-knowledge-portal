import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
import FavoriteDocumentModal from '../components/FavoriteDocumentModal';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import {
  fetchAggregatedTags,
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
  closeFileDownloadWindow,
  openFileDownloadUrl,
  openFileDownloadWindow,
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
  const [tags, setTags] = useState<string[]>([]);
  const [aiText, setAiText] = useState('');
  const [aiCitations, setAiCitations] = useState<Citation[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const { openFavorite, favoriteModalProps } = useFavoriteDocument();
  // const { openShare, shareModalProps } = useShareDocument();
  const { openDocumentQa, documentQaModalProps } = useDocumentQa();

  const handleDownload = useCallback(async (file: FileItem) => {
    const downloadWindow = openFileDownloadWindow();
    setError('');
    try {
      const downloadUrl = await resolveFileDownloadUrl(file);
      if (!downloadUrl) {
        closeFileDownloadWindow(downloadWindow);
        setError('该文档暂不可下载');
        return;
      }
      openFileDownloadUrl(downloadUrl, downloadWindow);
    } catch (err) {
      closeFileDownloadWindow(downloadWindow);
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

  // 二级「知识空间」候选：未登录=后台启用库；登录=启用库 ∪ 个人可见库；再按一级所选级别过滤、按 id 去重
  const availableSpaces = useMemo<SpaceOption[]>(() => {
    const byId = new Map<number, SpaceOption>();
    for (const sp of config?.spaces ?? []) {
      if (sp.enabled) byId.set(sp.id, { id: sp.id, name: sp.name, spaceLevel: sp.space_level ?? '' });
    }
    for (const sp of visibleSpaces) {
      if (!byId.has(sp.id)) byId.set(sp.id, sp);
    }
    let list = [...byId.values()];
    if (spaceLevel) list = list.filter((sp) => sp.spaceLevel === spaceLevel);
    return list;
  }, [config, visibleSpaces, spaceLevel]);

  const selectedSpace = availableSpaces.find((sp) => String(sp.id) === spaceId);
  const resultHeading = q
    ? `搜索 “${q}”`
    : selectedSpace
      ? `知识空间 “${selectedSpace.name}”`
      : `筛选 “${displayKeyword}”`;

  useEffect(() => {
    let active = true;
    if (!hasSearch) {
      setTags([]);
      return;
    }
    void fetchAggregatedTags(sids, spaceLevel || undefined)
      .then((loadedTags) => {
        if (active) setTags(loadedTags);
      })
      .catch(() => {
        if (active) setTags([]);
      });
    return () => {
      active = false;
    };
  }, [hasSearch, sids, spaceLevel]);

  useEffect(() => {
    let active = true;
    if (!hasSearch) {
      setFiles([]);
      setTotal(0);
      setAiText('');
      setAiCitations([]);
      setAiThinking(false);
      setTags([]);
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
              <option value="">全部知识库</option>
              {SPACE_LEVEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select className={s.filterSelect} value={spaceId} onChange={(e) => setFilter('space_id', e.target.value, false)}>
              <option value="">全部空间</option>
              {availableSpaces.map((sp) => <option key={sp.id} value={String(sp.id)}>{sp.name}</option>)}
            </select>
            <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value, false)}>
              <option value="">文档类型</option>
              {FILE_EXT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={s.filterSelect} value={tag} onChange={(e) => setFilter('tag', e.target.value, false)}>
              <option value="">标签</option>
              {tags.map((item) => <option key={item} value={item}>{item}</option>)}
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
            onDownload={handleDownload}
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
