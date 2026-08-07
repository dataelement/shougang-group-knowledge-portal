/**
 * ExpertManagePage.tsx
 * 专家列表管理页 — 支持分页、搜索、新增、编辑、删除
 * 路由：/expert-qa/manage  （需管理员权限）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  UIEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Pencil,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import {
  createExpert,
  deleteExpert,
  fetchExpertFilterOptions,
  fetchExpertProfiles,
  fetchUserList,
  updateExpert,
} from '../api/expertQa';
import type {
  ExpertFilterOptions,
  ExpertProfileResponse,
  ExpertSortField,
  ExpertSortOrder,
  ExpertUpsertPayload,
  UserListItem,
} from '../api/expertQa';
import { fetchDictionaries } from '../api/dictionaries';
import type { DictionaryItem } from '../api/dictionaries';
import s from './ExpertManagePage.module.css';
import { getAdminAccessState } from '../utils/adminAccess';
import { getNextExpertSort } from '../utils/expertManagement';
import { useAuth } from '../hooks/useAuth';
import expertBanner from '../assets/expert-manage-banner@2x.png';
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
const EXPERT_PAGE_SIZE = 10;
const DICT_PAGE_SIZE = 10;

/** 专家表单中字典下拉字段与字典类型的映射。 */
const DICT_TYPE_MAP = {
  job_family: 'expert_job_family',
  job_category: 'expert_job_category',
  position: 'expert_position',
  major: 'expert_major',
} as const;

interface ExpertFilters {
  departmentId: string;
  jobFamily: string;
  jobCategory: string;
  position: string;
  major: string;
}

const EMPTY_FILTERS: ExpertFilters = {
  departmentId: '',
  jobFamily: '',
  jobCategory: '',
  position: '',
  major: '',
};

const EMPTY_FILTER_OPTIONS: ExpertFilterOptions = {
  departments: [],
  job_families: [],
  job_categories: [],
  positions: [],
  majors: [],
};

const SORT_ICON_BASE = '/assets/channel';

const EXPERT_COLUMN_CONFIG = {
  name: { minWidth: 140, initialWidth: 170 },
  department: { minWidth: 140, initialWidth: 150 },
  jobFamily: { minWidth: 72, initialWidth: 100 },
  jobCategory: { minWidth: 72, initialWidth: 100 },
  position: { minWidth: 72, initialWidth: 96 },
  major: { minWidth: 72, initialWidth: 104 },
  answerCount: { minWidth: 64, initialWidth: 70 },
  adoptionCount: { minWidth: 64, initialWidth: 70 },
  voteCount: { minWidth: 72, initialWidth: 80 },
  createdAt: { minWidth: 100, initialWidth: 104 },
  actions: { minWidth: 88, initialWidth: 92 },
} as const;

type ExpertColumnKey = keyof typeof EXPERT_COLUMN_CONFIG;

function useResizableExpertColumns() {
  const [columnWidths, setColumnWidths] = useState<Record<ExpertColumnKey, number>>(
    () => Object.fromEntries(
      Object.entries(EXPERT_COLUMN_CONFIG).map(([key, config]) => [
        key,
        config.initialWidth,
      ]),
    ) as Record<ExpertColumnKey, number>,
  );
  const draggingRef = useRef<{
    key: ExpertColumnKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resizingInteractionUntilRef = useRef(0);

  const resizeBy = useCallback((columnKey: ExpertColumnKey, delta: number) => {
    setColumnWidths((current) => {
      const minWidth = EXPERT_COLUMN_CONFIG[columnKey].minWidth;
      const maxWidth = Math.max(400, window.innerWidth - 80);
      return {
        ...current,
        [columnKey]: Math.min(
          maxWidth,
          Math.max(minWidth, current[columnKey] + delta),
        ),
      };
    });
  }, []);

  const handleResizeStart = useCallback((
    columnKey: ExpertColumnKey,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();

    draggingRef.current = {
      key: columnKey,
      startX: event.clientX,
      startWidth: columnWidths[columnKey],
    };
    resizingInteractionUntilRef.current = Date.now() + 300;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dragging = draggingRef.current;
      if (!dragging) return;
      resizingInteractionUntilRef.current = Date.now() + 300;
      const minWidth = EXPERT_COLUMN_CONFIG[dragging.key].minWidth;
      const maxWidth = Math.max(400, window.innerWidth - 80);
      const nextWidth = Math.min(
        maxWidth,
        Math.max(minWidth, dragging.startWidth + moveEvent.clientX - dragging.startX),
      );
      const key = dragging.key;
      setColumnWidths((current) => ({ ...current, [key]: nextWidth }));
    };

    const cleanup = () => {
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };

    const handleMouseUp = () => {
      resizingInteractionUntilRef.current = Date.now() + 300;
      cleanup();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    cleanupRef.current = cleanup;
  }, [columnWidths]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const isResizingInteraction = useCallback(
    () => (
      draggingRef.current !== null
      || Date.now() < resizingInteractionUntilRef.current
    ),
    [],
  );

  const totalWidth = useMemo(
    () => Object.values(columnWidths).reduce((sum, width) => sum + width, 0),
    [columnWidths],
  );

  return {
    columnWidths,
    handleResizeStart,
    isResizingInteraction,
    resizeBy,
    totalWidth,
  };
}

// ─── 空表单 ──────────────────────────────────────────────────
const EMPTY_FORM: ExpertUpsertPayload = {
  user_id: 0,
  expert_name: '',
  introduction: '',
  depart_ment: '',
  department_id: '',
  major: '',
  position: '',
  job_family: '',
  job_category: '',
  wechat_user_id: '',
};

// ═══════════════════════════════════════════════════════════════
// 字典下拉选择器（用于职位族 / 职位类 / 职务 / 岗位）
// ═══════════════════════════════════════════════════════════════

interface DictSelectProps {
  type: string;
  value: string;
  placeholder?: string;
  onChange: (dictKey: string) => void;
}

function DictSelect({ type, value, placeholder = '请选择', onChange }: DictSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<DictionaryItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showBottomHint, setShowBottomHint] = useState(true);
  const loadingRef = useRef(false);
  const requestSeqRef = useRef(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((item) => item.dict_key === value);
  const inputValue = selectedItem ? selectedItem.dict_value : search;
  const hasMore = total === 0 || items.length < total;

  const loadItems = useCallback(async (pageNum: number, keyword: string) => {
    if (loadingRef.current && pageNum > 1) return;
    loadingRef.current = true;
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const res = await fetchDictionaries({
        type,
        keyword: keyword.trim() || undefined,
        page: pageNum,
        page_size: DICT_PAGE_SIZE,
      });
      if (requestSeq !== requestSeqRef.current) return;
      setItems((prev) => {
        const next = pageNum === 1 ? [] : [...prev];
        res.items.forEach((item) => {
          if (!next.some((existing) => existing.id === item.id)) {
            next.push(item);
          }
        });
        return next;
      });
      setPage(pageNum);
      setTotal(res.total);
    } catch {
      if (requestSeq !== requestSeqRef.current) return;
    } finally {
      if (requestSeq === requestSeqRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [type]);

  // 首次展开或搜索关键字变化时加载第一页
  useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => {
      setItems([]);
      setPage(0);
      setTotal(0);
      loadItems(1, search);
    }, 300);
    return () => window.clearTimeout(tid);
  }, [open, search, loadItems]);

  // 编辑回显：当前 value 对应的项不在已加载列表中时，尝试按 key 搜索一次
  useEffect(() => {
    if (!value || selectedItem) return;
    setSearch(value);
    const tid = window.setTimeout(() => {
      loadItems(1, value);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [value, selectedItem, loadItems]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // “已经到底了”提示展示 4 秒后自动消失
  useEffect(() => {
    if (loading || items.length === 0 || hasMore) {
      setShowBottomHint(true);
      return;
    }
    const tid = window.setTimeout(() => {
      setShowBottomHint(false);
    }, 1000);
    return () => window.clearTimeout(tid);
  }, [loading, items.length, hasMore]);

  function handleInputChange(nextSearch: string) {
    setSearch(nextSearch);
    setOpen(true);
    if (value && nextSearch.trim() !== (selectedItem?.dict_value ?? '').trim()) {
      onChange('');
    }
  }

  function handleSelect(item: DictionaryItem) {
    onChange(item.dict_key);
    setSearch(item.dict_value);
    setOpen(false);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 12;
    if (reachedBottom && hasMore && !loading) {
      loadItems(page + 1, search);
    }
  }

  return (
    <div className={s.userPicker} ref={wrapperRef}>
      <Search size={14} className={s.userPickerIco} />
      <input
        className={s.userPickerInput}
        value={inputValue}
        onChange={(event) => handleInputChange(event.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={loading && items.length === 0 ? '加载中...' : placeholder}
      />
      {open ? (
        <div className={s.userPickerMenu}>
          <div className={s.userOptionList} onScroll={handleScroll}>
            {items.map((item) => {
              const active = item.dict_key === value;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${s.userOption} ${active ? s.userOptionActive : ''}`}
                  onClick={() => handleSelect(item)}
                >
                  <span className={s.userOptionName}>{item.dict_value}</span>
                  <span className={s.userOptionMeta}>KEY: {item.dict_key}</span>
                </button>
              );
            })}
            {loading ? <div className={s.userPickerState}>加载中...</div> : null}
            {!loading && items.length === 0 ? (
              <div className={s.userPickerState}>
                {search.trim() ? '未找到匹配数据' : '暂无数据'}
              </div>
            ) : null}
            {!loading && items.length > 0 && !hasMore && showBottomHint ? (
              <div className={s.userPickerState}>已经到底了</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const isEdit = mode === 'edit';
  const selectedUser = users.find((item) => item.user_id === form.user_id);
  const hasMoreUsers = usersTotal === 0 || users.length < usersTotal;
  const selectedUserName = selectedUser?.user_name || form.expert_name || '已选用户';

  const isDirty = useMemo(() => {
    const normalize = (v: string | null | undefined) => (v ?? '').trim();
    return (
      normalize(form.expert_name) !== normalize(initial.expert_name) ||
      Number(form.user_id || 0) !== Number(initial.user_id || 0) ||
      normalize(form.depart_ment) !== normalize(initial.depart_ment) ||
      normalize(form.introduction) !== normalize(initial.introduction) ||
      normalize(form.major) !== normalize(initial.major) ||
      normalize(form.position) !== normalize(initial.position) ||
      normalize(form.job_family) !== normalize(initial.job_family) ||
      normalize(form.job_category) !== normalize(initial.job_category) ||
      normalize(form.wechat_user_id) !== normalize(initial.wechat_user_id)
    );
  }, [form, initial]);

  function requestClose() {
    if (isDirty) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  }

  function handleSaveAndClose() {
    void handleSubmit();
  }

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
      department_id: user.department_id ?? '',
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
          (item.user_id === userId && item.expert_name.trim() === expertName),
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
          depart_ment: form.department_id?.toString() || '',
          major: form.major?.trim(),
          position: form.position?.trim(),
          job_family: form.job_family?.trim(),
          job_category: form.job_category?.trim(),
          wechat_user_id: form.wechat_user_id?.trim() || undefined,
        });
      } else {
        result = await createExpert({
          user_id: userId,
          expert_name: expertName,
          introduction: form.introduction?.trim(),
          depart_ment: selectedUser?.department_id?.toString() || '',
          major: form.major?.trim(),
          position: form.position?.trim(),
          job_family: form.job_family?.trim(),
          job_category: form.job_category?.trim(),
          wechat_user_id: form.wechat_user_id?.trim() || undefined,
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
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className={s.modal}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{mode === 'create' ? '新增专家' : '编辑专家'}</span>
          <button type="button" className={s.modalClose} onClick={requestClose} aria-label="关闭">
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
                disabled={true}
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
              disabled={true}
            />
            <input
                type="hidden"
                value={form.department_id || ''}
                disabled={usersLoading}
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
          <div className={s.row2}>
            <div className={s.field}>
              <label className={s.fieldLabel}>所属职位族</label>
              <DictSelect
                type={DICT_TYPE_MAP.job_family}
                value={form.job_family ?? ''}
                placeholder="请选择所属职位族"
                onChange={(key) => set('job_family', key)}
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>所属职位类</label>
              <DictSelect
                type={DICT_TYPE_MAP.job_category}
                value={form.job_category ?? ''}
                placeholder="请选择所属职位类"
                onChange={(key) => set('job_category', key)}
              />
            </div>
          </div>
          <div className={s.row2}>
            <div className={s.field}>
              <label className={s.fieldLabel}>所属职务</label>
              <DictSelect
                type={DICT_TYPE_MAP.position}
                value={form.position ?? ''}
                placeholder="请选择所属职务"
                onChange={(key) => set('position', key)}
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>所属岗位</label>
              <DictSelect
                type={DICT_TYPE_MAP.major}
                value={form.major ?? ''}
                placeholder="请选择所属岗位"
                onChange={(key) => set('major', key)}
              />
            </div>
          </div>

          <div className={s.field}>
            <label className={s.fieldLabel}>用户企业微信 ID</label>
            <p className={s.fieldHint}>用于接收企业微信消息推送；可选</p>
            <input
              className={s.input}
              value={form.wechat_user_id ?? ''}
              onChange={(e) => set('wechat_user_id', e.target.value)}
              placeholder="请输入企业微信用户 ID"
            />
          </div>
        </div>

        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={requestClose} disabled={loading}>
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
      {showUnsavedConfirm ? (
        <UnsavedConfirmModal
          onCancel={() => setShowUnsavedConfirm(false)}
          onDiscard={onClose}
          onSave={handleSaveAndClose}
        />
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 未保存提示弹窗
// ═══════════════════════════════════════════════════════════════

interface UnsavedConfirmProps {
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

function UnsavedConfirmModal({ onCancel, onDiscard, onSave }: UnsavedConfirmProps) {
  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={s.modal} style={{ maxWidth: 420 }}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>未保存的更改</span>
          <button type="button" className={s.modalClose} onClick={onCancel} aria-label="关闭">
            <X size={14} />
          </button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmIcon}>
            <TriangleAlert size={24} />
          </div>
          <p className={s.confirmText}>
            当前填写的专家信息尚未保存，关闭后将丢失已输入的内容。是否保存？
          </p>
        </div>
        <div className={s.modalFoot}>
          <button type="button" className={s.btnGhost} onClick={onCancel}>
            取消
          </button>
          <button type="button" className={s.btnGhost} onClick={onDiscard}>
            不保存
          </button>
          <button type="button" className={s.btnPrimary} onClick={onSave}>
            保存
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

interface SortableHeaderProps {
  label: string;
  field: ExpertSortField;
  activeField: ExpertSortField;
  order: ExpertSortOrder;
  onSort: (field: ExpertSortField) => void;
  columnKey: ExpertColumnKey;
  width: number;
  onResizeStart: (
    columnKey: ExpertColumnKey,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void;
  onResizeBy: (columnKey: ExpertColumnKey, delta: number) => void;
  isResizingInteraction: () => boolean;
  title?: string;
}

interface ResizeHandleProps {
  columnKey: ExpertColumnKey;
  columnLabel: string;
  width: number;
  onResizeStart: (
    columnKey: ExpertColumnKey,
    event: ReactMouseEvent<HTMLSpanElement>,
  ) => void;
  onResizeBy: (columnKey: ExpertColumnKey, delta: number) => void;
  style?: CSSProperties;
}

function ResizeHandle({
  columnKey,
  columnLabel,
  width,
  onResizeStart,
  onResizeBy,
  style,
}: ResizeHandleProps) {
  function stopClick(event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 32 : 12;
    onResizeBy(columnKey, event.key === 'ArrowRight' ? step : -step);
  }

  return (
    <span
      className={s.resizeHandle}
      role="separator"
      aria-label={`调整${columnLabel}列宽`}
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      style={style}
      onClick={stopClick}
      onDoubleClick={stopClick}
      onMouseDown={(event) => onResizeStart(columnKey, event)}
      onKeyDown={handleKeyDown}
    >
      <span className={s.resizeHandleLine} aria-hidden />
    </span>
  );
}

function getSortIconSrc(active: boolean, order: ExpertSortOrder) {
  const direction = active && order === 'desc' ? 'down' : 'up';
  return `${SORT_ICON_BASE}/sort-amount-${direction}${active ? '-blue' : ''}.svg`;
}

function SortableHeader({
  label,
  field,
  activeField,
  order,
  onSort,
  columnKey,
  width,
  onResizeStart,
  onResizeBy,
  isResizingInteraction,
  title,
}: SortableHeaderProps) {
  const active = activeField === field;

  return (
    <th
      className={`${s.tableHeader} ${s.sortableHeader} ${active ? s.sortableHeaderActive : ''}`}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <button
        type="button"
        className={`${s.sortButton} ${active ? s.sortButtonActive : ''}`}
        onClick={(event) => {
          if (isResizingInteraction()) {
            event.preventDefault();
            return;
          }
          onSort(field);
        }}
        aria-label={`${label}，点击按${active && order === 'asc' ? '降序' : '升序'}排列`}
      >
        <span>{label}</span>
        <img
          className={`${s.sortIcon} ${active ? s.sortIconVisible : ''}`}
          src={getSortIconSrc(active, order)}
          alt=""
          aria-hidden
        />
      </button>
      <ResizeHandle
        columnKey={columnKey}
        columnLabel={label}
        width={width}
        onResizeStart={onResizeStart}
        onResizeBy={onResizeBy}
      />
    </th>
  );
}

interface ResizableHeaderProps {
  label: string;
  columnKey: ExpertColumnKey;
  width: number;
  onResizeStart: ResizeHandleProps['onResizeStart'];
  onResizeBy: ResizeHandleProps['onResizeBy'];
}

function ResizableHeader({
  label,
  columnKey,
  width,
  onResizeStart,
  onResizeBy,
}: ResizableHeaderProps) {
  return (
    <th
      className={s.tableHeader}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      <span className={s.plainHeaderLabel}>{label}</span>
      <ResizeHandle
        columnKey={columnKey}
        columnLabel={label}
        width={width}
        onResizeStart={onResizeStart}
        onResizeBy={onResizeBy}
      />
    </th>
  );
}

interface ContributionHeaderProps {
  widths: Pick<
    Record<ExpertColumnKey, number>,
    'answerCount' | 'adoptionCount' | 'voteCount'
  >;
  activeField: ExpertSortField;
  order: ExpertSortOrder;
  onSort: (field: ExpertSortField) => void;
  onResizeStart: ResizeHandleProps['onResizeStart'];
  onResizeBy: ResizeHandleProps['onResizeBy'];
  isResizingInteraction: () => boolean;
}

function ContributionHeader({
  widths,
  activeField,
  order,
  onSort,
  onResizeStart,
  onResizeBy,
  isResizingInteraction,
}: ContributionHeaderProps) {
  const active = activeField === 'expert_score';
  const totalWidth = widths.answerCount + widths.adoptionCount + widths.voteCount;

  return (
    <th
      className={`${s.tableHeader} ${s.sortableHeader} ${s.contributionHeader} ${active ? s.sortableHeaderActive : ''}`}
      colSpan={3}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ width: totalWidth, minWidth: totalWidth, maxWidth: totalWidth }}
    >
      <button
        type="button"
        className={`${s.contributionSortButton} ${active ? s.sortButtonActive : ''}`}
        style={{
          gridTemplateColumns: `${widths.answerCount}px ${widths.adoptionCount}px ${widths.voteCount}px`,
        }}
        onClick={(event) => {
          if (isResizingInteraction()) {
            event.preventDefault();
            return;
          }
          onSort('expert_score');
        }}
        aria-label={`回答数、采纳数、获赞数整体排序，点击按${active && order === 'asc' ? '降序' : '升序'}排列`}
      >
        <span>回答数</span>
        <span>采纳数</span>
        <span className={s.contributionLastLabel}>
          获赞数
          <img
            className={`${s.sortIcon} ${active ? s.sortIconVisible : ''}`}
            src={getSortIconSrc(active, order)}
            alt=""
            aria-hidden
          />
        </span>
      </button>
      <ResizeHandle
        columnKey="answerCount"
        columnLabel="回答数"
        width={widths.answerCount}
        onResizeStart={onResizeStart}
        onResizeBy={onResizeBy}
        style={{ left: widths.answerCount - 4, right: 'auto' }}
      />
      <ResizeHandle
        columnKey="adoptionCount"
        columnLabel="采纳数"
        width={widths.adoptionCount}
        onResizeStart={onResizeStart}
        onResizeBy={onResizeBy}
        style={{
          left: widths.answerCount + widths.adoptionCount - 4,
          right: 'auto',
        }}
      />
      <ResizeHandle
        columnKey="voteCount"
        columnLabel="获赞数"
        width={widths.voteCount}
        onResizeStart={onResizeStart}
        onResizeBy={onResizeBy}
      />
    </th>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════════

export default function ExpertManagePage() {
  const [experts, setExperts] = useState<ExpertProfileResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = getAdminAccessState(user) === 'allowed';
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ExpertFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<ExpertFilterOptions>(
    EMPTY_FILTER_OPTIONS,
  );
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);
  const [sort, setSort] = useState<{
    field: ExpertSortField;
    order: ExpertSortOrder;
  }>({
    field: 'expert_score',
    order: 'desc',
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const {
    columnWidths,
    handleResizeStart,
    isResizingInteraction,
    resizeBy,
    totalWidth: tableWidth,
  } = useResizableExpertColumns();
  // 弹窗状态
  type ModalState =
    | { type: 'none' }
    | { type: 'create' }
    | { type: 'edit'; expert: ExpertProfileResponse }
    | { type: 'delete'; expert: ExpertProfileResponse };

  const [modal, setModal] = useState<ModalState>({ type: 'none' });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setFilterOptionsLoading(true);
    fetchExpertFilterOptions(controller.signal)
      .then(setFilterOptions)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFilterOptions(EMPTY_FILTER_OPTIONS);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFilterOptionsLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  // ─── 数据加载 ────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    async function loadExperts() {
      setLoading(true);
      setError(null);
      try {
        const filterLabels = {
          jobFamily: filterOptions.job_families.find((item) => item.dict_key === filters.jobFamily)?.dict_value,
          jobCategory: filterOptions.job_categories.find((item) => item.dict_key === filters.jobCategory)?.dict_value,
          position: filterOptions.positions.find((item) => item.dict_key === filters.position)?.dict_value,
          major: filterOptions.majors.find((item) => item.dict_key === filters.major)?.dict_value,
        };
        const res = await fetchExpertProfiles(
          page,
          EXPERT_PAGE_SIZE,
          search || undefined,
          controller.signal,
          {
            ...filters,
            sortBy: sort.field,
            sortOrder: sort.order,
            filterLabels,
          },
        );
        setExperts(res.experts);
        setTotal(res.total);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '专家数据加载失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadExperts();
    return () => controller.abort();
  }, [filters, page, refreshKey, search, sort.field, sort.order, filterOptions]);

  // ─── 分页计算 ────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / EXPERT_PAGE_SIZE));
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasQueryConditions = Boolean(search || activeFilterCount);

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
  function handleCreateSuccess() {
    setPage(1);
    setModal({ type: 'none' });
    setRefreshKey((key) => key + 1);
  }

  function handleEditSuccess() {
    setModal({ type: 'none' });
    setRefreshKey((key) => key + 1);
  }

  async function handleDeleteConfirm(expert: ExpertProfileResponse) {
    await deleteExpert(expert.id);
    setModal({ type: 'none' });
    if (experts.length === 1 && page > 1) {
      setPage((current) => current - 1);
    } else {
      setRefreshKey((key) => key + 1);
    }
  }

  function handleFilterChange(key: keyof ExpertFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function handleResetFilters() {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }

  function handleSort(field: ExpertSortField) {
    setSort((current) => getNextExpertSort(current, field));
    setPage(1);
  }

  const resizeProps = {
    onResizeStart: handleResizeStart,
    onResizeBy: resizeBy,
  };
  const sortableResizeProps = {
    ...resizeProps,
    isResizingInteraction,
  };

  return (
    <PageShell>
      {/* Hero banner */}
      <section
        className={s.heroStrip}
        style={{ backgroundImage: `url(${expertBanner})` }}
      >
        <div className={s.heroInner}>
          <h1 className={s.heroTitle}>专家库管理</h1>
          <p className={s.heroSub}>管理认证专家信息、查看答题贡献数据</p>
          {isAdmin && (
            <button
              type="button"
              className={s.heroBtn}
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
          <ChevronRight size={14} className={s.crumbChevron} />
          <span>专家管理</span>
        </div>

        {/* 错误提示 */}
        {error ? <div className={s.errorTip}>{error}</div> : null}

        {/* 表格 */}
        <div className={s.tableCard}>
          {/* 卡片头部：标题 + 搜索 */}
          <div className={s.cardHead}>
            <div className={s.cardTitleGroup}>
              <span className={s.cardTitle}>专家列表</span>
              <span className={s.resultCount}>{total} 名专家</span>
            </div>
            <div className={s.searchWrap}>
              <Search size={14} className={s.searchIco} />
              <input
                className={s.searchInput}
                placeholder="搜索专家姓名或简介"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput ? (
                <button
                  type="button"
                  className={s.searchClear}
                  onClick={() => setSearchInput('')}
                  aria-label="清空搜索"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
          </div>

          <div className={s.filterBar}>
            <div className={s.filterBarTitle}>
              <SlidersHorizontal size={14} />
              <span>筛选</span>
              {activeFilterCount ? (
                <span className={s.filterBadge}>{activeFilterCount}</span>
              ) : null}
            </div>
            <label className={s.filterField}>
              <span>部门</span>
              <select
                className={s.filterSelect}
                value={filters.departmentId}
                onChange={(event) => handleFilterChange('departmentId', event.target.value)}
                disabled={filterOptionsLoading}
              >
                <option value="">全部部门</option>
                {filterOptions.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.filterField}>
              <span>职位族</span>
              <select
                className={s.filterSelect}
                value={filters.jobFamily}
                onChange={(event) => handleFilterChange('jobFamily', event.target.value)}
                disabled={filterOptionsLoading}
              >
                <option value="">全部职位族</option>
                {filterOptions.job_families.map((item) => (
                  <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
                ))}
              </select>
            </label>
            <label className={s.filterField}>
              <span>职位类</span>
              <select
                className={s.filterSelect}
                value={filters.jobCategory}
                onChange={(event) => handleFilterChange('jobCategory', event.target.value)}
                disabled={filterOptionsLoading}
              >
                <option value="">全部职位类</option>
                {filterOptions.job_categories.map((item) => (
                  <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
                ))}
              </select>
            </label>
            <label className={s.filterField}>
              <span>职务</span>
              <select
                className={s.filterSelect}
                value={filters.position}
                onChange={(event) => handleFilterChange('position', event.target.value)}
                disabled={filterOptionsLoading}
              >
                <option value="">全部职务</option>
                {filterOptions.positions.map((item) => (
                  <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
                ))}
              </select>
            </label>
            <label className={s.filterField}>
              <span>岗位</span>
              <select
                className={s.filterSelect}
                value={filters.major}
                onChange={(event) => handleFilterChange('major', event.target.value)}
                disabled={filterOptionsLoading}
              >
                <option value="">全部岗位</option>
                {filterOptions.majors.map((item) => (
                  <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={s.resetFilters}
              onClick={handleResetFilters}
              disabled={!activeFilterCount}
            >
              <RotateCcw size={13} />
              重置筛选
            </button>
          </div>

          <div className={s.tableWrap}>
            <table className={s.expertTable} style={{ minWidth: tableWidth }}>
              <colgroup>
                <col style={{ width: columnWidths.name }} />
                <col style={{ width: columnWidths.department }} />
                <col style={{ width: columnWidths.jobFamily }} />
                <col style={{ width: columnWidths.jobCategory }} />
                <col style={{ width: columnWidths.position }} />
                <col style={{ width: columnWidths.major }} />
                <col style={{ width: columnWidths.answerCount }} />
                <col style={{ width: columnWidths.adoptionCount }} />
                <col style={{ width: columnWidths.voteCount }} />
                <col style={{ width: columnWidths.createdAt }} />
                {isAdmin && <col style={{ width: columnWidths.actions }} />}
              </colgroup>
              <thead>
                <tr>
                  <SortableHeader
                    label="名字"
                    field="expert_name"
                    columnKey="name"
                    width={columnWidths.name}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="部门"
                    field="department"
                    columnKey="department"
                    width={columnWidths.department}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="职位族"
                    field="job_family"
                    columnKey="jobFamily"
                    width={columnWidths.jobFamily}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="职位类"
                    field="job_category"
                    columnKey="jobCategory"
                    width={columnWidths.jobCategory}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="职务"
                    field="position"
                    columnKey="position"
                    width={columnWidths.position}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="岗位"
                    field="major"
                    columnKey="major"
                    width={columnWidths.major}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <ContributionHeader
                    widths={{
                      answerCount: columnWidths.answerCount,
                      adoptionCount: columnWidths.adoptionCount,
                      voteCount: columnWidths.voteCount,
                    }}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  <SortableHeader
                    label="加入时间"
                    field="created_at"
                    columnKey="createdAt"
                    width={columnWidths.createdAt}
                    activeField={sort.field}
                    order={sort.order}
                    onSort={handleSort}
                    {...sortableResizeProps}
                  />
                  {isAdmin && (
                    <ResizableHeader
                      label="操作"
                      columnKey="actions"
                      width={columnWidths.actions}
                      {...resizeProps}
                    />
                  )}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={isAdmin ? 11 : 10}>
                      <div className={s.stateRow}>专家数据加载中…</div>
                    </td>
                  </tr>
                ) : experts.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 11 : 10}>
                      <div className={s.stateRow}>
                        {hasQueryConditions ? '没有符合条件的专家' : '暂无专家数据'}
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

                      <td>
                        <span className={s.cellText}>{expert.job_family || '—'}</span>
                      </td>
                      <td>
                        <span className={s.cellText}>{expert.job_category || '—'}</span>
                      </td>
                      <td>
                        <span className={s.cellText}>{expert.position || '—'}</span>
                      </td>
                      <td>
                        <span className={s.cellText}>{expert.major || '—'}</span>
                      </td>

                      <td>
                        <span className={s.contributionValue}>{expert.answer_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.contributionValue}>{expert.adoption_count ?? 0}</span>
                      </td>
                      <td>
                        <span className={s.contributionValue}>{expert.vote_count ?? 0}</span>
                      </td>

                      {/* 时间 */}
                      <td>
                        <span className={s.dateText}>{fmtDate(expert.created_at)}</span>
                      </td>

                      {/* 操作 */}
                      {isAdmin && (
                        <td className={s.actionCell}>
                          <div className={s.actionBtns}>
                            <button
                              type="button"
                              className={`${s.actionIconBtn} ${s.btnEdit}`}
                              onClick={() => setModal({ type: 'edit', expert })}
                              aria-label={`编辑专家 ${expert.expert_name}`}
                              title="编辑"
                            >
                              <Pencil size={16} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className={`${s.actionIconBtn} ${s.btnDelete}`}
                              onClick={() => setModal({ type: 'delete', expert })}
                              aria-label={`删除专家 ${expert.expert_name}`}
                              title="删除"
                            >
                              <Trash2 size={16} aria-hidden />
                            </button>
                          </div>
                        </td>
                      )}
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
          department_id: modal.expert.department_id ?? '',
          major: modal.expert.major ?? '',
          position: modal.expert.position ?? '',
          job_family: modal.expert.job_family ?? '',
          job_category: modal.expert.job_category ?? '',
          wechat_user_id: modal.expert.wechat_user_id ?? '',
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
