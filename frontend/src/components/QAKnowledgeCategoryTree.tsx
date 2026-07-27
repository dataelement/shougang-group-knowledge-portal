import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
} from 'lucide-react';
import type { FileItem, QaKnowledgeScope } from '../api/content';
import type { RuntimeDocumentTypeGroupOption } from '../utils/documentTypes';
import { buildFilesScope, fileRefKey } from './qaKnowledgeScopeSelection';
import s from './QAKnowledgeTreePicker.module.css';

const FILE_LIMIT_TIP = '一次最多可选择20个文件进行问答。';

type BrowseCategoryFiles = (params: {
  documentType?: string;
  fileSubcategoryCode?: string;
  cursor?: string | null;
  limit?: number;
}) => Promise<{ data: FileItem[]; hasMore: boolean; nextCursor: string | null }>;

function asFilesScope(scope: QaKnowledgeScope): Extract<QaKnowledgeScope, { mode: 'files' }> {
  if (scope.mode === 'files') return scope;
  return { mode: 'files', fileRefs: [], folderRefs: [], resolvedFileCount: 0 };
}

function isFileSelectable(file: FileItem): boolean {
  return !file.isDepartmentFile || file.contentAccess === 'allowed';
}

function categoryNodeKey(kind: 'l1' | 'l2', code: string, parentCode?: string) {
  return kind === 'l1' ? `l1:${code}` : `l2:${parentCode}:${code}`;
}

export default function QAKnowledgeCategoryTree({
  groups,
  scope,
  onChange,
  onBrowseFiles,
  onTip,
}: {
  groups: RuntimeDocumentTypeGroupOption[];
  scope: QaKnowledgeScope;
  onChange: (scope: QaKnowledgeScope) => void;
  onBrowseFiles: BrowseCategoryFiles;
  onTip?: (message: string) => void;
}) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [filesByKey, setFilesByKey] = useState<Record<string, FileItem[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [errorKeys, setErrorKeys] = useState<Set<string>>(() => new Set());
  const [nextCursorByKey, setNextCursorByKey] = useState<Record<string, string | null>>({});
  const [hasMoreByKey, setHasMoreByKey] = useState<Record<string, boolean>>({});
  const [loadingMoreKeys, setLoadingMoreKeys] = useState<Set<string>>(() => new Set());

  const selectedFileKeys = useMemo(() => {
    if (scope.mode !== 'files') return new Set<string>();
    return new Set(scope.fileRefs.map((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId)));
  }, [scope]);

  const notify = (message: string) => onTip?.(message);

  const loadFiles = async (
    key: string,
    filters: { documentType?: string; fileSubcategoryCode?: string },
    cursor?: string | null,
  ) => {
    if (cursor) {
      if (!hasMoreByKey[key] || loadingMoreKeys.has(key)) return;
      setLoadingMoreKeys((prev) => new Set(prev).add(key));
    } else {
      if (filesByKey[key] || loadingKeys.has(key)) return;
      setLoadingKeys((prev) => new Set(prev).add(key));
    }
    setErrorKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const result = await onBrowseFiles({ ...filters, cursor: cursor ?? undefined });
      setFilesByKey((prev) => {
        if (!cursor) return { ...prev, [key]: result.data };
        const existing = prev[key] ?? [];
        const seen = new Set(existing.map((file) => fileRefKey(file.spaceId, file.id)));
        return {
          ...prev,
          [key]: [...existing, ...result.data.filter((file) => !seen.has(fileRefKey(file.spaceId, file.id)))],
        };
      });
      setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
      setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
    } catch {
      setErrorKeys((prev) => new Set(prev).add(key));
    } finally {
      if (cursor) {
        setLoadingMoreKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  };

  const toggleExpand = (
    key: string,
    filters: { documentType?: string; fileSubcategoryCode?: string },
    loadOnExpand: boolean,
  ) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (loadOnExpand) void loadFiles(key, filters);
      }
      return next;
    });
  };

  const toggleFileRef = (file: FileItem) => {
    if (!isFileSelectable(file)) {
      notify('申请后可用于问答');
      return;
    }
    const current = asFilesScope(scope);
    const key = fileRefKey(file.spaceId, file.id);
    const exists = selectedFileKeys.has(key);
    const fileRefs = exists
      ? current.fileRefs.filter((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId) !== key)
      : [...current.fileRefs, { knowledgeSpaceId: file.spaceId, fileId: file.id }];
    const nextScope = buildFilesScope(fileRefs, []);
    if (!exists && nextScope.resolvedFileCount > 20) {
      notify(FILE_LIMIT_TIP);
      return;
    }
    onChange(nextScope.resolvedFileCount ? nextScope : { mode: 'none' });
  };

  const renderFileRow = (file: FileItem, depth: number) => {
    const selectable = isFileSelectable(file);
    const selected = selectedFileKeys.has(fileRefKey(file.spaceId, file.id));
    return (
      <div key={`${file.spaceId}-${file.id}`} className={s.treeNode}>
        <div className={s.nodeRow} style={{ paddingLeft: 14 + depth * 24 }}>
          <span className={s.expandSpacer} />
          <button
            type="button"
            className={`${s.checkBox} ${selected ? s.checkBoxActive : ''}`}
            disabled={!selectable}
            title={selectable ? '' : '申请后可用于问答'}
            onClick={() => toggleFileRef(file)}
          >
            {selected ? <Check size={13} /> : null}
          </button>
          <span className={s.nodeIcon}><FileText size={15} /></span>
          <span className={`${s.nodeText} ${selected ? s.nodeTextActive : ''}`}>
            <strong>{file.title}</strong>
            {file.source ? <span className={s.folderCount}> · {file.source}</span> : null}
          </span>
        </div>
      </div>
    );
  };

  const renderFileList = (
    key: string,
    filters: { documentType?: string; fileSubcategoryCode?: string },
    depth: number,
  ) => {
    const files = filesByKey[key] ?? [];
    const loading = loadingKeys.has(key);
    const errored = errorKeys.has(key);
    return (
      <div className={s.nodeChildren}>
        {errored ? <div className={s.stateLine} style={{ paddingLeft: 14 + depth * 24 + 79 }}>加载失败</div> : null}
        {loading ? (
          <div className={s.stateLine} style={{ paddingLeft: 14 + depth * 24 + 79 }}>
            <Loader2 size={14} className={s.spin} /> 加载中
          </div>
        ) : null}
        {!errored && !loading && files.length === 0 ? (
          <div className={s.stateLine} style={{ paddingLeft: 14 + depth * 24 + 79 }}>暂无可见文件</div>
        ) : null}
        {files.map((file) => renderFileRow(file, depth))}
        {hasMoreByKey[key] ? (
          <button
            type="button"
            className={s.clearButton}
            style={{ marginLeft: 14 + depth * 24 + 50, marginBottom: 8 }}
            disabled={loadingMoreKeys.has(key)}
            onClick={() => void loadFiles(key, filters, nextCursorByKey[key])}
          >
            {loadingMoreKeys.has(key) ? '加载中…' : '加载更多'}
          </button>
        ) : null}
      </div>
    );
  };

  if (!groups.length) {
    return <div className={s.stateLine}>暂无文件分类配置</div>;
  }

  return (
    <div className={s.spaceTreeWrapper}>
      {groups.map((group) => {
        const flatLeaf = group.children.length === 1 && group.children[0].code === group.code;
        const l1Key = categoryNodeKey('l1', group.code);
        const l1Expanded = expandedKeys.has(l1Key);
        const l1Filters = { documentType: group.code };

        return (
          <section key={group.code} className={`${s.spaceBlock} ${l1Expanded ? s.spaceBlockExpanded : ''}`}>
            <div className={s.spaceRow}>
              <Folder size={18} className={s.spaceHeaderIcon} />
              <div className={s.spaceContent}>
                <button
                  type="button"
                  className={s.spaceTitleButton}
                  onClick={() => toggleExpand(l1Key, l1Filters, flatLeaf)}
                >
                  <strong>{group.label}</strong>
                </button>
              </div>
              <button
                type="button"
                className={s.expandButton}
                onClick={() => toggleExpand(l1Key, l1Filters, flatLeaf)}
                aria-label={l1Expanded ? '收起分类' : '展开分类'}
              >
                {loadingKeys.has(l1Key) ? <Loader2 size={14} className={s.spin} /> : l1Expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
            {l1Expanded ? (
              flatLeaf ? (
                renderFileList(l1Key, l1Filters, 1)
              ) : (
                <div className={s.rootChildren}>
                  {group.children.map((child) => {
                    const l2Key = categoryNodeKey('l2', child.code, group.code);
                    const l2Expanded = expandedKeys.has(l2Key);
                    const l2Filters = { fileSubcategoryCode: child.code };
                    return (
                      <div key={l2Key} className={s.treeNode}>
                        <div className={s.nodeRow} style={{ paddingLeft: 14 + 24 }}>
                          <button
                            type="button"
                            className={s.expandButton}
                            onClick={() => toggleExpand(l2Key, l2Filters, true)}
                            aria-label={l2Expanded ? '收起分类' : '展开分类'}
                          >
                            {loadingKeys.has(l2Key) ? <Loader2 size={14} className={s.spin} /> : l2Expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <span className={`${s.nodeIcon} ${s.folderIcon}`}><Folder size={15} /></span>
                          <span className={s.nodeText}><strong>{child.label}</strong></span>
                        </div>
                        {l2Expanded ? renderFileList(l2Key, l2Filters, 2) : null}
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
