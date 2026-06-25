import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  Loader2,
  Search,
  X
} from 'lucide-react';
import type {
  FileItem,
  KnowledgeSpace,
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
  onSearchFiles,
  onTip,
  onClose
}: {
  spaces: KnowledgeSpace[];
  scope: QaKnowledgeScope;
  loading: boolean;
  onChange: (scope: QaKnowledgeScope) => void;
  onLoadChildren: (spaceId: number, parentId?: number) => Promise<{ data: QaKnowledgeTreeNode[] }>;
  onSearchFiles: (q: string, page?: number, pageSize?: number) => Promise<{ data: FileItem[]; total: number }>;
  onTip?: (message: string) => void;
  onClose?: () => void;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [childrenByKey, setChildrenByKey] = useState<Record<string, QaKnowledgeTreeNode[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

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

  const notify = (message: string) => onTip?.(message);

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

  const renderNode = (node: QaKnowledgeTreeNode, depth: number) => {
    const key = nodeChildrenKey(node.spaceId, node.id);
    const expanded = expandedKeys.has(key);
    const loadingNode = loadingKeys.has(key);
    const errored = errorKeys.has(key);
    const children = childrenByKey[key] ?? [];
    const isFolderSelected = selectedFolderKeys.has(folderRefKey(node.spaceId, node.id));
    const selected = node.type === 'file'
      ? isFileSelected(node.spaceId, node.id)
      : isFolderSelected;
    return (
      <div key={`${node.spaceId}-${node.id}`} className={s.treeNode}>
        <div className={s.nodeRow} style={{ paddingLeft: 12 + depth * 18 }}>
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
            disabled={!node.selectable}
            onClick={() => (node.type === 'file' ? toggleFileRef({ spaceId: node.spaceId, id: node.id }) : toggleFolderRef(node))}
            title={node.disabledReason || ''}
          >
            {selected ? <Check size={13} /> : null}
          </button>
          <span className={s.nodeIcon}>{node.type === 'folder' ? <Folder size={15} /> : <FileText size={15} />}</span>
          <span className={s.nodeText}>
            <strong>{node.name}</strong>
            <span>{node.type === 'folder' ? `${node.resolvedFileCount} 个文件` : node.fileExt || '文件'}</span>
          </span>
        </div>
        {expanded ? (
          <div className={s.nodeChildren}>
            {errored ? <div className={s.stateLine}>加载失败</div> : null}
            {!errored && !loadingNode && children.length === 0 ? <div className={s.stateLine}>暂无可见内容</div> : null}
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.panel}>
    <div className={s.header}>
      <div>
        <strong>知识库范围</strong>
        <span>整库限选 1 个，文件最多 20 个</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>
          {scope.mode === 'knowledge_space' ? '整库' : scope.mode === 'files' ? `${getScopeFileCount(scope)} 文件` : '未选择'}
        </span>
        <button
          type="button"
          onClick={() => onClose?.()}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 0',
            display: 'flex',
            alignItems: 'center',
            color: '#999',
          }}
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>
    </div>

      <label className={s.searchBox}>
        <Search size={15} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="文件名搜索/编码搜索"
        />
      </label>

      <div className={s.spaceList}>
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
          const checked = scope.mode === 'knowledge_space' && scope.knowledgeSpaceId === space.id;
          const children = childrenByKey[rootKey] ?? [];
          const loadingRoot = loadingKeys.has(rootKey);
          const erroredRoot = errorKeys.has(rootKey);
          return (
            <section key={space.id} className={s.spaceBlock}>
              <div className={`${s.spaceRow} ${checked ? s.spaceRowActive : ''}`}>
                <button
                  type="button"
                  className={`${s.checkBox} ${checked ? s.checkBoxActive : ''}`}
                  onClick={() => toggleWholeSpace(space)}
                  aria-label={`选择知识库 ${space.name}`}
                >
                  {checked ? <Check size={13} /> : null}
                </button>
                <Database size={16} className={s.spaceIcon} />
                <div className={s.spaceContent}>
                  <button type="button" className={s.spaceTitleButton} onClick={() => toggleExpand(space.id)}>
                    <strong>{space.name}</strong>
                  </button>
                  <button
                    type="button"
                    className={`${s.spaceAction} ${expanded ? s.spaceActionActive : ''}`}
                    onClick={() => toggleExpand(space.id)}
                  >
                    {loadingRoot ? <Loader2 size={13} className={s.spin} /> : expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className={s.spaceActionText}>
                      {expanded ? '收起目录（可多选子项）' : '展开目录（可多选子项）'}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  className={s.expandButton}
                  onClick={() => toggleExpand(space.id)}
                  aria-label={expanded ? '收起目录' : '展开目录'}
                  title={expanded ? '收起目录' : '展开目录'}
                >
                  {loadingRoot ? <Loader2 size={14} className={s.spin} /> : expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </div>
              {expanded ? (
                <div className={s.rootChildren}>
                  {erroredRoot ? <div className={s.stateLine}>加载失败</div> : null}
                  {!erroredRoot && !loadingRoot && children.length === 0 ? <div className={s.stateLine}>暂无可见内容</div> : null}
                  {children.map((node) => renderNode(node, 1))}
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
