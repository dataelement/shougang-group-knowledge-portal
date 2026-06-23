/**
 * ExpertManagePage.tsx
 * 专家列表管理页 — 支持分页、搜索、新增、编辑、删除
 * 路由：/expert-qa/manage  （需管理员权限）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Pencil,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import {
  createExpert,
  deleteExpert,
  fetchExpertProfiles,
  fetchUserList,
  updateExpert,
} from '../api/expertQa';
import type { ExpertProfileResponse, ExpertUpsertPayload, UserListItem } from '../api/expertQa';
import s from './ExpertManagePage.module.css';

// ─── 工具函数 ─────────────────────────────────────────────────



function avatarColor(name: string): string {
  const COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#ef4444', '#6366f1', '#14b8a6',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string): string {
  if (!name) return '?';
  return name.slice(0, 2);
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getUserDepartment(user: UserListItem): string {
  return String(user.department_name ?? user.department ?? user.department_id ?? user.dept_id ?? '');
}

const USER_PAGE_SIZE = 10;

// ─── 空表单 ──────────────────────────────────────────────────
const EMPTY_FORM: ExpertUpsertPayload = {
  user_id: 0,
  expert_name: '',
  introduction: '',
  depart_ment: '',
};

// ═══════════════════════════════════════════════════════════════
// 新增 / 编辑弹窗
// ═══════════════════════════════════════════════════════════════

interface ExpertFormModalProps {
  mode: 'create' | 'edit';
  initial: ExpertUpsertPayload & { id?: number };
  onClose: () => void;
  onSuccess: (expert: ExpertProfileResponse) => void;
}

function ExpertFormModal({ mode, initial, onClose, onSuccess }: ExpertFormModalProps) {
  const [form, setForm] = useState<ExpertUpsertPayload & { id?: number }>(initial);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersPage, setUsersPage] = useState(0);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const usersLoadingRef = useRef(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedUser = users.find((item) => item.user_id === form.user_id);
  const hasMoreUsers = usersTotal === 0 || users.length < usersTotal;

  function set(key: keyof ExpertUpsertPayload, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const loadUsers = useCallback(async (pageNum: number) => {
    if (usersLoadingRef.current) return;
    usersLoadingRef.current = true;
    setUsersLoading(true);
    try {
      const res = await fetchUserList(pageNum, USER_PAGE_SIZE);
      setUsers((prev) => {
        const next = pageNum === 1 ? [] : [...prev];
        res.users.forEach((user) => {
          if (!next.some((item) => item.user_id === user.user_id)) {
            next.push(user);
          }
        });
        return next;
      });
      setUsersPage(pageNum);
      setUsersTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户列表加载失败');
    } finally {
      usersLoadingRef.current = false;
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers(1);
  }, [loadUsers]);

  function selectUser(userId: number) {
    const user = users.find((item) => item.user_id === userId);
    if (!user) {
      set('user_id', userId);
      return;
    }
    setForm((prev) => ({
      ...prev,
      user_id: user.user_id,
      expert_name: user.user_name,
      depart_ment: getUserDepartment(user),
    }));
    setUserPickerOpen(false);
  }

  function handleUserListScroll(e: UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 12;
    if (reachedBottom && hasMoreUsers && !usersLoading) {
      loadUsers(usersPage + 1);
    }
  }

  async function handleSubmit() {
    if (!form.expert_name.trim()) {
      setError('请填写专家姓名');
      return;
    }
    if (!form.user_id || Number(form.user_id) <= 0) {
      setError('请填写有效的用户 ID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let result: ExpertProfileResponse;
      if (mode === 'edit' && form.id != null) {
        result = await updateExpert(form.id, {
          user_id: Number(form.user_id),
          expert_name: form.expert_name.trim(),
          introduction: form.introduction?.trim(),
          depart_ment: form.depart_ment?.trim(),
        });
      } else {
        result = await createExpert({
          user_id: Number(form.user_id),
          expert_name: form.expert_name.trim(),
          introduction: form.introduction?.trim(),
          depart_ment: form.depart_ment?.trim(),
        });
      }
      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{mode === 'create' ? '新增专家' : '编辑专家'}</span>
          <button type="button" className={s.modalClose} onClick={onClose} aria-label="关闭">
            <X size={14} />
          </button>
        </div>

        <div className={s.modalBody}>
          {error ? <div className={s.errorTip}>{error}</div> : null}

          <div className={s.row2}>
            <div className={s.field}>
              <label className={s.fieldLabel}>
                专家姓名<span className={s.req}>*</span>
              </label>
              <input
                className={s.input}
                value={form.expert_name}
                onChange={(e) => set('expert_name', e.target.value)}
                placeholder="请输入真实姓名"
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>
                关联用户<span className={s.req}>*</span>
              </label>
              <div className={s.userPicker}>
                <button
                  type="button"
                  className={s.userPickerBtn}
                  onClick={() => setUserPickerOpen((open) => !open)}
                  disabled={usersLoading && users.length === 0}
                >
                  <span>
                    {selectedUser
                      ? selectedUser.user_name
                      : form.user_id
                        ? form.expert_name || '已选用户'
                        : usersLoading
                          ? '用户加载中...'
                          : '请选择用户'}
                  </span>
                </button>
                {userPickerOpen ? (
                  <div className={s.userPickerMenu} onScroll={handleUserListScroll}>
                    {users.map((user) => {
                      const department = getUserDepartment(user);
                      const active = user.user_id === form.user_id;
                      return (
                        <button
                          key={user.user_id}
                          type="button"
                          className={`${s.userOption} ${active ? s.userOptionActive : ''}`}
                          onClick={() => selectUser(user.user_id)}
                        >
                          <span className={s.userOptionName}>{user.user_name}</span>
                          <span className={s.userOptionMeta}>
                            ID: {user.user_id}{department ? ` · 部门: ${department}` : ''}
                          </span>
                        </button>
                      );
                    })}
                    {usersLoading ? (
                      <div className={s.userPickerState}>用户加载中...</div>
                    ) : null}
                    {!usersLoading && users.length === 0 ? (
                      <div className={s.userPickerState}>暂无用户数据</div>
                    ) : null}
                    {!usersLoading && users.length > 0 && !hasMoreUsers ? (
                      <div className={s.userPickerState}>已加载全部用户</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <input
                type="hidden"
                value={form.user_id || ''}
                disabled={usersLoading}
                readOnly
              />
            </div>
          </div>

          <div className={s.field}>
            <label className={s.fieldLabel}>所属部门</label>
            <input
              className={s.input}
              value={form.depart_ment ?? ''}
              onChange={(e) => set('depart_ment', e.target.value)}
              placeholder="请输入所属部门"
            />
          </div>

          <div className={s.field}>
            <label className={s.fieldLabel}>专家简介</label>
            <textarea
              className={`${s.input} ${s.textarea}`}
              value={form.introduction ?? ''}
              onChange={(e) => set('introduction', e.target.value)}
              placeholder="专家的主要技能领域、从业经验等（可选）"
            />
          </div>
        </div>

        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={onClose} disabled={loading}>
            取消
          </button>
          <button
            type="button"
            className={s.btnPrimary}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '提交中…' : mode === 'create' ? '创建专家' : '保存更改'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 删除确认弹窗
// ═══════════════════════════════════════════════════════════════

interface ConfirmDeleteProps {
  expert: ExpertProfileResponse;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function ConfirmDeleteModal({ expert, onClose, onConfirm }: ConfirmDeleteProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败，请重试');
      setLoading(false);
    }
  }

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} style={{ maxWidth: 400 }}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>确认删除</span>
          <button type="button" className={s.modalClose} onClick={onClose} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmIcon}>
            <TriangleAlert size={24} />
          </div>
          <p className={s.confirmText}>
            确定要删除专家{' '}
            <span className={s.confirmName}>「{expert.expert_name}」</span>{' '}
            吗？此操作不可撤销，相关回答记录将保留。
          </p>
          {error ? <div className={s.errorTip} style={{ marginTop: 12 }}>{error}</div> : null}
        </div>
        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={onClose} disabled={loading}>
            取消
          </button>
          <button
            type="button"
            className={s.btnDanger}
            onClick={handleConfirm}
            disabled={loading}
          >
            <Trash2 size={13} />
            {loading ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function ExpertManagePage() {
  const [experts, setExperts] = useState<ExpertProfileResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 过滤
  const [search, setSearch] = useState('');

  // 弹窗状态
  type ModalState =
    | { type: 'none' }
    | { type: 'create' }
    | { type: 'edit'; expert: ExpertProfileResponse }
    | { type: 'delete'; expert: ExpertProfileResponse };

  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  // ─── 数据加载 ────────────────────────────────────────────────
  const load = useCallback(
    async (p: number) => {
      let active = true;
      setLoading(true);
      setError(null);
      try {
        const res = await fetchExpertProfiles(p, pageSize);
        if (!active) return;
        setExperts(res.experts);
        setTotal(res.total);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : '专家数据加载失败');
      } finally {
        if (active) setLoading(false);
      }
      return () => { active = false; };
    },
    [pageSize],
  );

  useEffect(() => {
    load(page);
  }, [page, load]);

  // ─── 客户端过滤 ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = experts;
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.expert_name.toLowerCase().includes(kw) ||
          (e.introduction ?? '').toLowerCase().includes(kw),
      );
    }
    return list;
  }, [experts, search]);

  // ─── 分页计算 ────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function buildPages(): (number | '...')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [1];
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  }

  // ─── CRUD 回调 ───────────────────────────────────────────────
  function handleCreateSuccess(expert: ExpertProfileResponse) {
    setExperts((prev) => [expert, ...prev]);
    setTotal((t) => t + 1);
    setModal({ type: 'none' });
  }

  function handleEditSuccess(updated: ExpertProfileResponse) {
    setExperts((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setModal({ type: 'none' });
  }

  async function handleDeleteConfirm(expert: ExpertProfileResponse) {
    await deleteExpert(expert.id);
    setExperts((prev) => prev.filter((e) => e.id !== expert.id));
    setTotal((t) => Math.max(0, t - 1));
    setModal({ type: 'none' });
  }

  // ─── Hero 统计 ───────────────────────────────────────────────
  const totalAnswers = experts.reduce((acc, e) => acc + (e.answer_count ?? 0), 0);
  const totalAdoptions = experts.reduce((acc, e) => acc + (e.adoption_count ?? 0), 0);

  return (
    <PageShell>
      {/* Hero */}
      <section className={s.heroStrip}>
        <div className={s.heroInner}>
          <div>
            <h1 className={s.heroTitle}>专家库管理</h1>
            <p className={s.heroSub}>管理认证专家信息、查看答题贡献与积分数据</p>
            <div className={s.heroStats}>
              <div className={s.heroStat}>
                <span className={s.heroStatNum}>{total}</span>
                <span className={s.heroStatLb}>认证专家</span>
              </div>
              <div className={s.heroStat}>
                <span className={s.heroStatNum}>{totalAnswers}</span>
                <span className={s.heroStatLb}>累计回答</span>
              </div>
              <div className={s.heroStat}>
                <span className={s.heroStatNum}>{totalAdoptions}</span>
                <span className={s.heroStatLb}>采纳次数</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => setModal({ type: 'create' })}
          >
            <Plus size={15} />
            新增专家
          </button>
        </div>
      </section>

      <div className={s.container}>
        {/* 面包屑 */}
        <div className={s.crumbs}>
          <Link to="/">首页</Link>
          <span> · </span>
          <Link to="/expert-qa">专家问答</Link>
          <span> · </span>
          <span>专家管理</span>
        </div>

        {/* 工具栏 */}
        <div className={s.toolbar}>
          <div className={s.toolbarLeft}>
            <div className={s.searchWrap}>
              <Search size={14} className={s.searchIco} />
              <input
                className={s.searchInput}
                placeholder="搜索专家姓名或简介…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {/* <select
              className={s.filterSelect}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="">所有部门</option>
              {DEPT_OPTIONS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select> */}
          </div>
          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => setModal({ type: 'create' })}
          >
            <Plus size={15} />
            新增专家
          </button>
        </div>

        {/* 错误提示 */}
        {error ? <div className={s.errorTip}>{error}</div> : null}

        {/* 表格 */}
        <div className={s.tableCard}>
          <div className={s.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>专家</th>
                  <th>部门</th>
                  <th>回答数</th>
                  <th>采纳数</th>
                  <th>获赞数</th>
                  <th>加入时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={s.stateRow}>专家数据加载中…</div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={s.stateRow}>
                        {search ? '没有符合条件的专家' : '暂无专家数据'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((expert) => (
                    <tr key={expert.id}>
                      {/* 专家信息列 */}
                      <td>
                        <div className={s.expertCell}>
                          <div
                            className={`${s.avatar} ${s.avatarExpert}`}
                            style={{ backgroundColor: avatarColor(expert.expert_name) }}
                          >
                            {initials(expert.expert_name)}
                          </div>
                          <div>
                            <div className={s.expertName}>
                              {expert.expert_name}
                              <BadgeCheck size={13} style={{ color: 'var(--primary-600)' }} />
                            </div>
                            {expert.introduction ? (
                              <div className={s.expertIntro}>{expert.introduction}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {/* 部门 */}
                      <td>
                        {expert.depart_ment ? (
                          <span className={s.deptPill}>{expert.depart_ment}</span>
                        ) : (
                          <span style={{ color: 'var(--neutral-400)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>

                      {/* 统计 */}
                      <td>
                        <span className={s.statNum}>{expert.answer_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.statNum}>{expert.adoption_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.statNum}>{expert.vote_count ?? 0}</span>
                      </td>

                      {/* 时间 */}
                      <td>
                        <span className={s.dateText}>{fmtDate(expert.created_at)}</span>
                      </td>

                      {/* 操作 */}
                      <td>
                        <div className={s.actionBtns}>
                          <button
                            type="button"
                            className={s.btnEdit}
                            onClick={() => setModal({ type: 'edit', expert })}
                          >
                            <Pencil size={12} />
                            编辑
                          </button>
                          <button
                            type="button"
                            className={s.btnDelete}
                            onClick={() => setModal({ type: 'delete', expert })}
                          >
                            <Trash2 size={12} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className={s.pagination}>
            <span>
              共 <strong>{total}</strong> 名专家，当前第 {page} / {totalPages} 页
            </span>
            <div className={s.pgBtns}>
              <button
                type="button"
                className={s.pgBtn}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                ‹ 上一页
              </button>

              {buildPages().map((pg, idx) =>
                pg === '...' ? (
                  <span key={`ellipsis-${idx}`} className={s.pgBtn} style={{ cursor: 'default', color: 'var(--neutral-400)' }}>
                    …
                  </span>
                ) : (
                  <button
                    key={pg}
                    type="button"
                    className={`${s.pgBtn} ${pg === page ? s.pgBtnActive : ''}`}
                    onClick={() => setPage(pg as number)}
                    disabled={loading}
                  >
                    {pg}
                  </button>
                ),
              )}

              <button
                type="button"
                className={s.pgBtn}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                下一页 ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 弹窗 ─────────────────────────────────────────── */}
      {modal.type === 'create' ? (
        <ExpertFormModal
          mode="create"
          initial={{ ...EMPTY_FORM }}
          onClose={() => setModal({ type: 'none' })}
          onSuccess={handleCreateSuccess}
        />
      ) : null}

      {modal.type === 'edit' ? (
        <ExpertFormModal
          mode="edit"
          initial={{
            id: modal.expert.id,
            user_id: modal.expert.user_id,
            expert_name: modal.expert.expert_name,
            introduction: modal.expert.introduction ?? '',
            depart_ment: modal.expert.depart_ment ?? '',
          }}
          onClose={() => setModal({ type: 'none' })}
          onSuccess={handleEditSuccess}
        />
      ) : null}

      {modal.type === 'delete' ? (
        <ConfirmDeleteModal
          expert={modal.expert}
          onClose={() => setModal({ type: 'none' })}
          onConfirm={() => handleDeleteConfirm(modal.expert)}
        />
      ) : null}
    </PageShell>
  );
}
