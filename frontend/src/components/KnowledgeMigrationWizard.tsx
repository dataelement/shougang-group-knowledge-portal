import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  X,
} from 'lucide-react';
import {
  createMigrationBatch,
  fetchMigrationChildren,
  fetchMigrationSpaces,
  type MigrationBatch,
  type MigrationNode,
  type MigrationSpace,
} from '../api/knowledgeMigration';
import s from '../pages/KnowledgeMigrationsPage.module.css';

interface SelectedSourceNode {
  spaceId: number;
  spaceName: string;
  nodeId: number;
  nodeType: 'file' | 'folder';
  nodeName: string;
}

interface Props {
  onClose: () => void;
  onCreated: (batch: MigrationBatch) => void;
}

function childKey(
  purpose: 'source' | 'target',
  spaceId: number,
  parentId: number | null,
) {
  return `${purpose}:${spaceId}:${parentId ?? 'root'}`;
}

async function loadAllChildren(
  purpose: 'source' | 'target',
  spaceId: number,
  parentId: number | null,
) {
  const rows: MigrationNode[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await fetchMigrationChildren({
      purpose,
      spaceId,
      parentId,
      cursor,
    });
    rows.push(...page.data);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return rows;
}

async function loadAllSpaces(purpose: 'source' | 'target') {
  const rows: MigrationSpace[] = [];
  let page = 1;
  let total = 1;
  while (rows.length < total) {
    const result = await fetchMigrationSpaces({
      purpose,
      page,
      pageSize: 100,
    });
    rows.push(...result.data);
    total = result.total;
    page += 1;
    if (result.data.length === 0) break;
  }
  return rows;
}

function makeRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `migration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function KnowledgeMigrationWizard({
  onClose,
  onCreated,
}: Props) {
  const [spaces, setSpaces] = useState<MigrationSpace[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);
  const [sourceSpaceId, setSourceSpaceId] = useState<number | null>(null);
  const [targetSpaceId, setTargetSpaceId] = useState<number | null>(null);
  const [targetFolder, setTargetFolder] = useState<{
    id: number | null;
    name: string;
  }>({ id: null, name: '根目录' });
  const [selected, setSelected] = useState<
    Record<string, SelectedSourceNode>
  >({});
  const [children, setChildren] = useState<Record<string, MigrationNode[]>>(
    {},
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [preserveStructure, setPreserveStructure] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState<
    'skip' | 'overwrite'
  >('skip');
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoadingSpaces(true);
    Promise.all([
      loadAllSpaces('source'),
      loadAllSpaces('target'),
    ])
      .then(([sourceRows, targetRows]) => {
        if (!active) return;
        const byId = new Map<number, MigrationSpace>();
        [...sourceRows, ...targetRows].forEach((space) => {
          byId.set(space.id, space);
        });
        setSpaces(
          [...byId.values()].sort((left, right) =>
            left.name.localeCompare(right.name, 'zh-CN'),
          ),
        );
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : '知识库加载失败');
        }
      })
      .finally(() => active && setLoadingSpaces(false));
    return () => {
      active = false;
    };
  }, []);

  const selectedRows = useMemo(() => Object.values(selected), [selected]);
  const sourceSpaceIds = useMemo(
    () => new Set(selectedRows.map((item) => item.spaceId)),
    [selectedRows],
  );
  const sourceGroups = useMemo(() => {
    const groups = new Map<number, SelectedSourceNode[]>();
    selectedRows.forEach((item) => {
      const group = groups.get(item.spaceId) || [];
      group.push(item);
      groups.set(item.spaceId, group);
    });
    return groups;
  }, [selectedRows]);

  const loadNodes = async (
    purpose: 'source' | 'target',
    spaceId: number,
    parentId: number | null,
  ) => {
    const key = childKey(purpose, spaceId, parentId);
    if (children[key] || loadingKeys.has(key)) return;
    setLoadingKeys((previous) => new Set(previous).add(key));
    try {
      const rows = await loadAllChildren(purpose, spaceId, parentId);
      setChildren((previous) => ({ ...previous, [key]: rows }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目录加载失败');
    } finally {
      setLoadingKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    if (sourceSpaceId != null) {
      void loadNodes('source', sourceSpaceId, null);
    }
    // loadNodes is intentionally keyed by sourceSpaceId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSpaceId]);

  useEffect(() => {
    if (targetSpaceId != null) {
      setTargetFolder({ id: null, name: '根目录' });
      void loadNodes('target', targetSpaceId, null);
    }
    // loadNodes is intentionally keyed by targetSpaceId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSpaceId]);

  const toggleExpanded = (
    purpose: 'source' | 'target',
    spaceId: number,
    node: MigrationNode,
  ) => {
    const key = childKey(purpose, spaceId, node.id);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void loadNodes(purpose, spaceId, node.id);
      }
      return next;
    });
  };

  const toggleSource = (space: MigrationSpace, node: MigrationNode) => {
    const key = `${space.id}:${node.node_type}:${node.id}`;
    setSelected((previous) => {
      const next = { ...previous };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = {
          spaceId: space.id,
          spaceName: space.name,
          nodeId: node.id,
          nodeType: node.node_type,
          nodeName: node.name,
        };
      }
      return next;
    });
    if (targetSpaceId === space.id) {
      setTargetSpaceId(null);
      setTargetFolder({ id: null, name: '根目录' });
    }
  };

  const renderNodes = (
    purpose: 'source' | 'target',
    space: MigrationSpace,
    parentId: number | null,
    depth = 0,
  ) => {
    const key = childKey(purpose, space.id, parentId);
    if (loadingKeys.has(key) && !children[key]) {
      return (
        <div className={s.treeLoading}>
          <Loader2 size={15} className={s.spin} />
          加载中
        </div>
      );
    }
    const rows = children[key] || [];
    if (rows.length === 0) {
      return <div className={s.treeEmpty}>当前目录为空</div>;
    }
    return rows.map((node) => {
      const expandKey = childKey(purpose, space.id, node.id);
      const isExpanded = expanded.has(expandKey);
      const selectionKey = `${space.id}:${node.node_type}:${node.id}`;
      const isSelected =
        purpose === 'source'
          ? Boolean(selected[selectionKey])
          : targetFolder.id === node.id;
      return (
        <div key={`${purpose}-${space.id}-${node.id}`}>
          <div
            className={`${s.treeRow} ${isSelected ? s.treeRowSelected : ''}`}
            style={{ paddingLeft: `${10 + depth * 18}px` }}
          >
            {node.node_type === 'folder' && node.has_children ? (
              <button
                type="button"
                className={s.treeExpand}
                onClick={() => toggleExpanded(purpose, space.id, node)}
                aria-label={isExpanded ? '收起目录' : '展开目录'}
              >
                {isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ) : (
              <span className={s.treeExpandPlaceholder} />
            )}
            {purpose === 'source' ? (
              <input
                type="checkbox"
                checked={isSelected}
                disabled={!node.selectable}
                onChange={() => toggleSource(space, node)}
              />
            ) : null}
            {node.node_type === 'folder' ? (
              <Folder size={15} />
            ) : (
              <FileText size={15} />
            )}
            <button
              type="button"
              className={s.treeLabel}
              disabled={!node.selectable}
              title={node.unavailable_reason || node.name}
              onClick={() => {
                if (purpose === 'source') {
                  toggleSource(space, node);
                } else {
                  setTargetFolder({ id: node.id, name: node.name });
                }
              }}
            >
              {node.name}
            </button>
          </div>
          {node.node_type === 'folder' && isExpanded
            ? renderNodes(purpose, space, node.id, depth + 1)
            : null}
        </div>
      );
    });
  };

  const validate = () => {
    if (selectedRows.length === 0) return '请至少选择一个来源文件或文件夹';
    if (targetSpaceId == null) return '请选择目标知识库';
    if (sourceSpaceIds.has(targetSpaceId)) {
      return '目标知识库不能同时作为来源知识库';
    }
    return '';
  };

  const moveToReview = () => {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setReviewing(true);
  };

  const submit = async () => {
    const message = validate();
    if (message || targetSpaceId == null) {
      setError(message);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const source_selections = [...sourceGroups.entries()].map(
        ([spaceId, nodes]) => ({
          space_id: spaceId,
          nodes: nodes.map((node) => ({
            node_type: node.nodeType,
            node_id: node.nodeId,
          })),
        }),
      );
      const batch = await createMigrationBatch({
        request_id: makeRequestId(),
        source_selections,
        target_space_id: targetSpaceId,
        target_folder_id: targetFolder.id,
        preserve_structure: preserveStructure,
        conflict_strategy: conflictStrategy,
      });
      onCreated(batch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '迁移批次创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const currentSourceSpace = spaces.find(
    (space) => space.id === sourceSpaceId,
  );
  const currentTargetSpace = spaces.find(
    (space) => space.id === targetSpaceId,
  );

  return (
    <div
      className={s.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className={s.wizard} role="dialog" aria-modal="true">
        <header className={s.modalHead}>
          <div>
            <h2>新建跨库迁移</h2>
            <p>{reviewing ? '确认迁移范围和处理策略' : '多来源知识库 → 单一目标目录'}</p>
          </div>
          <button type="button" className={s.iconButton} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={s.stepBar}>
          <span className={!reviewing ? s.stepActive : s.stepDone}>1 选择范围</span>
          <span className={reviewing ? s.stepActive : ''}>2 确认提交</span>
        </div>

        <div className={s.modalBody}>
          {error ? <div className={s.errorBanner}>{error}</div> : null}
          {loadingSpaces ? (
            <div className={s.centerState}>
              <Loader2 size={18} className={s.spin} />
              正在加载知识库
            </div>
          ) : reviewing ? (
            <div className={s.reviewGrid}>
              <div className={s.reviewCard}>
                <strong>来源范围</strong>
                <ul>
                  {[...sourceGroups.entries()].map(([spaceId, nodes]) => (
                    <li key={spaceId}>
                      {nodes[0]?.spaceName}：{nodes.map((node) => node.nodeName).join('、')}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={s.reviewCard}>
                <strong>目标位置</strong>
                <p>
                  {currentTargetSpace?.name} / {targetFolder.name}
                </p>
              </div>
              <div className={s.reviewCard}>
                <strong>目录结构</strong>
                <p>{preserveStructure ? '保留所选文件夹结构' : '扁平移动到目标目录'}</p>
              </div>
              <div className={s.reviewCard}>
                <strong>冲突策略</strong>
                <p>
                  {conflictStrategy === 'overwrite'
                    ? '覆盖（预检后仍需确认覆盖清单）'
                    : '跳过冲突项'}
                </p>
              </div>
              <div className={s.infoBanner}>
                提交后先在后台异步扫描。扫描完成后，无覆盖项会自动排队；有覆盖项时需要在批次详情中确认。
              </div>
            </div>
          ) : (
            <div className={s.wizardGrid}>
              <section className={s.wizardSection}>
                <h3>1. 选择来源文件和文件夹</h3>
                <select
                  className={s.select}
                  value={sourceSpaceId ?? ''}
                  onChange={(event) =>
                    setSourceSpaceId(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                >
                  <option value="">选择来源知识库</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
                <div className={s.treePanel}>
                  {currentSourceSpace
                    ? renderNodes('source', currentSourceSpace, null)
                    : <div className={s.treeEmpty}>请先选择来源知识库</div>}
                </div>
                <div className={s.selectedSummary}>
                  已选 {selectedRows.length} 个节点，来自 {sourceGroups.size} 个知识库
                </div>
              </section>

              <section className={s.wizardSection}>
                <h3>2. 选择目标知识库和目录</h3>
                <select
                  className={s.select}
                  value={targetSpaceId ?? ''}
                  onChange={(event) =>
                    setTargetSpaceId(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                >
                  <option value="">选择目标知识库</option>
                  {spaces.map((space) => (
                    <option
                      key={space.id}
                      value={space.id}
                      disabled={sourceSpaceIds.has(space.id)}
                    >
                      {space.name}
                      {sourceSpaceIds.has(space.id) ? '（已作为来源）' : ''}
                    </option>
                  ))}
                </select>
                <div className={s.targetRoot}>
                  <button
                    type="button"
                    className={
                      targetFolder.id === null ? s.targetRootActive : ''
                    }
                    disabled={targetSpaceId == null}
                    onClick={() =>
                      setTargetFolder({ id: null, name: '根目录' })
                    }
                  >
                    <Folder size={15} />
                    根目录
                  </button>
                </div>
                <div className={s.treePanel}>
                  {currentTargetSpace
                    ? renderNodes('target', currentTargetSpace, null)
                    : <div className={s.treeEmpty}>请先选择目标知识库</div>}
                </div>
                <div className={s.selectedSummary}>
                  目标：{currentTargetSpace?.name || '-'} / {targetFolder.name}
                </div>
              </section>

              <section className={s.optionSection}>
                <h3>3. 迁移选项</h3>
                <label className={s.checkOption}>
                  <input
                    type="checkbox"
                    checked={preserveStructure}
                    onChange={(event) =>
                      setPreserveStructure(event.target.checked)
                    }
                  />
                  保留来源文件夹结构
                </label>
                <div className={s.radioGroup}>
                  <label>
                    <input
                      type="radio"
                      checked={conflictStrategy === 'skip'}
                      onChange={() => setConflictStrategy('skip')}
                    />
                    跳过同名或相同 MD5 的目标项
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={conflictStrategy === 'overwrite'}
                      onChange={() => setConflictStrategy('overwrite')}
                    />
                    覆盖冲突目标（需扫描后再次确认）
                  </label>
                </div>
              </section>
            </div>
          )}
        </div>

        <footer className={s.modalFoot}>
          <button
            type="button"
            className={s.secondaryButton}
            onClick={reviewing ? () => setReviewing(false) : onClose}
            disabled={submitting}
          >
            {reviewing ? '返回修改' : '取消'}
          </button>
          {reviewing ? (
            <button
              type="button"
              className={s.primaryButton}
              onClick={() => void submit()}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className={s.spin} />
                  正在提交
                </>
              ) : (
                '提交异步迁移'
              )}
            </button>
          ) : (
            <button
              type="button"
              className={s.primaryButton}
              onClick={moveToReview}
            >
              下一步
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
