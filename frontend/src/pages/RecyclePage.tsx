import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Loader2,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import Pagination from '../components/Pagination';
import FilterBar from '../components/FilterBar';
import { ActionToast } from '../components/ActionToast';
import { useActionToast } from '../hooks/useActionToast';
import {
  fetchRecycleConfig,
  fetchRecycleItems,
  previewRestore,
  purgeRecycleItems,
  restoreRecycleItems,
  updateRecycleConfig,
  type RecycleItem,
} from '../api/recycle';
import {
  fetchKnowledgeSpaces,
  fetchQaKnowledgeTreeChildren,
  type KnowledgeSpace,
} from '../api/content';
import { formatDisplayDateTime } from '../utils/dateTime';
import s from './RecyclePage.module.css';

const PAGE_SIZE = 20;

const SPACE_LEVEL_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队/科室知识库' },
  { value: 'personal', label: '个人知识库' },
];

const SPACE_LEVEL_ORDER = ['public', 'department', 'team', 'personal'];

const SPACE_LEVEL_LABELS: Record<string, string> = {
  public: '公共知识库',
  department: '部门知识库',
  team: '团队/科室知识库',
  personal: '个人知识库',
};

function formatTime(value: string | null | undefined): string {
  if (!value) return '-';
  return formatDisplayDateTime(value);
}

function treeChildrenKey(spaceId: number, parentId?: number | null) {
  return `${spaceId}:${parentId ?? 'root'}`;
}

async function loadFolderNodes(spaceId: number, parentId?: number) {
  const folders: Array<{ id: number; name: string; hasChildren: boolean }> = [];
  let cursor: string | null | undefined;
  do {
    const res = await fetchQaKnowledgeTreeChildren(
      spaceId,
      parentId,
      cursor || undefined,
    );
    folders.push(
      ...res.data
        .filter((node) => node.type === 'folder')
        .map((node) => ({
          id: node.id,
          name: node.name,
          hasChildren: Boolean(node.hasChildren),
        })),
    );
    cursor = res.hasMore ? res.nextCursor : null;
  } while (cursor);
  return folders;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  duplicates?: Array<{ name: string; path?: string }>;
  resolve: (ok: boolean) => void;
}

function ConfirmModal({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: (ok: boolean) => void;
}) {
  const isDuplicate = Boolean(state.duplicates?.length);
  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className={s.modal} style={{ maxWidth: isDuplicate ? 460 : 400 }}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{state.title}</span>
          <button type="button" className={s.modalClose} onClick={() => onClose(false)} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
        {isDuplicate ? (
          <div className={s.duplicateBody}>
            <ul className={s.duplicateList}>
              {state.duplicates!.map((entry, index) => (
                <li key={`${entry.name}-${index}`} className={s.duplicateItem}>
                  {entry.name}
                  {entry.path ? `（${entry.path}）` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={s.confirmBody}>
            {state.danger ? (
              <div className={s.confirmIcon}>
                <TriangleAlert size={24} />
              </div>
            ) : null}
            <p className={s.confirmText}>{state.message}</p>
          </div>
        )}
        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={() => onClose(false)}>
            {state.cancelText || '取消'}
          </button>
          <button
            type="button"
            className={!isDuplicate && state.danger ? s.btnDanger : s.btnPrimary}
            onClick={() => onClose(true)}
          >
            {!isDuplicate && state.danger ? <Trash2 size={13} /> : null}
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TargetPathSelection {
  knowledgeId: number;
  folderId: number | null;
}

type FolderTreeNode = { id: number; name: string; hasChildren: boolean };

function TargetRestoreModal({
  spaces,
  loading,
  onClose,
  onConfirm,
}: {
  spaces: KnowledgeSpace[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (selection: TargetPathSelection) => void;
}) {
  const [level, setLevel] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [childrenByKey, setChildrenByKey] = useState<Record<string, FolderTreeNode[]>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [selection, setSelection] = useState<{
    knowledgeId: number;
    folderId: number | null;
    pathLabels: string[];
  } | null>(null);

  const levelOptions = useMemo(() => {
    const present = new Set(
      spaces.map((space) => space.spaceLevel || 'other').filter(Boolean),
    );
    return SPACE_LEVEL_ORDER
      .filter((key) => present.has(key))
      .map((key) => ({ value: key, label: SPACE_LEVEL_LABELS[key] || key }))
      .concat(
        present.has('other')
          ? [{ value: 'other', label: '其他知识库' }]
          : [],
      );
  }, [spaces]);

  const spacesInLevel = useMemo(() => {
    if (!level) return [];
    return spaces
      .filter((space) => (space.spaceLevel || 'other') === level)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [spaces, level]);

  const pathLabels = useMemo(() => {
    if (selection) return selection.pathLabels;
    if (level) return [SPACE_LEVEL_LABELS[level] || level];
    return [];
  }, [level, selection]);

  useEffect(() => {
    if (levelOptions.length === 1 && !level) {
      setLevel(levelOptions[0].value);
    }
  }, [levelOptions, level]);

  const handleLevelChange = (nextLevel: string) => {
    setLevel(nextLevel);
    setExpandedKeys(new Set());
    setChildrenByKey({});
    setLoadingKeys(new Set());
    setSelection(null);
  };

  const loadChildren = async (spaceId: number, parentId?: number | null) => {
    const key = treeChildrenKey(spaceId, parentId);
    if (childrenByKey[key] || loadingKeys.has(key)) return;
    setLoadingKeys((prev) => new Set(prev).add(key));
    try {
      const folders = await loadFolderNodes(spaceId, parentId ?? undefined);
      setChildrenByKey((prev) => ({ ...prev, [key]: folders }));
    } catch {
      setChildrenByKey((prev) => ({ ...prev, [key]: [] }));
    } finally {
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleExpand = (spaceId: number, parentId?: number | null) => {
    const key = treeChildrenKey(spaceId, parentId);
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

  const selectSpace = (space: KnowledgeSpace) => {
    setSelection({
      knowledgeId: space.id,
      folderId: null,
      pathLabels: [SPACE_LEVEL_LABELS[level] || level, space.name],
    });
  };

  const selectFolder = (
    space: KnowledgeSpace,
    folder: FolderTreeNode,
    ancestors: FolderTreeNode[],
  ) => {
    setSelection({
      knowledgeId: space.id,
      folderId: folder.id,
      pathLabels: [
        SPACE_LEVEL_LABELS[level] || level,
        space.name,
        ...ancestors.map((item) => item.name),
        folder.name,
      ],
    });
  };

  const renderFolderNode = (
    space: KnowledgeSpace,
    folder: FolderTreeNode,
    depth: number,
    ancestors: FolderTreeNode[],
  ) => {
    const key = treeChildrenKey(space.id, folder.id);
    const expanded = expandedKeys.has(key);
    const loadingNode = loadingKeys.has(key);
    const children = childrenByKey[key] ?? [];
    const selected =
      selection?.knowledgeId === space.id && selection.folderId === folder.id;

    return (
      <div key={`${space.id}-folder-${folder.id}`} className={s.treeNode}>
        <div
          className={`${s.treeRow} ${selected ? s.treeRowActive : ''}`}
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          <button
            type="button"
            className={s.treeExpand}
            onClick={() => toggleExpand(space.id, folder.id)}
            aria-label={expanded ? '收起目录' : '展开目录'}
          >
            {loadingNode ? (
              <Loader2 size={14} className={s.spin} />
            ) : expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
          <button
            type="button"
            className={s.treeSelect}
            onClick={() => selectFolder(space, folder, ancestors)}
          >
            <Folder size={14} />
            <span>{folder.name}</span>
          </button>
        </div>
        {expanded ? (
          <div className={s.treeChildren}>
            {!loadingNode && children.length === 0 ? (
              <div className={s.treeEmpty} style={{ paddingLeft: 34 + depth * 18 }}>
                暂无下级目录
              </div>
            ) : null}
            {children.map((child) =>
              renderFolderNode(space, child, depth + 1, [...ancestors, folder]),
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderSpaceNode = (space: KnowledgeSpace) => {
    const key = treeChildrenKey(space.id, null);
    const expanded = expandedKeys.has(key);
    const loadingNode = loadingKeys.has(key);
    const children = childrenByKey[key] ?? [];
    const selected =
      selection?.knowledgeId === space.id && selection.folderId === null;

    return (
      <div key={`space-${space.id}`} className={s.treeNode}>
        <div
          className={`${s.treeRow} ${selected ? s.treeRowActive : ''}`}
          style={{ paddingLeft: 8 }}
        >
          <button
            type="button"
            className={s.treeExpand}
            onClick={() => toggleExpand(space.id, null)}
            aria-label={expanded ? '收起知识库' : '展开知识库'}
          >
            {loadingNode ? (
              <Loader2 size={14} className={s.spin} />
            ) : expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
          <button
            type="button"
            className={s.treeSelect}
            onClick={() => selectSpace(space)}
          >
            <Database size={14} />
            <span>{space.name}</span>
          </button>
        </div>
        {expanded ? (
          <div className={s.treeChildren}>
            {!loadingNode && children.length === 0 ? (
              <div className={s.treeEmpty} style={{ paddingLeft: 34 }}>
                暂无目录
              </div>
            ) : null}
            {children.map((folder) => renderFolderNode(space, folder, 1, []))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} style={{ maxWidth: 560 }}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>知识库</span>
          <button type="button" className={s.modalClose} onClick={onClose} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
        <div className={s.modalBody}>
          {loading ? (
            <div className={s.muted}>加载知识库…</div>
          ) : spaces.length === 0 ? (
            <div className={s.muted}>暂无可用知识库</div>
          ) : (
            <>
              {pathLabels.length > 0 ? (
                <div className={s.pathBreadcrumb}>{pathLabels.join(' > ')}</div>
              ) : null}
              <div className={s.cascadeFields}>
                <label className={s.field}>
                  <span className={s.fieldLabel}>知识库类型</span>
                  <select
                    className={s.input}
                    value={level}
                    onChange={(e) => handleLevelChange(e.target.value)}
                  >
                    <option value="">请选择</option>
                    {levelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                {level ? (
                  <div className={s.treePanel}>
                    {spacesInLevel.length === 0 ? (
                      <div className={s.muted}>该类型下暂无知识库</div>
                    ) : (
                      spacesInLevel.map((space) => renderSpaceNode(space))
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={s.btnPrimary}
            disabled={loading || !selection}
            onClick={() => {
              if (!selection) return;
              onConfirm({
                knowledgeId: selection.knowledgeId,
                folderId: selection.folderId,
              });
            }}
          >
            <RotateCcw size={13} />
            确认还原
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RecyclePage() {
  const { toast, showError, showSuccess } = useActionToast();
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [spaceLevel, setSpaceLevel] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const [savingRetention, setSavingRetention] = useState(false);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetSpaces, setTargetSpaces] = useState<KnowledgeSpace[]>([]);
  const [targetSpacesLoading, setTargetSpacesLoading] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const askConfirm = useCallback((opts: Omit<ConfirmState, 'resolve'>) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, config] = await Promise.all([
        fetchRecycleItems({ page, pageSize: PAGE_SIZE, spaceLevel: spaceLevel || undefined }),
        fetchRecycleConfig(),
      ]);
      setItems(list.data || []);
      setTotal(list.total || 0);
      setRetentionDays(config.retention_days || 7);
      setSelected(new Set());
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, spaceLevel, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(items.map((item) => item.id)));
  };

  const handleSaveRetention = async () => {
    setSavingRetention(true);
    try {
      const config = await updateRecycleConfig(retentionDays);
      setRetentionDays(config.retention_days);
      showSuccess(`保留天数已更新为 ${config.retention_days} 天（仅对新进站条目生效）`);
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingRetention(false);
    }
  };

  const executeRestore = async (params: {
    ids: number[];
    mode: 'original' | 'custom';
    targetKnowledgeId?: number;
    targetFolderId?: number | null;
  }) => {
    let mergeFolder = false;
    let overwriteFiles = false;
    const preview = await previewRestore({
      item_ids: params.ids,
      mode: params.mode,
      target_knowledge_id: params.targetKnowledgeId,
      target_folder_id: params.targetFolderId ?? null,
      merge_folder: false,
      overwrite_files: false,
    });
    if (preview.need_confirm_merge) {
      mergeFolder = await askConfirm({
        title: '文件夹冲突',
        message:
          preview.warnings.find((w) => w.code === 'FOLDER_NAME_CONFLICT')?.message
          || '存在重名文件夹，是否合并？',
        confirmText: '合并',
      });
      if (!mergeFolder) return;
    }
    if (preview.need_confirm_overwrite || preview.warnings.some((w) => w.code === 'FILE_OVERWRITE_CONFLICT')) {
      const warning = preview.warnings.find((w) => w.code === 'FILE_OVERWRITE_CONFLICT');
      const duplicates = (warning?.conflicts || [])
        .map((c) => ({
          name: c.name || '',
          path: c.path || undefined,
        }))
        .filter((c) => c.name);
      overwriteFiles = await askConfirm({
        title: '发现重复文件',
        message: warning?.message || '文件冲突，是否用回收站文件覆盖？',
        confirmText: '覆盖',
        cancelText: '取消覆盖',
        duplicates: duplicates.length
          ? duplicates
          : items
              .filter((item) => params.ids.includes(item.id))
              .map((item) => ({ name: item.name })),
      });
      if (!overwriteFiles) return;
    }
    if (preview.blockers?.length) {
      showError(preview.blockers.map((b) => b.message).join('；'));
      return;
    }
    const result = await restoreRecycleItems({
      item_ids: params.ids,
      mode: params.mode,
      target_knowledge_id: params.targetKnowledgeId,
      target_folder_id: params.targetFolderId ?? null,
      merge_folder: mergeFolder,
      overwrite_files: overwriteFiles,
    });
    showSuccess(`已还原 ${result.restored} 项`);
    await load();
  };

  const handleRestoreOriginal = async () => {
    const ids = Array.from(selected);
    if (!ids.length) {
      showError('请先选择要还原的条目');
      return;
    }
    try {
      await executeRestore({ ids, mode: 'original' });
    } catch (err) {
      showError(err instanceof Error ? err.message : '还原失败');
    }
  };

  const handleOpenTargetRestore = async () => {
    const ids = Array.from(selected);
    if (!ids.length) {
      showError('请先选择要还原的条目');
      return;
    }
    setTargetDialogOpen(true);
    setTargetSpacesLoading(true);
    try {
      const res = await fetchKnowledgeSpaces();
      setTargetSpaces(res.data || []);
    } catch (err) {
      setTargetDialogOpen(false);
      showError(err instanceof Error ? err.message : '加载知识空间失败');
    } finally {
      setTargetSpacesLoading(false);
    }
  };

  const handleConfirmTargetRestore = async (selection: TargetPathSelection) => {
    const ids = Array.from(selected);
    if (!ids.length) {
      showError('请先选择要还原的条目');
      setTargetDialogOpen(false);
      return;
    }
    setTargetDialogOpen(false);
    try {
      await executeRestore({
        ids,
        mode: 'custom',
        targetKnowledgeId: selection.knowledgeId,
        targetFolderId: selection.folderId,
      });
    } catch (err) {
      showError(err instanceof Error ? err.message : '还原失败');
    }
  };

  const handlePurge = async (all = false) => {
    const ids = Array.from(selected);
    if (!all && !ids.length) {
      showError('请先选择要清空的条目');
      return;
    }
    const ok = await askConfirm({
      title: all ? '清空全部' : '清空所选',
      message: all
        ? '确认清空全部回收站？此操作不可恢复。'
        : `确认永久删除选中的 ${ids.length} 项？此操作不可恢复。`,
      confirmText: all ? '确认清空' : '确认删除',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await purgeRecycleItems(all ? { all: true } : { item_ids: ids, all: false });
      showSuccess(`已永久删除 ${result.purged} 项`);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : '清空失败');
    }
  };

  return (
    <PageShell>
      <div className={s.container}>
        <div className={s.crumbs}>
          <Link to="/">首页</Link>
          <ChevronRight size={14} className={s.crumbChevron} />
          <span>回收站</span>
        </div>

        <div className={s.pageHead}>
          <div>
            <h1 className={s.pageTitle}>回收站</h1>
            <p className={s.pageNote}>
              知识空间删除的文件与文件夹在此保留，到期或手动清空后永久删除。
            </p>
          </div>
          <div className={s.retentionBar}>
            <span className={s.retentionLabel}>保留天数</span>
            <label className={s.retentionField}>
              <input
                type="number"
                min={1}
                max={365}
                className={s.retentionInput}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value) || 7)}
                aria-label="保留天数"
              />
              <span>天</span>
            </label>
            <button
              type="button"
              className={s.retentionSave}
              disabled={savingRetention}
              onClick={() => void handleSaveRetention()}
            >
              {savingRetention ? '保存中…' : '保存'}
            </button>
          </div>
        </div>

        <div className={s.tableCard}>
          <div className={s.cardHead}>
            <div className={s.cardTitleGroup}>
              <span className={s.cardTitle}>回收站条目</span>
              <span className={s.resultCount}>{total} 条</span>
            </div>
            <div className={s.actionGroup}>
              <button type="button" className={s.btnGhost} onClick={() => void handleRestoreOriginal()}>
                <RotateCcw size={13} />
                还原到原路径
              </button>
              <button type="button" className={s.btnGhost} onClick={() => void handleOpenTargetRestore()}>
                <RotateCcw size={13} />
                还原到指定路径
              </button>
              <button type="button" className={s.btnDanger} onClick={() => void handlePurge(false)}>
                <Trash2 size={13} />
                清空所选
              </button>
              <button type="button" className={s.btnDanger} onClick={() => void handlePurge(true)}>
                <Trash2 size={13} />
                清空全部
              </button>
            </div>
          </div>

          <div className={s.filterRow}>
            <FilterBar
              className={s.filterBarPlain}
              filters={[
                {
                  label: '类型',
                  value: spaceLevel,
                  options: SPACE_LEVEL_OPTIONS,
                  onChange: (value) => {
                    setPage(1);
                    setSpaceLevel(value);
                  },
                },
              ]}
            />
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.checkCol}>
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleAll}
                      aria-label="全选"
                    />
                  </th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>来源库</th>
                  <th>原路径</th>
                  <th>删除人</th>
                  <th>删除时间</th>
                  <th>到期时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8}>
                      <div className={s.emptyState}>加载中…</div>
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className={s.emptyState}>暂无回收站条目</div>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className={selected.has(item.id) ? s.rowSelected : undefined}>
                      <td className={s.checkCol}>
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                          aria-label={`选择 ${item.name}`}
                        />
                      </td>
                      <td>{item.name}</td>
                      <td>{item.file_type === 0 ? '文件夹' : '文件'}</td>
                      <td>{item.space_level_label || item.space_level || '-'}</td>
                      <td className={s.path}>{item.original_path}</td>
                      <td>{item.deleted_by_name || item.deleted_by}</td>
                      <td>{formatTime(item.deleted_at)}</td>
                      <td>{formatTime(item.expire_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={s.cardFoot}>
            <span className={s.resultCount}>
              共 {total} 条 · 第 {page}/{Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
            </span>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
          </div>
        </div>
      </div>

      <ActionToast toast={toast} />

      {targetDialogOpen ? (
        <TargetRestoreModal
          spaces={targetSpaces}
          loading={targetSpacesLoading}
          onClose={() => setTargetDialogOpen(false)}
          onConfirm={(selection) => void handleConfirmTargetRestore(selection)}
        />
      ) : null}

      {confirmState ? (
        <ConfirmModal
          state={confirmState}
          onClose={(ok) => {
            const resolve = confirmState.resolve;
            setConfirmState(null);
            resolve(ok);
          }}
        />
      ) : null}
    </PageShell>
  );
}
