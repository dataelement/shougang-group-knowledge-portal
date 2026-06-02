import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import PageShell from '../components/PageShell';
import FileListItem from '../components/FileListItem';
import FavoriteDocumentModal from '../components/FavoriteDocumentModal';
// import ShareDocumentModal from '../components/ShareDocumentModal';
import DocumentQaModal from '../components/DocumentQaModal';
import FilePreviewModal from '../components/FilePreviewModal';
import Pagination from '../components/Pagination';
import {
  fetchAggregatedTags,
  searchFiles,
  streamChatCompletion,
  type Citation,
  type FileItem,
} from '../api/content';
import { renderChatMarkdown } from '../utils/chatMessage';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useFavoriteDocument } from '../hooks/useFavoriteDocument';
// import { useShareDocument } from '../hooks/useShareDocument';
import { useDocumentQa } from '../hooks/useDocumentQa';
import { useListControls } from '../hooks/useListControls';
import { getVisibleRange } from '../utils/listControls';
import {
  closeFileDownloadWindow,
  openFileDownloadUrl,
  openFileDownloadWindow,
  resolveFileDownloadUrl,
} from '../utils/fileDownload';
import { getEnabledDomains, toRuntimeDisplayConfig } from '../utils/portalConfig';
import {
  createDomainFilterSearchParams,
  createSubmittedSearchParams,
  getSearchDisplayKeyword,
  hasSearchContext,
} from '../utils/searchParams';
import s from './SearchPage.module.css';

type DomainOption = {
  name: string;
  spaceIds: number[];
};

const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共空间' },
  { value: 'department', label: '部门空间' },
  { value: 'team', label: '团队空间' },
  { value: 'personal', label: '个人空间' },
];

export default function SearchPage() {
  const { params, page, resultsTopRef, setFilter, setParams } = useListControls();
  const q = params.get('q') || '';
  const domain = params.get('domain') || '';
  const displayKeyword = getSearchDisplayKeyword(params);
  const [draft, setDraft] = useState(displayKeyword);
  const spaceLevel = params.get('space_level') || '';
  const fileExt = params.get('file_ext') || '';
  const tag = params.get('tag') || '';
  const sort = params.get('sort') || 'relevance';
  const hasSearch = hasSearchContext(params);
  const { config } = usePortalConfig();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState<number>(displayConfig.search.pageSize);
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

  const domains = useMemo<DomainOption[]>(
    () => (config
      ? getEnabledDomains(config.domains, config.spaces).map((item) => ({
        name: item.name,
        spaceIds: item.space_ids,
      }))
      : []),
    [config],
  );
  const selectedDomain = domains.find((item) => item.name === domain);
  const sids = selectedDomain?.spaceIds;
  const visibleRange = getVisibleRange(total, page, pageSize, files.length);
  const resultHeading = q ? `搜索 “${q}”` : domain ? `业务域 “${domain}”` : `筛选 “${displayKeyword}”`;

  useEffect(() => {
    setDraft(displayKeyword);
  }, [displayKeyword]);

  useEffect(() => {
    let active = true;
    if (!hasSearch) {
      setFiles([]);
      setTotal(0);
      setAiText('');
      setAiCitations([]);
      setTags([]);
      return;
    }
    if (domain && !config) {
      setLoading(true);
      return;
    }

    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [result, loadedTags] = await Promise.all([
          searchFiles({
            q: q || undefined,
            tag: tag || undefined,
            spaceIds: sids,
            spaceLevel: spaceLevel || undefined,
            fileExt: fileExt || undefined,
            sort,
            page,
            pageSize: displayConfig.search.pageSize,
          }),
          fetchAggregatedTags(sids, spaceLevel || undefined),
        ]);
        if (!active) return;
        setFiles(result.data);
        setTotal(result.total);
        setPageSize(result.pageSize);
        setTags(loadedTags);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '搜索失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [config, displayConfig.search.pageSize, domain, fileExt, hasSearch, page, q, sids, spaceLevel, sort, tag]);

  useEffect(() => {
    const aiKeyword = displayKeyword.trim();
    if (!aiKeyword) return;
    const currentRequest = ++requestSeq.current;
    setAiText('');
    setAiCitations([]);
    setAiThinking(true);
    void streamChatCompletion({
      scene: 'search',
      text: aiKeyword,
      knowledgeSpaceIds: sids ?? [],
      spaceLevel: spaceLevel || undefined,
      onUpdate(text) {
        if (requestSeq.current !== currentRequest) return;
        setAiText(text);
        setAiThinking(false);
      },
      onCitations(list) {
        if (requestSeq.current !== currentRequest) return;
        setAiCitations(list);
      },
    }).finally(() => {
      if (requestSeq.current === currentRequest) {
        setAiThinking(false);
      }
    });
  }, [displayKeyword, sids, spaceLevel]);

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
              {resultHeading} 共 {total} 条结果
              {total > 0 ? `，当前显示 ${visibleRange.start}-${visibleRange.end} 条` : ''}
            </div>
          )}
        </div>

        {hasSearch && (
          <div className={s.filterBar}>
            <select className={s.filterSelect} value={spaceLevel} onChange={(e) => setFilter('space_level', e.target.value)}>
              <option value="">全部知识库</option>
              {SPACE_LEVEL_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select
              className={s.filterSelect}
              value={domain}
              onChange={(e) => setParams(createDomainFilterSearchParams(params, e.target.value))}
            >
              <option value="">业务域</option>
              {domains.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
            <select className={s.filterSelect} value={fileExt} onChange={(e) => setFilter('file_ext', e.target.value)}>
              <option value="">文档类型</option>
              {FILE_EXT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={s.filterSelect} value={tag} onChange={(e) => setFilter('tag', e.target.value)}>
              <option value="">标签</option>
              {tags.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className={s.sortWrap}>
              排序：
              <select className={s.filterSelect} value={sort} onChange={(e) => setFilter('sort', e.target.value)}>
                <option value="relevance">相关性优先</option>
                <option value="updated_at">最近更新</option>
              </select>
            </div>
          </div>
        )}

        {hasSearch && (() => {
          // 总结基于检索到的前 N 个文件摘要，直接展示这些来源文件
          const referenced = aiCitations;
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

        {hasSearch && (
          <Pagination
            page={page}
            total={total}
            pageSize={pageSize}
            onChange={(nextPage) => setFilter('page', String(nextPage), false)}
          />
        )}
        <FavoriteDocumentModal {...favoriteModalProps} />
        {/* <ShareDocumentModal {...shareModalProps} /> */}
        <DocumentQaModal {...documentQaModalProps} />
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      </div>
    </PageShell>
  );
}
