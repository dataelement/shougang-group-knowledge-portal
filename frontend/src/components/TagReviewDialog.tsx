import { useCallback, useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import {
  approveOrRejectReviewTag,
  formatTagSourceLabel,
  listReviewTags,
  listTagLibrariesByKnowledge,
  type ReviewTagItem,
  type ReviewTagResourceItem,
  type TagLibraryListItem,
} from '../api/tagReview';
import s from './TagReviewDialog.module.css';

const PAGE_SIZE = 10;

export interface TagReviewFileTarget {
  spaceId: number;
  fileId: number;
  fileName: string;
}

interface TagReviewDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenFile: (target: TagReviewFileTarget) => void;
}

interface ApproveState {
  row: ReviewTagItem;
  knowledgeId: number;
}

function resolveFileId(resource: ReviewTagResourceItem): number | null {
  const raw = resource.file_id ?? resource.id;
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Portal dialog for org department admins to list/search/approve pending review tags.
 */
export default function TagReviewDialog({ open, onClose, onOpenFile }: TagReviewDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [rows, setRows] = useState<ReviewTagItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [approveState, setApproveState] = useState<ApproveState | null>(null);
  const [libraries, setLibraries] = useState<TagLibraryListItem[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const loadData = useCallback(async (targetPage: number, searchKeyword: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await listReviewTags({
        page: targetPage,
        page_size: PAGE_SIZE,
        keyword: searchKeyword || undefined,
      });
      setRows(res.data || []);
      setTotal(res.total || 0);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : '加载待审核标签失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPage(1);
    void loadData(1, debouncedKeyword);
  }, [open, debouncedKeyword, loadData]);

  useEffect(() => {
    if (!approveState) {
      setLibraries([]);
      setSelectedLibraryId('');
      return;
    }
    let cancelled = false;
    setLibrariesLoading(true);
    void listTagLibrariesByKnowledge(approveState.knowledgeId)
      .then((items) => {
        if (cancelled) return;
        setLibraries(items);
        setSelectedLibraryId(items[0] ? String(items[0].id) : '');
      })
      .catch((err) => {
        if (cancelled) return;
        setLibraries([]);
        setToast(err instanceof Error ? err.message : '加载标签库失败');
      })
      .finally(() => {
        if (!cancelled) setLibrariesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [approveState]);

  if (!open) return null;

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    void loadData(nextPage, debouncedKeyword);
  };

  const handleOpenFile = (resource: ReviewTagResourceItem) => {
    const fileId = resolveFileId(resource);
    const spaceId = resource.knowledge_id != null ? Number(resource.knowledge_id) : NaN;
    const fileName = (resource.file_name || '').trim();
    if (!fileId || !Number.isFinite(spaceId) || spaceId <= 0) {
      setToast('无法定位文件，缺少知识空间或文件信息');
      return;
    }
    onOpenFile({ spaceId, fileId, fileName: fileName || `file-${fileId}` });
  };

  const openApprove = (row: ReviewTagItem, knowledgeId?: number | null) => {
    const resolved =
      knowledgeId
      ?? row.resource_files?.find((file) => file.knowledge_id)?.knowledge_id
      ?? row.knowledge_ids?.[0]
      ?? null;
    if (!resolved) {
      setToast('无法确定标签所属知识空间');
      return;
    }
    setApproveState({ row, knowledgeId: Number(resolved) });
  };

  const handleReject = async (row: ReviewTagItem) => {
    if (!row.tag_name) return;
    setSaving(true);
    try {
      await approveOrRejectReviewTag({
        tag_name: row.tag_name,
        status: 2,
        resource_type: row.resource_type || 'manual_tag',
      });
      setToast('已拒绝');
      void loadData(page, debouncedKeyword);
    } catch (err) {
      setToast(err instanceof Error ? err.message : '拒绝失败');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveConfirm = async () => {
    if (!approveState || !selectedLibraryId) return;
    setSaving(true);
    try {
      await approveOrRejectReviewTag({
        tag_name: approveState.row.tag_name,
        status: 1,
        resource_type: approveState.row.resource_type || 'manual_tag',
        tag_library_id: Number(selectedLibraryId),
        knowledge_id: approveState.knowledgeId,
      });
      setApproveState(null);
      setToast('已通过');
      void loadData(page, debouncedKeyword);
    } catch (err) {
      setToast(err instanceof Error ? err.message : '通过失败');
    } finally {
      setSaving(false);
    }
  };

  const renderActions = (row: ReviewTagItem, knowledgeId?: number | null) => (
    <div className={s.actions}>
      <button
        type="button"
        className={s.iconBtn}
        title="通过"
        disabled={saving}
        onClick={() => openApprove(row, knowledgeId)}
      >
        <Check size={16} />
      </button>
      <button
        type="button"
        className={`${s.iconBtn} ${s.iconBtnDanger}`}
        title="拒绝"
        disabled={saving}
        onClick={() => void handleReject(row)}
      >
        <X size={16} />
      </button>
    </div>
  );

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="tag-review-title">
        <div className={s.modalHead}>
          <div>
            <h2 id="tag-review-title" className={s.modalTitle}>
              待审核标签
              <span className={s.totalHint}>{`（${total}）`}</span>
            </h2>
            <p className={s.modalDesc}>审核 AI / 人工提交的、词表中尚不存在的标签名</p>
          </div>
          <button type="button" className={s.modalClose} onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className={s.modalBody}>
          <div className={s.searchRow}>
            <Search size={16} className={s.searchIcon} />
            <input
              className={s.searchInput}
              placeholder="搜索待审核标签"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>

          {toast ? <div className={s.toast}>{toast}</div> : null}
          {error ? <div className={s.error}>{error}</div> : null}

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>建议标签</th>
                  <th>标签来源</th>
                  <th>文件来源</th>
                  <th>提交时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className={s.empty}>加载中…</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={s.empty}>暂无待审核标签</td>
                  </tr>
                ) : (
                  rows.flatMap((group) => {
                    const files = group.resource_files || [];
                    if (files.length === 0) {
                      return [
                        <tr key={group.tag_name}>
                          <td className={s.tagName}>{group.tag_name}</td>
                          <td>{formatTagSourceLabel(group.resource_type)}</td>
                          <td className={s.muted}>-</td>
                          <td className={s.muted}>-</td>
                          <td>{renderActions(group, group.knowledge_ids?.[0] ?? null)}</td>
                        </tr>,
                      ];
                    }
                    return files.map((resource, idx) => (
                      <tr key={`${group.tag_name}-${idx}`}>
                        {idx === 0 ? (
                          <td className={s.tagName} rowSpan={files.length}>
                            {group.tag_name}
                          </td>
                        ) : null}
                        {idx === 0 ? (
                          <td rowSpan={files.length}>{formatTagSourceLabel(group.resource_type)}</td>
                        ) : null}
                        <td>
                          <button
                            type="button"
                            className={s.fileLink}
                            onClick={() => handleOpenFile(resource)}
                          >
                            {resource.file_name || '-'}
                          </button>
                        </td>
                        <td>{resource.submit_time || '-'}</td>
                        <td>{renderActions(group, resource.knowledge_id ?? null)}</td>
                      </tr>
                    ));
                  })
                )}
              </tbody>
            </table>
          </div>

          {rows.length > 0 ? (
            <div className={s.pager}>
              <button
                type="button"
                className={s.pageBtn}
                disabled={page <= 1 || loading}
                onClick={() => handlePageChange(page - 1)}
              >
                上一页
              </button>
              <span className={s.pageInfo}>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className={s.pageBtn}
                disabled={page >= totalPages || loading}
                onClick={() => handlePageChange(page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {approveState ? (
        <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && setApproveState(null)}>
          <div className={s.approveModal}>
            <div className={s.modalHead}>
              <span className={s.modalTitle}>通过标签</span>
              <button type="button" className={s.modalClose} onClick={() => setApproveState(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className={s.modalBody}>
              <p className={s.modalDesc}>
                将「{approveState.row.tag_name}」写入所选标签库并挂到对应知识。
              </p>
              <label className={s.fieldLabel} htmlFor="tag-library-select">
                标签库
              </label>
              <select
                id="tag-library-select"
                className={s.select}
                value={selectedLibraryId}
                disabled={librariesLoading || libraries.length === 0}
                onChange={(e) => setSelectedLibraryId(e.target.value)}
              >
                {libraries.length === 0 ? (
                  <option value="">暂无可用标签库</option>
                ) : (
                  libraries.map((lib) => (
                    <option key={lib.id} value={String(lib.id)}>
                      {lib.name}
                    </option>
                  ))
                )}
              </select>
              <div className={s.approveFoot}>
                <button type="button" className={s.pageBtn} onClick={() => setApproveState(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className={s.primaryBtn}
                  disabled={saving || librariesLoading || !selectedLibraryId}
                  onClick={() => void handleApproveConfirm()}
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
