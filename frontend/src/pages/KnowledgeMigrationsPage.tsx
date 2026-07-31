import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import Pagination from '../components/Pagination';
import KnowledgeMigrationWizard from '../components/KnowledgeMigrationWizard';
import {
  abandonMigrationBatch,
  confirmMigrationOverwrite,
  deleteMigrationBatch,
  fetchMigrationAttempts,
  fetchMigrationBatch,
  fetchMigrationBatches,
  fetchMigrationUnits,
  retryMigrationBatch,
  type MigrationAttempt,
  type MigrationBatch,
  type MigrationStatus,
  type MigrationUnit,
} from '../api/knowledgeMigration';
import { formatDisplayDateTime } from '../utils/dateTime';
import s from './KnowledgeMigrationsPage.module.css';

const PAGE_SIZE = 20;
const TERMINAL_STATUSES = new Set<MigrationStatus>([
  'succeeded',
  'partial_success',
  'failed',
  'abandoned',
]);

const STATUS_LABELS: Record<MigrationStatus, string> = {
  preflight_queued: '等待扫描',
  preflighting: '扫描中',
  awaiting_confirmation: '待确认覆盖',
  queued: '排队中',
  running: '迁移中',
  succeeded: '成功',
  partial_success: '部分成功',
  failed: '失败',
  abandoned: '已放弃',
};

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

function formatTime(value: string | null | undefined) {
  return value ? formatDisplayDateTime(value) : '-';
}

function isScanning(status: MigrationStatus) {
  return status === 'preflight_queued' || status === 'preflighting';
}

function statusTone(status: MigrationStatus) {
  if (status === 'succeeded') return s.statusSuccess;
  if (status === 'partial_success' || status === 'awaiting_confirmation') {
    return s.statusWarning;
  }
  if (status === 'failed' || status === 'abandoned') return s.statusDanger;
  return s.statusWorking;
}

function BatchProgress({ batch }: { batch: MigrationBatch }) {
  if (isScanning(batch.status)) {
    return (
      <span className={s.scanState}>
        <Loader2 size={14} className={s.spin} />
        {STATUS_LABELS[batch.status]}
        {batch.scanned_count > 0 ? ` · 已扫描 ${batch.scanned_count}` : ''}
      </span>
    );
  }
  const denominator = Math.max(1, batch.executable_count);
  const percent = Math.min(
    100,
    Math.round((batch.completed_count / denominator) * 100),
  );
  return (
    <div className={s.progressCell}>
      <div className={s.progressTrack}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>
        {batch.completed_count}/{batch.executable_count} · 成功 {batch.succeeded_count}
        {batch.skipped_count ? ` · 跳过 ${batch.skipped_count}` : ''}
        {batch.failed_count ? ` · 失败 ${batch.failed_count}` : ''}
      </small>
    </div>
  );
}

function DetailDialog({
  batchNo,
  onClose,
  onBatchChanged,
}: {
  batchNo: string;
  onClose: () => void;
  onBatchChanged: () => void;
}) {
  const [batch, setBatch] = useState<MigrationBatch | null>(null);
  const [units, setUnits] = useState<MigrationUnit[]>([]);
  const [attempts, setAttempts] = useState<MigrationAttempt[]>([]);
  const [unitPage, setUnitPage] = useState(1);
  const [unitTotal, setUnitTotal] = useState(0);
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [batchResult, unitResult, attemptResult] = await Promise.all([
        fetchMigrationBatch(batchNo),
        fetchMigrationUnits(batchNo, { page: unitPage, pageSize: 20 }),
        fetchMigrationAttempts(batchNo, { page: 1, pageSize: 100 }),
      ]);
      setBatch(batchResult);
      setUnits(unitResult.data);
      setUnitTotal(unitResult.total);
      setAttempts(attemptResult.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批次详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [batchNo, unitPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!batch || TERMINAL_STATUSES.has(batch.status)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [batch, load]);

  const runAction = async (
    action: () => Promise<MigrationBatch | { deleted: boolean }>,
  ) => {
    setWorking(true);
    setError('');
    try {
      await action();
      onBatchChanged();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setWorking(false);
    }
  };

  const confirmOverwrite = () => {
    if (
      !window.confirm(
        `确认覆盖预检清单中的 ${batch?.overwrite_target_count || 0} 个目标逻辑项吗？执行时仍会复核目标是否变化。`,
      )
    ) {
      return;
    }
    void runAction(() => confirmMigrationOverwrite(batchNo));
  };

  const abandon = () => {
    if (!window.confirm('确认放弃该批次吗？放弃后不会执行任何迁移。')) return;
    void runAction(() => abandonMigrationBatch(batchNo));
  };

  const retry = () => {
    if (!window.confirm('确认重试本批次中失败和未处理的单元吗？')) return;
    void runAction(() => retryMigrationBatch(batchNo));
  };

  const remove = () => {
    if (
      !window.confirm(
        '确认删除这条迁移记录吗？该操作只隐藏审计记录，不会回滚已迁移文件。',
      )
    ) {
      return;
    }
    setWorking(true);
    void deleteMigrationBatch(batchNo)
      .then(() => {
        onBatchChanged();
        onClose();
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : '删除记录失败'),
      )
      .finally(() => setWorking(false));
  };

  return (
    <div
      className={s.overlay}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className={s.detailDialog} role="dialog" aria-modal="true">
        <header className={s.modalHead}>
          <div>
            <h2>迁移批次详情</h2>
            <p className={s.batchNo}>{batchNo}</p>
          </div>
          <button type="button" className={s.iconButton} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className={s.modalBody}>
          {error ? <div className={s.errorBanner}>{error}</div> : null}
          {loading && !batch ? (
            <div className={s.centerState}>
              <Loader2 size={18} className={s.spin} />
              正在加载批次详情
            </div>
          ) : batch ? (
            <>
              <div className={s.detailSummary}>
                <div>
                  <span>状态</span>
                  <strong className={`${s.status} ${statusTone(batch.status)}`}>
                    {STATUS_LABELS[batch.status]}
                  </strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>
                    {batch.source_spaces.map((space) => space.name).join('、')}
                  </strong>
                </div>
                <div>
                  <span>目标</span>
                  <strong>
                    {batch.target_space_name} / {batch.target_folder_name || '根目录'}
                  </strong>
                </div>
                <div>
                  <span>策略</span>
                  <strong>
                    {batch.preserve_structure ? '保留结构' : '扁平移动'} ·{' '}
                    {batch.conflict_strategy === 'overwrite' ? '覆盖' : '跳过'}
                  </strong>
                </div>
                <div>
                  <span>创建人 / 时间</span>
                  <strong>
                    {batch.operator_name} · {formatTime(batch.create_time)}
                  </strong>
                </div>
                <div>
                  <span>轮次</span>
                  <strong>第 {batch.round_no} 轮</strong>
                </div>
              </div>
              <div className={s.snapshotPanel}>
                <strong>来源选择快照</strong>
                {batch.source_selection.map((selection) => (
                  <span key={selection.space_id}>
                    知识库 #{selection.space_id}：{selection.nodes
                      .map((node) => node.name || `#${node.node_id}`)
                      .join('、')}
                  </span>
                ))}
                {batch.confirmed_at ? (
                  <span>
                    覆盖确认：管理员 #{batch.confirmed_by} ·{' '}
                    {formatTime(batch.confirmed_at)}
                  </span>
                ) : null}
                {batch.abandoned_at ? (
                  <span>
                    放弃：管理员 #{batch.abandoned_by} ·{' '}
                    {formatTime(batch.abandoned_at)}
                  </span>
                ) : null}
              </div>
              <BatchProgress batch={batch} />
              {batch.last_error_summary ? (
                <div className={s.errorBanner}>
                  <CircleAlert size={15} />
                  {batch.last_error_summary}
                </div>
              ) : null}

              {batch.status === 'awaiting_confirmation' ? (
                <div className={s.overwriteNotice}>
                  <strong>
                    预检发现 {batch.overwrite_target_count} 个待覆盖目标
                  </strong>
                  <span>
                    请先检查下方带“覆盖目标”的迁移单元，再确认或放弃。
                  </span>
                </div>
              ) : null}

              <div className={s.sectionHead}>
                <h3>文件与版本单元</h3>
                <span>共 {unitTotal} 个</span>
              </div>
              <div className={s.unitList}>
                {units.map((unit) => {
                  const expanded = expandedUnits.has(unit.id);
                  return (
                    <article key={unit.id} className={s.unitCard}>
                      <button
                        type="button"
                        className={s.unitHead}
                        onClick={() =>
                          setExpandedUnits((previous) => {
                            const next = new Set(previous);
                            if (next.has(unit.id)) next.delete(unit.id);
                            else next.add(unit.id);
                            return next;
                          })
                        }
                      >
                        {expanded ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                        <span className={s.unitTitle}>
                          {unit.unit_type === 'version_chain'
                            ? '版本链'
                            : '文件'}{' '}
                          · {unit.files[0]?.source_file_name || unit.unit_key}
                        </span>
                        <span className={s.unitPath}>
                          {unit.source_space_name} {unit.source_path}
                          <ArrowRight size={13} />
                          {batch.target_space_name} {unit.planned_target_path}
                        </span>
                        <span className={s.unitStatus}>{unit.status}</span>
                      </button>
                      {unit.reason_code || unit.summary ? (
                        <div className={s.unitMessage}>
                          {unit.reason_code || '说明'}：{unit.summary || '-'}
                        </div>
                      ) : null}
                      {unit.overwrite_snapshot ? (
                        <div className={s.overwriteList}>
                          <strong>覆盖目标</strong>
                          {(unit.overwrite_snapshot.target_files || []).map(
                            (file) => (
                              <span key={file.id}>
                                #{file.id} {file.file_name}
                                {file.version_no
                                  ? ` · 文档 #${file.document_id} / v${file.version_no}${file.is_primary ? '（主版本）' : ''}`
                                  : ''}
                              </span>
                            ),
                          )}
                        </div>
                      ) : null}
                      {unit.folder_mapping.length ? (
                        <div className={s.folderMapping}>
                          <strong>目录映射</strong>
                          {unit.folder_mapping.map((mapping) => (
                            <span key={mapping.source_folder_id}>
                              {mapping.source_name}（来源 #{mapping.source_folder_id}）
                              → 目标 {mapping.target_folder_id ? `#${mapping.target_folder_id}` : '待创建'}
                              · {mapping.action}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {expanded ? (
                        <div className={s.fileTableWrap}>
                          <table className={s.fileTable}>
                            <thead>
                              <tr>
                                <th>来源文件</th>
                                <th>版本</th>
                                <th>目标文件 ID</th>
                                <th>检查点</th>
                                <th>状态</th>
                              </tr>
                            </thead>
                            <tbody>
                              {unit.files.map((file) => (
                                <tr key={file.id}>
                                  <td>#{file.source_file_id} {file.source_file_name}</td>
                                  <td>
                                    {file.source_version_no
                                      ? `文档 #${file.source_document_id} / 版本 #${file.source_version_id} / v${file.source_version_no}${file.is_primary ? '（主版本）' : ''}`
                                      : '-'}
                                  </td>
                                  <td>{file.target_file_id || '-'}</td>
                                  <td>{file.checkpoint}</td>
                                  <td>{file.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {!units.length ? (
                  <div className={s.emptyState}>暂无迁移单元</div>
                ) : null}
              </div>
              <Pagination
                page={unitPage}
                pageSize={20}
                total={unitTotal}
                onChange={setUnitPage}
              />

              <div className={s.sectionHead}>
                <h3>执行尝试</h3>
                <span>保留每轮处理记录</span>
              </div>
              <div className={s.attemptList}>
                {attempts.map((attempt) => (
                  <div key={attempt.id} className={s.attemptRow}>
                    <span>第 {attempt.round_no} 轮 / 第 {attempt.attempt_no} 次</span>
                    <span>单元 #{attempt.unit_id}</span>
                    <span>
                      {attempt.start_checkpoint} → {attempt.end_checkpoint || '运行中'}
                    </span>
                    <strong>{attempt.result}</strong>
                    <span>{formatTime(attempt.started_at)}</span>
                    {attempt.error_summary ? (
                      <small>{attempt.error_summary}</small>
                    ) : null}
                  </div>
                ))}
                {!attempts.length ? (
                  <div className={s.emptyState}>尚未开始正式执行</div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
        <footer className={s.modalFoot}>
          <button
            type="button"
            className={s.secondaryButton}
            onClick={() => void load()}
            disabled={loading || working}
          >
            <RefreshCw size={14} className={loading ? s.spin : ''} />
            刷新
          </button>
          <span className={s.actionSpacer} />
          {batch?.status === 'awaiting_confirmation' ? (
            <>
              <button
                type="button"
                className={s.dangerButton}
                disabled={working}
                onClick={abandon}
              >
                放弃批次
              </button>
              <button
                type="button"
                className={s.primaryButton}
                disabled={working}
                onClick={confirmOverwrite}
              >
                确认覆盖并排队
              </button>
            </>
          ) : null}
          {batch &&
          (batch.status === 'partial_success' || batch.status === 'failed') ? (
            <button
              type="button"
              className={s.primaryButton}
              disabled={working}
              onClick={retry}
            >
              <RotateCcw size={14} />
              重试失败项
            </button>
          ) : null}
          {batch && TERMINAL_STATUSES.has(batch.status) ? (
            <button
              type="button"
              className={s.dangerButton}
              disabled={working}
              onClick={remove}
            >
              <Trash2 size={14} />
              删除记录
            </button>
          ) : null}
          <button
            type="button"
            className={s.secondaryButton}
            onClick={onClose}
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function KnowledgeMigrationsPage() {
  const [batches, setBatches] = useState<MigrationBatch[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWizard, setShowWizard] = useState(false);
  const [selectedBatchNo, setSelectedBatchNo] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const loadingRef = useRef(false);

  const load = useCallback(
    async (showLoading = true) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (showLoading) setLoading(true);
      setError('');
      try {
        const result = await fetchMigrationBatches({
          page,
          pageSize: PAGE_SIZE,
          status,
        });
        setBatches(result.data);
        setTotal(result.total);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '迁移记录加载失败');
      } finally {
        loadingRef.current = false;
        if (showLoading) setLoading(false);
      }
    },
    [page, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveBatch = batches.some(
    (batch) => !TERMINAL_STATUSES.has(batch.status),
  );

  useEffect(() => {
    if (!hasActiveBatch) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [hasActiveBatch, load]);

  const refreshAfterAction = () => void load(false);

  return (
    <PageShell hideFooter mainClassName={s.pageMain}>
      <div className={s.container}>
        <div className={s.pageHead}>
          <div>
            <div className={s.eyebrow}>
              <ArrowRightLeft size={15} />
              系统管理员
            </div>
            <h1>迁移记录</h1>
            <p>
              跨知识库文件迁移在后台异步扫描和执行。迁移记录用于审计，不代表可回滚备份。
            </p>
          </div>
          <button
            type="button"
            className={s.primaryButton}
            onClick={() => setShowWizard(true)}
          >
            <Plus size={16} />
            新建迁移
          </button>
        </div>

        {notice ? (
          <div className={s.infoBanner}>
            {notice}
            <button type="button" onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        ) : null}
        {error ? <div className={s.errorBanner}>{error}</div> : null}

        <section className={s.tableCard}>
          <header className={s.cardHead}>
            <div>
              <h2>跨库移动批次</h2>
              <span>共 {total} 条</span>
            </div>
            <div className={s.toolbar}>
              <select
                className={s.select}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={s.secondaryButton}
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? s.spin : ''} />
                刷新
              </button>
            </div>
          </header>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>批次 / 创建人</th>
                  <th>来源</th>
                  <th>目标目录</th>
                  <th>选项</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>创建时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.batch_no}>
                    <td>
                      <button
                        type="button"
                        className={s.batchLink}
                        onClick={() => setSelectedBatchNo(batch.batch_no)}
                      >
                        {batch.batch_no.slice(0, 8)}
                      </button>
                      <small>{batch.operator_name}</small>
                    </td>
                    <td className={s.sourceCell}>
                      {batch.source_spaces.map((space) => space.name).join('、')}
                    </td>
                    <td>
                      <strong>{batch.target_space_name}</strong>
                      <small>{batch.target_folder_name || '根目录'}</small>
                    </td>
                    <td>
                      <span>
                        {batch.preserve_structure ? '保留结构' : '扁平移动'}
                      </span>
                      <small>
                        冲突{batch.conflict_strategy === 'overwrite' ? '覆盖' : '跳过'}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`${s.status} ${statusTone(batch.status)}`}
                      >
                        {STATUS_LABELS[batch.status]}
                      </span>
                    </td>
                    <td>
                      <BatchProgress batch={batch} />
                    </td>
                    <td>{formatTime(batch.create_time)}</td>
                    <td>
                      <button
                        type="button"
                        className={s.rowAction}
                        onClick={() => setSelectedBatchNo(batch.batch_no)}
                      >
                        查看
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && !batches.length ? (
              <div className={s.centerState}>
                <Loader2 size={18} className={s.spin} />
                正在加载迁移记录
              </div>
            ) : null}
            {!loading && !batches.length ? (
              <div className={s.emptyState}>
                暂无迁移记录。点击“新建迁移”选择来源文件和目标目录。
              </div>
            ) : null}
          </div>
          <footer className={s.cardFoot}>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={setPage}
              alwaysShow
            />
          </footer>
        </section>
      </div>

      {showWizard ? (
        <KnowledgeMigrationWizard
          onClose={() => setShowWizard(false)}
          onCreated={(batch) => {
            setShowWizard(false);
            setNotice(
              `批次 ${batch.batch_no.slice(0, 8)} 已提交，后台正在异步扫描来源范围。`,
            );
            setPage(1);
            void load(false);
            setSelectedBatchNo(batch.batch_no);
          }}
        />
      ) : null}
      {selectedBatchNo ? (
        <DetailDialog
          batchNo={selectedBatchNo}
          onClose={() => setSelectedBatchNo(null)}
          onBatchChanged={refreshAfterAction}
        />
      ) : null}
    </PageShell>
  );
}
