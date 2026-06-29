/**
 * ExpertManagePage.tsx
 * 专家列表管理页 — 支持分页、搜索、新增、编辑、删除
 * 路由：/expert-qa/manage  （需管理员权限）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Pencil,
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
import { getAdminAccessState } from '../utils/adminAccess';
import { useAuth } from '../hooks/useAuth';
import expertBanner from '../assets/expert-banner@2x.png';
import verifiedIcon from '../assets/icon-verified-expert.svg';

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
  major: '',
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
  const usersRequestSeq = useRef(0);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState(initial.expert_name ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = mode === 'edit';
  const selectedUser = users.find((item) => item.user_id === form.user_id);
  const hasMoreUsers = usersTotal === 0 || users.length < usersTotal;
  const selectedUserName = selectedUser?.user_name || form.expert_name || '已选用户';

  function set(key: keyof ExpertUpsertPayload, value: string | number) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleUserSearchChange(value: string) {
    if (isEdit) return;
    setUserSearch(value);
    setUserPickerOpen(true);
    if (form.user_id && value.trim() !== form.expert_name.trim()) {
      setForm((prev) => ({
        ...prev,
        user_id: 0,
        expert_name: '',
        depart_ment: '',
      }));
    }
  }

  const loadUsers = useCallback(async (pageNum: number, keyword = userSearch.trim()) => {
    if (isEdit) return;
    if (usersLoadingRef.current && pageNum > 1) return;
    usersLoadingRef.current = true;
    const requestSeq = ++usersRequestSeq.current;
    const normalizedKeyword = keyword.trim();
    setUsersLoading(true);
    try {
      const res = await fetchUserList(pageNum, USER_PAGE_SIZE, normalizedKeyword || undefined);
      if (requestSeq !== usersRequestSeq.current) return;
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
      if (requestSeq !== usersRequestSeq.current) return;
      setError(err instanceof Error ? err.message : '用户列表加载失败');
    } finally {
      if (requestSeq === usersRequestSeq.current) {
        usersLoadingRef.current = false;
        setUsersLoading(false);
      }
    }
  }, [isEdit, userSearch]);

  useEffect(() => {
    if (isEdit) return;
    const tid = window.setTimeout(() => {
      setUsers([]);
      setUsersPage(0);
      setUsersTotal(0);
      loadUsers(1, userSearch);
    }, 300);
    return () => window.clearTimeout(tid);
  }, [isEdit, loadUsers, userSearch]);

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
    setUserSearch(user.user_name);
    setUserPickerOpen(false);
  }

  function handleUserListScroll(e: UIEvent<HTMLDivElement>) {
    if (isEdit) return;
    const target = e.currentTarget;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 12;
    if (reachedBottom && hasMoreUsers && !usersLoading) {
      loadUsers(usersPage + 1, userSearch);
    }
  }

  async function handleSubmit() {
    const expertName = form.expert_name.trim();
    const userId = Number(form.user_id);
    if (!expertName) {
      setError('请先选择关联用户生成专家姓名');
      return;
    }
    if (!userId || userId <= 0) {
      setError('请选择关联用户');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const existing = await fetchExpertProfiles(1, 500, expertName);
      const duplicate = existing.experts.find(
        (item) =>
          item.id !== form.id &&
          (item.user_id === userId || item.expert_name.trim() === expertName),
      );
      if (duplicate) {
        setError('该专家已存在');
        return;
      }

      let result: ExpertProfileResponse;
      if (mode === 'edit' && form.id != null) {
        result = await updateExpert(form.id, {
          user_id: userId,
          expert_name: expertName,
          introduction: form.introduction?.trim(),
          depart_ment: form.depart_ment?.trim(),
          major: form.major?.trim(),
        });
      } else {
        result = await createExpert({
          user_id: userId,
          expert_name: expertName,
          introduction: form.introduction?.trim(),
          depart_ment: form.depart_ment?.trim(),
          major: form.major?.trim(),
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
                placeholder="选择关联用户后自动填充"
                readOnly
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>
                关联用户<span className={s.req}>*</span>
              </label>
              <div className={`${s.userPicker} ${isEdit ? s.userPickerReadonly : ''}`}>
                <Search size={14} className={s.userPickerIco} />
                <input
                  className={`${s.userPickerInput} ${isEdit ? s.userPickerInputReadonly : ''}`}
                  value={isEdit ? selectedUserName : userSearch}
                  onChange={(e) => handleUserSearchChange(e.target.value)}
                  onFocus={() => {
                    if (!isEdit) setUserPickerOpen(true);
                  }}
                  placeholder={usersLoading && users.length === 0 ? '用户加载中...' : '输入用户名称搜索'}
                  readOnly={isEdit}
                />
                {userPickerOpen && !isEdit ? (
                  <div className={s.userPickerMenu}>
                    <div className={s.userOptionList} onScroll={handleUserListScroll}>
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
                        <div className={s.userPickerState}>
                          {userSearch.trim() ? '未找到匹配用户' : '暂无用户数据'}
                        </div>
                      ) : null}
                      {!usersLoading && users.length > 0 && !hasMoreUsers ? (
                        <div className={s.userPickerState}>已加载全部用户</div>
                      ) : null}
                    </div>
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
              placeholder="选择关联用户后自动填充"
              readOnly
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
          <div className={s.field}>
            <label className={s.fieldLabel}>所属专业</label>
            <input
              className={s.input}
              value={form.major ?? ''}
              onChange={(e) => set('major', e.target.value)}
              placeholder="请输入所属专业"
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
  const [pageSize,setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  // 过滤
  const [search, setSearch] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
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
        const res = await fetchExpertProfiles(p, pageSize, search.trim() || undefined);
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
    [pageSize, search],
  );

  useEffect(() => {
    console.log(user)
    setIsAdmin(getAdminAccessState(user) === 'allowed');
    load(page);
  }, [page, load]);

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
    setPage(1);
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

  return (
    <PageShell>
      {/* Hero banner */}
      <section
        className={s.heroStrip}
        style={{ backgroundImage: `url(${expertBanner})` }}
      >
        <div className={s.heroInner}>
          <h1 className={s.heroTitle}>专家库管理</h1>
          <p className={s.heroSub}>管理认证专家信息、查看答题贡献与积分数据</p>
          {isAdmin && (
            <button
              type="button"
              className={s.btnPrimary}
              onClick={() => setModal({ type: 'create' })}
            >
              新增专家
            </button>
          )}
        </div>
      </section>

      <div className={s.container}>
        {/* 面包屑 */}
        <div className={s.crumbs}>
          <Link to="/expert-qa">专家问答</Link>
          <span className={s.crumbSep}>&gt;</span>
          <span>专家管理</span>
        </div>

        {/* 错误提示 */}
        {error ? <div className={s.errorTip}>{error}</div> : null}

        {/* 表格 */}
        <div className={s.tableCard}>
          {/* 卡片头部：标题 + 搜索 */}
          <div className={s.cardHead}>
            <span className={s.cardTitle}>专家列表</span>
            <div className={s.searchWrap}>
              <Search size={14} className={s.searchIco} />
              <input
                className={s.searchInput}
                placeholder="搜索专家姓名或简介"
                value={search}
                onChange={(e) => {
                  setPageSize(500);
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className={s.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>名字</th>
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
                ) : experts.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className={s.stateRow}>
                        {search ? '没有符合条件的专家' : '暂无专家数据'}
                      </div>
                    </td>
                  </tr>
                ) : (
                  experts.map((expert) => (
                    <tr key={expert.id}>
                      {/* 专家信息列 */}
                      <td>
                        <div className={s.expertCell}>
                          <div
                            className={s.avatar}
                            style={{ backgroundColor: avatarColor(expert.expert_name) }}
                          >
                            {initials(expert.expert_name)}
                          </div>
                          <div>
                            <div className={s.expertName}>
                              {expert.expert_name}
                              <img src={verifiedIcon} alt="认证专家" width={14} height={14} />
                            </div>
                            {expert.introduction ? (
                              <div className={s.expertIntro}>{expert.introduction}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {/* 部门 */}
                      <td>
                        <span className={s.cellText}>{expert.depart_ment || '—'}</span>
                      </td>

                      {/* 统计 */}
                      <td>
                        <span className={s.cellText}>{expert.answer_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.cellText}>{expert.adoption_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.cellText}>{expert.vote_count ?? 0}</span>
                      </td>

                      {/* 时间 */}
                      <td>
                        <span className={s.dateText}>{fmtDate(expert.created_at)}</span>
                      </td>

                      {/* 操作 */}
                      <td>
                        <div className={s.actionBtns}>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                className={s.btnEdit}
                                onClick={() => setModal({ type: 'edit', expert })}
                              >
                                <Pencil size={14} />
                                编辑
                              </button>
                              <span className={s.actionSep} aria-hidden />
                              <button
                                type="button"
                                className={s.btnDelete}
                                onClick={() => setModal({ type: 'delete', expert })}
                              >
                                <Trash2 size={14} />
                                删除
                              </button>
                            </>
                          )}

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
              共 <strong>{total}</strong> 名专家，当前第 {page} 页
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
            major: modal.expert.major ?? '',
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
