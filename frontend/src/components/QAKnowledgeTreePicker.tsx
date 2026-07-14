import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Loader2,
  Minus,
  Search,
  X
} from 'lucide-react';
import type {
  FileItem,
  KnowledgeSpace,
  QaKnowledgeFolderStats,
  QaKnowledgeFileRef,
  QaKnowledgeFolderRef,
  QaKnowledgeScope,
  QaKnowledgeTreeNode,
} from '../api/content';
import { buildFilesScope, fileRefKey, folderRefKey } from './qaKnowledgeScopeSelection';
import s from './QAKnowledgeTreePicker.module.css';

const WHOLE_SPACE_LIMIT_TIP = '一次最多可选择1个库进行问答。';
const FILE_LIMIT_TIP = '一次最多可选择20个文件进行问答。';

function nodeChildrenKey(spaceId: number, parentId?: number | null) {
  return `${spaceId}:${parentId ?? 'root'}`;
}

function asFilesScope(scope: QaKnowledgeScope): Extract<QaKnowledgeScope, { mode: 'files' }> {
  if (scope.mode === 'files') return scope;
  return { mode: 'files', fileRefs: [], folderRefs: [], resolvedFileCount: 0 };
}

function getScopeFileCount(scope: QaKnowledgeScope) {
  if (scope.mode !== 'files') return 0;
  return scope.resolvedFileCount || scope.fileRefs.length;
}

export default function QAKnowledgeTreePicker({
  spaces,
  scope,
  loading,
  onChange,
  onLoadChildren,
  onLoadFolderStats,
  onSearchFiles,
  onTip,
  onClose,
  maxHeight,
}: {
  spaces: KnowledgeSpace[];
  scope: QaKnowledgeScope;
  loading: boolean;
  onChange: (scope: QaKnowledgeScope) => void;
  onLoadChildren: (spaceId: number, parentId?: number, cursor?: string)
    => Promise<{ data: QaKnowledgeTreeNode[]; hasMore: boolean; nextCursor: string | null }>;
  onLoadFolderStats: (spaceId: number, folderIds: number[]) => Promise<QaKnowledgeFolderStats[]>;
  onSearchFiles: (q: string, page?: number, pageSize?: number) => Promise<{ data: FileItem[]; total: number }>;
  onTip?: (message: string) => void;
  onClose?: () => void;
  /** 覆盖面板最大高度(用于在受限容器内定位,如首页 banner)。 */
  maxHeight?: number;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [childrenByKey, setChildrenByKey] = useState<Record<string, QaKnowledgeTreeNode[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set());
  const [nextCursorByKey, setNextCursorByKey] = useState<Record<string, string | null>>({});
  const [hasMoreByKey, setHasMoreByKey] = useState<Record<string, boolean>>({});
  const [loadingMoreKeys, setLoadingMoreKeys] = useState<Set<string>>(() => new Set());
  const [folderStatsLoadingKeys, setFolderStatsLoadingKeys] = useState<Set<string>>(() => new Set());
  const [folderStatsErrorKeys, setFolderStatsErrorKeys] = useState<Set<string>>(() => new Set());
  const requestedFolderStatsKeys = useRef<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [inlineTip, setInlineTip] = useState('');

  const selectedFileKeys = useMemo(() => {
    if (scope.mode !== 'files') return new Set<string>();
    return new Set(scope.fileRefs.map((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId)));
  }, [scope]);

  const selectedFolderKeys = useMemo(() => {
    if (scope.mode !== 'files') return new Set<string>();
    return new Set(scope.folderRefs.map((ref) => folderRefKey(ref.knowledgeSpaceId, ref.folderId)));
  }, [scope]);

  const spaceNameById = useMemo(() => new Map(spaces.map((space) => [space.id, space.name])), [spaces]);
  const spaceOrderById = useMemo(() => new Map(spaces.map((space, index) => [space.id, index])), [spaces]);
  const searchMode = Boolean(searchQuery.trim());
  const searchGroups = useMemo(() => {
    const groups = new Map<number, { spaceId: number; spaceName: string; files: FileItem[] }>();
    for (const file of searchResults) {
      const spaceId = file.spaceId;
      const existing = groups.get(spaceId);
      if (existing) {
        existing.files.push(file);
        continue;
      }
      groups.set(spaceId, {
        spaceId,
        spaceName: file.source || spaceNameById.get(spaceId) || String(spaceId),
        files: [file],
      });
    }
    return [...groups.values()].sort((left, right) => {
      const leftOrder = spaceOrderById.get(left.spaceId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = spaceOrderById.get(right.spaceId) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.spaceName.localeCompare(right.spaceName, 'zh-CN');
    });
  }, [searchResults, spaceNameById, spaceOrderById]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError('');
      setSearchLoading(false);
      return undefined;
    }
    let active = true;
    setSearchLoading(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      void onSearchFiles(q, 1, 20)
        .then((result) => {
          if (!active) return;
          setSearchResults(result.data);
        })
        .catch(() => {
          if (active) setSearchError('加载失败');
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onSearchFiles, searchQuery]);

  const notify = (message: string) => {
    onTip?.(message);
    setInlineTip(message);
    window.setTimeout(() => setInlineTip(''), 2500);
  };

  const loadFolderStats = (spaceId: number, nodes: QaKnowledgeTreeNode[]) => {
    const folders = nodes.filter((node) => {
      const key = folderRefKey(node.spaceId, node.id);
      if (node.type !== 'folder' || requestedFolderStatsKeys.current.has(key)) return false;
      requestedFolderStatsKeys.current.add(key);
      return true;
    });
    if (folders.length === 0) return;

    const keys = folders.map((folder) => folderRefKey(folder.spaceId, folder.id));
    setFolderStatsLoadingKeys((prev) => new Set([...prev, ...keys]));
    setFolderStatsErrorKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => next.delete(key));
      return next;
    });

    void onLoadFolderStats(spaceId, folders.map((folder) => folder.id))
      .then((stats) => {
        const countByFolderId = new Map(stats.map((item) => [item.folderId, item.resolvedFileCount]));
        setChildrenByKey((prev) => Object.fromEntries(
          Object.entries(prev).map(([key, children]) => [
            key,
            children.map((child) => {
              const count = child.spaceId === spaceId ? countByFolderId.get(child.id) : undefined;
              return child.type === 'folder' && count !== undefined
                ? { ...child, resolvedFileCount: count }
                : child;
            }),
          ]),
        ));
        setFolderStatsErrorKeys((prev) => {
          const next = new Set(prev);
          folders.forEach((folder) => {
            if (!countByFolderId.has(folder.id)) next.add(folderRefKey(folder.spaceId, folder.id));
          });
          return next;
        });
      })
      .catch(() => {
        setFolderStatsErrorKeys((prev) => new Set([...prev, ...keys]));
      })
      .finally(() => {
        setFolderStatsLoadingKeys((prev) => {
          const next = new Set(prev);
          keys.forEach((key) => next.delete(key));
          return next;
        });
      });
  };

  const loadChildren = async (spaceId: number, parentId?: number | null) => {
    const key = nodeChildrenKey(spaceId, parentId);
    if (childrenByKey[key] || loadingKeys.has(key)) return;
    setLoadingKeys((prev) => new Set(prev).add(key));
    setErrorKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const result = await onLoadChildren(spaceId, parentId ?? undefined);
      setChildrenByKey((prev) => ({ ...prev, [key]: result.data }));
      setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
      setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
      loadFolderStats(spaceId, result.data);
    } catch {
      setErrorKeys((prev) => new Set(prev).add(key));
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const loadMoreChildren = async (spaceId: number, parentId?: number | null) => {
    const key = nodeChildrenKey(spaceId, parentId);
    if (!hasMoreByKey[key] || loadingMoreKeys.has(key)) return;
    const cursor = nextCursorByKey[key];
    if (!cursor) return;
    setLoadingMoreKeys((prev) => new Set(prev).add(key));
    setErrorKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const result = await onLoadChildren(spaceId, parentId ?? undefined, cursor);
      setChildrenByKey((prev) => {
        const existing = prev[key] ?? [];
        const seen = new Set(existing.map((n) => `${n.spaceId}-${n.id}`));
        const merged = [...existing, ...result.data.filter((n) => !seen.has(`${n.spaceId}-${n.id}`))];
        return { ...prev, [key]: merged };
      });
      setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
      setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
      loadFolderStats(spaceId, result.data);
    } catch {
      setErrorKeys((prev) => new Set(prev).add(key));
    } finally {
      setLoadingMoreKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleExpand = (spaceId: number, parentId?: number | null) => {
    const key = nodeChildrenKey(spaceId, parentId);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void loadChildren(spaceId, parentId);
      }
      return next;
    });
  };

  const toggleWholeSpace = (space: KnowledgeSpace) => {
    if (scope.mode === 'knowledge_space' && scope.knowledgeSpaceId === space.id) {
      onChange({ mode: 'none' });
      return;
    }
    if (scope.mode === 'knowledge_space' && scope.knowledgeSpaceId !== space.id) {
      notify(WHOLE_SPACE_LIMIT_TIP);
      return;
    }
    onChange({ mode: 'knowledge_space', knowledgeSpaceId: space.id });
  };

  const isFileSelected = (spaceId: number, fileId: number) => selectedFileKeys.has(fileRefKey(spaceId, fileId));

  const collectKnownFolderFileRefs = (node: QaKnowledgeTreeNode): QaKnowledgeFileRef[] => {
    const refs: QaKnowledgeFileRef[] = [];
    const visit = (parent: QaKnowledgeTreeNode) => {
      const children = childrenByKey[nodeChildrenKey(parent.spaceId, parent.id)] ?? [];
      for (const child of children) {
        if (child.type === 'file') {
          refs.push({ knowledgeSpaceId: child.spaceId, fileId: child.id });
        } else {
          visit(child);
        }
      }
    };
    visit(node);
    return refs;
  };

  const toggleFileRef = (file: { spaceId: number; id: number }) => {
    const current = asFilesScope(scope);
    const key = fileRefKey(file.spaceId, file.id);
    const exists = selectedFileKeys.has(key);
    const fileRefs = exists
      ? current.fileRefs.filter((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId) !== key)
      : [...current.fileRefs, { knowledgeSpaceId: file.spaceId, fileId: file.id }];
    const nextScope = buildFilesScope(fileRefs, current.folderRefs);
    if (!exists && nextScope.resolvedFileCount > 20) {
      notify(FILE_LIMIT_TIP);
      return;
    }
    onChange(nextScope);
  };

  const toggleFolderRef = (node: QaKnowledgeTreeNode) => {
    const current = asFilesScope(scope);
    const key = folderRefKey(node.spaceId, node.id);
    const exists = selectedFolderKeys.has(key);
    const folderRefs: QaKnowledgeFolderRef[] = exists
      ? current.folderRefs.filter((ref) => folderRefKey(ref.knowledgeSpaceId, ref.folderId) !== key)
      : [
        ...current.folderRefs,
        {
          knowledgeSpaceId: node.spaceId,
          folderId: node.id,
          resolvedFileCount: node.resolvedFileCount,
          fileRefs: collectKnownFolderFileRefs(node),
        },
      ];
    const nextScope = buildFilesScope(current.fileRefs, folderRefs);
    if (!exists && nextScope.resolvedFileCount > 20) {
      notify(FILE_LIMIT_TIP);
      return;
    }
    onChange(nextScope);
  };

  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMoreChildren);
  loadMoreRef.current = loadMoreChildren;
  const sentinelCbRef = useRef<(el: HTMLDivElement | null, spaceId: number, parentId?: number | null) => void>(undefined);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const targets = new Map<Element, { spaceId: number; parentId?: number | null }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const meta = targets.get(entry.target);
        if (meta) void loadMoreRef.current(meta.spaceId, meta.parentId);
      }
    }, { root, rootMargin: '80px' });
    sentinelCbRef.current = (el, spaceId, parentId) => {
      if (!el) return;
      targets.set(el, { spaceId, parentId });
      observer.observe(el);
    };
    return () => observer.disconnect();
  }, []);

  const renderNode = (node: QaKnowledgeTreeNode, depth: number) => {
    const key = nodeChildrenKey(node.spaceId, node.id);
    const expanded = expandedKeys.has(key);
    const loadingNode = loadingKeys.has(key);
    const errored = errorKeys.has(key);
    const children = childrenByKey[key] ?? [];
    const spaceWhole = scope.mode === 'knowledge_space' && scope.knowledgeSpaceId === node.spaceId;
    const isFolderSelected = selectedFolderKeys.has(folderRefKey(node.spaceId, node.id));
    const folderStatsKey = folderRefKey(node.spaceId, node.id);
    const folderStatsLoading = node.type === 'folder' && folderStatsLoadingKeys.has(folderStatsKey);
    const folderStatsError = node.type === 'folder' && folderStatsErrorKeys.has(folderStatsKey);
    const selected = spaceWhole || (node.type === 'file'
      ? isFileSelected(node.spaceId, node.id)
      : isFolderSelected);
    return (
      <div key={`${node.spaceId}-${node.id}`} className={s.treeNode}>
        <div className={s.nodeRow} style={{ paddingLeft: 14 + depth * 24 }}>
          {node.type === 'folder' ? (
            <button
              type="button"
              className={s.expandButton}
              onClick={() => toggleExpand(node.spaceId, node.id)}
              aria-label={expanded ? '收起目录' : '展开目录'}
              title={expanded ? '收起目录' : '展开目录'}
            >
              {loadingNode ? <Loader2 size={14} className={s.spin} /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className={s.expandSpacer} />
          )}
          <button
            type="button"
            className={`${s.checkBox} ${selected ? s.checkBoxActive : ''}`}
            disabled={!node.selectable || spaceWhole || folderStatsLoading || folderStatsError}
            onClick={() => (node.type === 'file' ? toggleFileRef({ spaceId: node.spaceId, id: node.id }) : toggleFolderRef(node))}
            title={spaceWhole
              ? '已按整库选择，取消整库后可单独选择'
              : folderStatsLoading
                ? '文件数量加载中'
                : folderStatsError
                  ? '文件数量加载失败，暂不可选择该文件夹'
                  : (node.disabledReason || '')}
          >
            {selected ? <Check size={13} /> : null}
          </button>
          <span className={`${s.nodeIcon} ${node.type === 'folder' ? s.folderIcon : ''}`}>{node.type === 'folder' ? <Folder size={15} /> : <FileText size={15} />}</span>
          <span className={`${s.nodeText} ${node.type === 'folder' ? s.folderNodeText : ''} ${selected && node.type === 'file' ? s.nodeTextActive : ''}`}>
            <strong>{node.name}</strong>
            {node.type === 'folder' ? (
              folderStatsLoading ? (
                <span className={s.folderCount} role="status" aria-label={`${node.name} 文件数量加载中`}>
                  <Loader2 size={14} className={s.spin} aria-hidden="true" />
                </span>
              ) : folderStatsError ? (
                <span className={`${s.folderCount} ${s.folderCountError}`} role="alert" title="文件数量加载失败">
                  （数量加载失败）
                </span>
              ) : (
                <span className={s.folderCount}>（{node.resolvedFileCount}个文件）</span>
              )
            ) : null}
          </span>
        </div>
        {expanded ? (
          <div className={s.nodeChildren}>
            {errored ? <div className={s.stateLine}>加载失败</div> : null}
            {!errored && !loadingNode && children.length === 0 ? <div className={s.stateLine}>暂无可见内容</div> : null}
            {children.map((child) => renderNode(child, depth + 1))}
            {hasMoreByKey[key] ? (
              <div ref={(el) => sentinelCbRef.current?.(el, node.spaceId, node.id)} className={s.loadMoreSentinel}>
                {loadingMoreKeys.has(key) ? <Loader2 size={14} className={s.spin} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.panel} style={maxHeight ? { maxHeight } : undefined}>
      <div className={s.header}>
        <strong className={s.headerTitle}>知识库范围</strong>
        <button
          type="button"
          onClick={() => onClose?.()}
          className={s.closeButton}
          title="关闭"
        >
          <X size={18} />
        </button>
      </div>

      {inlineTip ? <div className={s.inlineTip}>{inlineTip}</div> : null}

      <label className={s.searchBox}>
        <Search size={15} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="文件名搜索/编码搜索"
        />
      </label>

      <div className={s.searchDivider} />

      <div className={s.selectedBar}>
        <span className={s.selectedBarLeft}>
          <i className={s.selectedBarMark} />
          <span className={s.selectedText}>
            已选择 <b>{scope.mode === 'knowledge_space' ? 1 : getScopeFileCount(scope)}</b>
            {scope.mode === 'knowledge_space' ? ' 个整库' : ' 个文件'}
          </span>
          {scope.mode !== 'none' ? (
            <button
              type="button"
              className={s.clearButton}
              onClick={() => onChange({ mode: 'none' })}
              title="清空已选"
            >
              清空选择
            </button>
          ) : null}
        </span>
        <span className={s.selectedHint}>整库限选1个，文件最多20个</span>
      </div>

      <div className={s.spaceList} ref={scrollRootRef}>
        {searchMode ? (
          <>
            {searchLoading ? <div className={s.stateLine}><Loader2 size={14} className={s.spin} /> 搜索中</div> : null}
            {searchError ? <div className={s.stateLine}>{searchError}</div> : null}
            {!searchLoading && !searchError && searchGroups.length === 0 ? <div className={s.stateLine}>搜索无结果</div> : null}
            {!searchLoading && !searchError ? searchGroups.map((group) => (
              <section key={`search-${group.spaceId}`} className={`${s.spaceBlock} ${s.searchSpaceBlock}`}>
                <div className={s.searchSpaceHeader}>
                  <Database size={16} className={s.spaceIcon} />
                  <span className={s.spaceContent}>
                    <strong>{group.spaceName}</strong>
                    <span>{group.files.length} 个匹配文件</span>
                  </span>
                </div>
                <div className={s.searchFileList}>
                  {group.files.map((file) => {
                    const selected = isFileSelected(file.spaceId, file.id);
                    return (
                      <button
                        key={`${file.spaceId}-${file.id}`}
                        type="button"
                        className={`${s.searchFileRow} ${selected ? s.searchFileRowActive : ''}`}
                        onClick={() => toggleFileRef({ spaceId: file.spaceId, id: file.id })}
                      >
                        <span className={`${s.checkBox} ${selected ? s.checkBoxActive : ''}`}>
                          {selected ? <Check size={13} /> : null}
                        </span>
                        <FileText size={15} className={s.nodeIcon} />
                        <span className={s.searchMeta}>
                          <strong>{file.title}</strong>
                          {file.fileEncoding ? <span>文件编码：{file.fileEncoding}</span> : null}
                          <span>所在目录：{file.folderPath || file.sourcePath || '根目录'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )) : null}
          </>
        ) : (
          <>
            {loading ? <div className={s.stateLine}><Loader2 size={14} className={s.spin} /> 知识库加载中</div> : null}
            {!loading && spaces.length === 0 ? <div className={s.stateLine}>暂无可见内容</div> : null}
            {spaces.map((space) => {
              const rootKey = nodeChildrenKey(space.id);
              const expanded = expandedKeys.has(rootKey);
              const wholeSelected = scope.mode === 'knowledge_space' && scope.knowledgeSpaceId === space.id;
              const spaceSelectedCount = scope.mode === 'files'
                ? scope.fileRefs.filter((ref) => ref.knowledgeSpaceId === space.id).length
                + scope.folderRefs
                  .filter((ref) => ref.knowledgeSpaceId === space.id)
                  .reduce((sum, ref) => sum + (ref.resolvedFileCount || 0), 0)
                : 0;
              const full = wholeSelected || (space.fileCount > 0 && spaceSelectedCount >= space.fileCount);
              const indeterminate = !full && spaceSelectedCount > 0;
              const children = childrenByKey[rootKey] ?? [];
              const loadingRoot = loadingKeys.has(rootKey);
              const erroredRoot = errorKeys.has(rootKey);
              return (
                <section key={space.id} className={`${s.spaceBlock} ${expanded ? s.spaceBlockExpanded : ''}`}>
                  <div className={`${s.spaceRow} ${full ? s.spaceRowActive : ''}`}>
                    <button
                      type="button"
                      className={s.expandButton}
                      onClick={() => toggleExpand(space.id)}
                      aria-label={expanded ? '收起目录' : '展开目录'}
                      title={expanded ? '收起目录' : '展开目录'}
                    >
                      {loadingRoot ? <Loader2 size={14} className={s.spin} /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <button
                      type="button"
                      className={`${s.checkBox} ${full || indeterminate ? s.checkBoxActive : ''}`}
                      onClick={() => toggleWholeSpace(space)}
                      aria-label={`选择知识库 ${space.name}`}
                    >
                      {full ? <Check size={13} /> : indeterminate ? <Minus size={13} /> : null}
                    </button>
                    <div className={s.spaceContent}>
                      <button type="button" className={s.spaceTitleButton} onClick={() => toggleExpand(space.id)}>
                        <strong>{space.name}</strong>
                      </button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className={s.rootChildren}>
                      {erroredRoot ? <div className={s.stateLine}>加载失败</div> : null}
                      {!erroredRoot && !loadingRoot && children.length === 0 ? <div className={s.stateLine}>暂无可见内容</div> : null}
                      {children.map((node) => renderNode(node, 1))}
                      {hasMoreByKey[rootKey] ? (
                        <div ref={(el) => sentinelCbRef.current?.(el, space.id, undefined)} className={s.loadMoreSentinel}>
                          {loadingMoreKeys.has(rootKey) ? <Loader2 size={14} className={s.spin} /> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
