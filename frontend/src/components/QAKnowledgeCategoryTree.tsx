import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  Minus,
} from 'lucide-react';
import type { FileItem, QaKnowledgeFileRef, QaKnowledgeScope } from '../api/content';
import type { RuntimeDocumentTypeGroupOption } from '../utils/documentTypes';
import { buildFilesScope, fileRefKey } from './qaKnowledgeScopeSelection';
import s from './QAKnowledgeTreePicker.module.css';

const FILE_LIMIT = 20;
const FILE_LIMIT_TIP = '一次最多可选择20个文件进行问答。';

type BrowseCategoryFiles = (params: {
  documentType?: string;
  fileSubcategoryCode?: string;
  cursor?: string | null;
  limit?: number;
}) => Promise<{ data: FileItem[]; hasMore: boolean; nextCursor: string | null }>;

type CategoryFilters = { documentType?: string; fileSubcategoryCode?: string };

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
  const [selectingKeys, setSelectingKeys] = useState<Set<string>>(() => new Set());

  const selectedFileKeys = useMemo(() => {
    if (scope.mode !== 'files') return new Set<string>();
    return new Set(scope.fileRefs.map((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId)));
  }, [scope]);

  const notify = (message: string) => onTip?.(message);

  const mergeFetchedFiles = (key: string, incoming: FileItem[], append: boolean) => {
    setFilesByKey((prev) => {
      if (!append) return { ...prev, [key]: incoming };
      const existing = prev[key] ?? [];
      const seen = new Set(existing.map((file) => fileRefKey(file.spaceId, file.id)));
      return {
        ...prev,
        [key]: [...existing, ...incoming.filter((file) => !seen.has(fileRefKey(file.spaceId, file.id)))],
      };
    });
  };

  const loadFiles = async (
    key: string,
    filters: CategoryFilters,
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
      mergeFetchedFiles(key, result.data, Boolean(cursor));
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

  const ensureCategoryFilesLoaded = async (key: string, filters: CategoryFilters): Promise<FileItem[]> => {
    let files = filesByKey[key];
    let cursor = nextCursorByKey[key] ?? null;
    let hasMore = hasMoreByKey[key] ?? false;

    if (!files) {
      setLoadingKeys((prev) => new Set(prev).add(key));
      setErrorKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      try {
        const result = await onBrowseFiles({ ...filters });
        files = result.data;
        cursor = result.nextCursor;
        hasMore = result.hasMore;
        mergeFetchedFiles(key, result.data, false);
        setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
        setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
      } catch {
        setErrorKeys((prev) => new Set(prev).add(key));
        return [];
      } finally {
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }

    while (hasMore && cursor) {
      setLoadingMoreKeys((prev) => new Set(prev).add(key));
      try {
        const result = await onBrowseFiles({ ...filters, cursor });
        const existing = files ?? [];
        const seen = new Set(existing.map((file) => fileRefKey(file.spaceId, file.id)));
        files = [...existing, ...result.data.filter((file) => !seen.has(fileRefKey(file.spaceId, file.id)))];
        cursor = result.nextCursor;
        hasMore = result.hasMore;
        mergeFetchedFiles(key, result.data, true);
        setNextCursorByKey((prev) => ({ ...prev, [key]: result.nextCursor }));
        setHasMoreByKey((prev) => ({ ...prev, [key]: result.hasMore }));
      } catch {
        setErrorKeys((prev) => new Set(prev).add(key));
        break;
      } finally {
        setLoadingMoreKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }

    return files ?? [];
  };

  const toggleExpand = (
    key: string,
    filters: CategoryFilters,
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
    const nextScope = buildFilesScope(fileRefs, current.folderRefs);
    if (!exists && nextScope.resolvedFileCount > FILE_LIMIT) {
      notify(FILE_LIMIT_TIP);
      return;
    }
    onChange(nextScope.resolvedFileCount ? nextScope : { mode: 'none' });
  };

  const categoryCheckState = (files: FileItem[]): 'none' | 'partial' | 'all' => {
    const selectable = files.filter(isFileSelectable);
    if (!selectable.length) return 'none';
    let selectedCount = 0;
    for (const file of selectable) {
      if (selectedFileKeys.has(fileRefKey(file.spaceId, file.id))) selectedCount += 1;
    }
    if (selectedCount === 0) return 'none';
    if (selectedCount === selectable.length) return 'all';
    return 'partial';
  };

  const toggleCategoryFiles = async (
    selectionKey: string,
    targets: Array<{ key: string; filters: CategoryFilters }>,
  ) => {
    if (selectingKeys.has(selectionKey)) return;
    setSelectingKeys((prev) => new Set(prev).add(selectionKey));
    try {
      const loadedGroups = await Promise.all(
        targets.map(async (target) => ({
          key: target.key,
          files: await ensureCategoryFilesLoaded(target.key, target.filters),
        })),
      );
      const allFiles = loadedGroups.flatMap((group) => group.files);
      const selectable = allFiles.filter(isFileSelectable);
      if (!selectable.length) {
        notify('该分类下暂无可用文件');
        return;
      }

      const state = categoryCheckState(allFiles);
      const current = asFilesScope(scope);
      const targetKeys = new Set(selectable.map((file) => fileRefKey(file.spaceId, file.id)));

      if (state === 'all') {
        const fileRefs = current.fileRefs.filter(
          (ref) => !targetKeys.has(fileRefKey(ref.knowledgeSpaceId, ref.fileId)),
        );
        const nextScope = buildFilesScope(fileRefs, current.folderRefs);
        onChange(nextScope.resolvedFileCount ? nextScope : { mode: 'none' });
        return;
      }

      const mergedRefs: QaKnowledgeFileRef[] = [...current.fileRefs];
      const seen = new Set(mergedRefs.map((ref) => fileRefKey(ref.knowledgeSpaceId, ref.fileId)));
      for (const file of selectable) {
        const key = fileRefKey(file.spaceId, file.id);
        if (seen.has(key)) continue;
        mergedRefs.push({ knowledgeSpaceId: file.spaceId, fileId: file.id });
        seen.add(key);
      }
      const nextScope = buildFilesScope(mergedRefs, current.folderRefs);
      if (nextScope.resolvedFileCount > FILE_LIMIT) {
        notify(FILE_LIMIT_TIP);
        return;
      }
      onChange(nextScope);

      setExpandedKeys((prev) => {
        const next = new Set(prev);
        for (const target of targets) next.add(target.key);
        return next;
      });
    } finally {
      setSelectingKeys((prev) => {
        const next = new Set(prev);
        next.delete(selectionKey);
        return next;
      });
    }
  };

  const renderCheckBox = (
    state: 'none' | 'partial' | 'all',
    opts: {
      busy?: boolean;
      disabled?: boolean;
      ariaLabel: string;
      onClick: () => void;
    },
  ) => (
    <button
      type="button"
      className={`${s.checkBox} ${state !== 'none' ? s.checkBoxActive : ''}`}
      disabled={opts.disabled || opts.busy}
      aria-label={opts.ariaLabel}
      title={opts.disabled ? '申请后可用于问答' : ''}
      onClick={(event) => {
        event.stopPropagation();
        opts.onClick();
      }}
    >
      {opts.busy ? <Loader2 size={13} className={s.spin} /> : state === 'all' ? <Check size={13} /> : state === 'partial' ? <Minus size={13} /> : null}
    </button>
  );

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
    filters: CategoryFilters,
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
        const l1Filters: CategoryFilters = { documentType: group.code };
        const l1Targets = flatLeaf
          ? [{ key: l1Key, filters: l1Filters }]
          : group.children.map((child) => ({
              key: categoryNodeKey('l2', child.code, group.code),
              filters: { fileSubcategoryCode: child.code } satisfies CategoryFilters,
            }));
        const l1Files = l1Targets.flatMap((target) => filesByKey[target.key] ?? []);
        const l1State = categoryCheckState(l1Files);
        const l1Busy = selectingKeys.has(l1Key)
          || l1Targets.some((target) => loadingKeys.has(target.key) || loadingMoreKeys.has(target.key));

        return (
          <section key={group.code} className={`${s.spaceBlock} ${l1Expanded ? s.spaceBlockExpanded : ''}`}>
            <div className={s.spaceRow}>
              {renderCheckBox(l1State, {
                busy: l1Busy,
                ariaLabel: `选择分类 ${group.label}`,
                onClick: () => {
                  void toggleCategoryFiles(l1Key, l1Targets);
                  setExpandedKeys((prev) => new Set(prev).add(l1Key));
                },
              })}
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
                    const l2Filters: CategoryFilters = { fileSubcategoryCode: child.code };
                    const l2Files = filesByKey[l2Key] ?? [];
                    const l2State = categoryCheckState(l2Files);
                    const l2Busy = selectingKeys.has(l2Key)
                      || loadingKeys.has(l2Key)
                      || loadingMoreKeys.has(l2Key);
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
                          {renderCheckBox(l2State, {
                            busy: l2Busy,
                            ariaLabel: `选择分类 ${child.label}`,
                            onClick: () => void toggleCategoryFiles(l2Key, [{ key: l2Key, filters: l2Filters }]),
                          })}
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
