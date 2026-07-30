import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Download,
  FileUp,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';

import {
  createDictionary,
  deleteDictionary,
  exportDictionaries,
  fetchDictionaries,
  fetchDictionaryById,
  fetchDictionaryTypes,
  fetchNextSortOrder,
  importDictionaries,
  updateDictionary,
  type DictionaryCreateInput,
  type DictionaryItem,
  type DictionaryListQuery,
  type DictionaryUpdateInput,
  type DictionaryTypeOption,
} from '../../api/dictionaries';
import Pagination from '../../components/Pagination';
import s from './DictConfigPanel.module.css';

const PAGE_SIZE = 20;

interface EditorState {
  open: boolean;
  id: number | null;
  type: string;
  dict_key: string;
  dict_value: string;
  sort_order: number;
  is_enabled: boolean;
  error: string;
}

function emptyEditor(): EditorState {
  return {
    open: false,
    id: null,
    type: '',
    dict_key: '',
    dict_value: '',
    sort_order: 0,
    is_enabled: true,
    error: '',
  };
}

function itemToEditor(item: DictionaryItem): EditorState {
  return {
    open: true,
    id: item.id,
    type: item.type,
    dict_key: item.dict_key,
    dict_value: item.dict_value,
    sort_order: item.sort_order,
    is_enabled: item.is_enabled,
    error: '',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

export default function DictConfigPanel() {
  const [items, setItems] = useState<DictionaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [types, setTypes] = useState<DictionaryTypeOption[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);

  const [typeFilter, setTypeFilter] = useState('');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<boolean | ''>('');
  const [appliedType, setAppliedType] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [appliedEnabled, setAppliedEnabled] = useState<boolean | ''>('');
  const [sortAscending, setSortAscending] = useState(true);

  const [editor, setEditor] = useState<EditorState>(emptyEditor());
  const [deleteTarget, setDeleteTarget] = useState<DictionaryItem | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const query = useMemo<DictionaryListQuery>(
    () => ({
      type: appliedType || undefined,
      keyword: appliedKeyword || undefined,
      is_enabled: appliedEnabled === '' ? undefined : appliedEnabled,
      sort_by: sortAscending,
      page,
      page_size: PAGE_SIZE,
    }),
    [appliedType, appliedKeyword, appliedEnabled, sortAscending, page],
  );

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2400);
  };

  const loadTypes = async () => {
    setTypesLoading(true);
    try {
      const data = await fetchDictionaryTypes();
      setTypes(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTypesLoading(false);
    }
  };

  const loadItems = async (targetPage?: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchDictionaries({ ...query, page: targetPage ?? query.page });
      setItems(result.items);
      setTotal(result.total);
      if (targetPage) setPage(targetPage);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTypes();
  }, []);

  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.type, query.keyword, query.is_enabled, query.sort_by, query.page, query.page_size]);

  useEffect(() => {
    if (!editor.open || !editor.type) return;
    let cancelled = false;
    void fetchNextSortOrder(editor.type).then((next) => {
      if (!cancelled) {
        setEditor((current: EditorState) => ({ ...current, sort_order: next }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editor.open, editor.type]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    setAppliedType(typeFilter);
    setAppliedKeyword(keywordFilter.trim());
    setAppliedEnabled(enabledFilter);
  };

  const handleReset = () => {
    setTypeFilter('');
    setKeywordFilter('');
    setEnabledFilter('');
    setAppliedType('');
    setAppliedKeyword('');
    setAppliedEnabled('');
    setSortAscending(true);
    setPage(1);
  };

  const handleSortToggle = () => {
    setSortAscending((current: boolean) => !current);
    setPage(1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSearch();
    }
  };

  const openCreate = () => {
    setEditor({ ...emptyEditor(), open: true });
  };

  const openEdit = async (item: DictionaryItem) => {
    setBusy(true);
    setError('');
    try {
      const detail = await fetchDictionaryById(item.id);
      setEditor(itemToEditor(detail));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const closeEditor = () => {
    setEditor(emptyEditor());
  };

  const validateEditor = (): { input: DictionaryCreateInput | DictionaryUpdateInput; isValid: true } | { isValid: false } => {
    const type = editor.type.trim();
    const dict_key = editor.dict_key.trim();
    const dict_value = editor.dict_value.trim();
    const sortOrderNum = Number(editor.sort_order);

    if (!type) {
      setEditor((current: EditorState) => ({ ...current, error: '请输入分类' }));
      return { isValid: false };
    }
    if (!dict_key) {
      setEditor((current: EditorState) => ({ ...current, error: '请输入字典键' }));
      return { isValid: false };
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_]*$/.test(dict_key)) {
      setEditor((current: EditorState) => ({
        ...current,
        error: '字典键只能包含字母、数字、下划线，且以字母或数字开头',
      }));
      return { isValid: false };
    }
    if (!dict_value) {
      setEditor((current: EditorState) => ({ ...current, error: '请输入字典值' }));
      return { isValid: false };
    }
    if (Number.isNaN(sortOrderNum)) {
      setEditor((current: EditorState) => ({ ...current, error: '排序必须是数字' }));
      return { isValid: false };
    }

    const input: DictionaryCreateInput = {
      type,
      dict_key,
      dict_value,
      sort_order: sortOrderNum,
      is_enabled: editor.is_enabled,
    };
    return { input, isValid: true };
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const validation = validateEditor();
    if (!validation.isValid) return;

    void run(async () => {
      if (editor.id === null) {
        await createDictionary(validation.input as DictionaryCreateInput);
        showToast('字典创建成功');
      } else {
        await updateDictionary(editor.id, validation.input as DictionaryUpdateInput);
        showToast('字典更新成功');
      }
      closeEditor();
      await loadItems(1);
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    void run(async () => {
      await deleteDictionary(deleteTarget.id);
      showToast('字典删除成功');
      setDeleteTarget(null);
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      await loadItems(nextPage);
    });
  };

  const handleExport = () => {
    void run(async () => {
      await exportDictionaries(query);
      showToast('字典导出成功');
    });
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void run(async () => {
      await importDictionaries(file);
      showToast('字典导入成功');
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
      await loadItems(1);
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const typeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of types) {
      map.set(t.type, t.name);
    }
    return map;
  }, [types]);

  return (
    <div className={s.panel}>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>字典配置</h2>
      </div>

      <div className={s.filterBar}>
        <div className={s.filterGroup}>
          <label className={s.filterLabel}>分类</label>
          <select
            className={s.filterSelect}
            value={typeFilter}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => setTypeFilter(event.target.value)}
            disabled={typesLoading}
          >
            <option value="">全部</option>
            {types.map((type: DictionaryTypeOption) => (
              <option key={type.type} value={type.type}>
                {type.name} 
              </option>
            ))}
          </select>
        </div>
        <div className={s.filterGroup}>
          <label className={s.filterLabel}>关键字</label>
          <input
            type="text"
            className={s.filterInput}
            placeholder="模糊查询"
            value={keywordFilter}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setKeywordFilter(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className={s.filterGroup}>
          <label className={s.filterLabel}>状态</label>
          <select
            className={s.filterSelect}
            value={enabledFilter === '' ? '' : String(enabledFilter)}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value;
              setEnabledFilter(value === '' ? '' : value === 'true');
            }}
          >
            <option value="">全部</option>
            <option value="true">启用</option>
            <option value="false">禁用</option>
          </select>
        </div>
        <button type="button" className={s.searchBtn} onClick={handleSearch} disabled={loading || busy}>
          <Search size={14} />
          查询
        </button>
        <button type="button" className={s.resetBtn} onClick={handleReset} disabled={loading || busy}>
          重置
        </button>
        <div className={s.sortControl}>
          <button type="button" className={s.addBtn} onClick={openCreate} disabled={busy}>
            <Plus size={14} />
            新增
          </button>
          <button type="button" className={s.exportBtn} onClick={handleExport} disabled={busy}>
            <Download size={14} />
            导出
          </button>
          <button type="button" className={s.importBtn} onClick={handleImportClick} disabled={busy}>
            <FileUp size={14} />
            导入
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className={s.hiddenFileInput}
            onChange={handleImportFile}
          />
        </div>
      </div>

      {error ? (
        <div className={s.errorBox}>
          <XCircle size={16} />
          {error}
        </div>
      ) : null}

      {toast ? (
        <div className={`${s.toast} ${toast.type === 'success' ? s.toastSuccess : s.toastError}`} role="status">
          {toast.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
          <span>{toast.message}</span>
        </div>
      ) : null}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.colType}>分类</th>
              <th className={s.colKey}>字典键</th>
              <th className={s.colValue}>字典值</th>
              <th className={s.colSort}>
                <button type="button" className={s.sortHeader} onClick={handleSortToggle}>
                  排序
                  {sortAscending ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </button>
              </th>
              <th className={s.colStatus}>状态</th>
              <th className={s.colActions}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className={s.loadingCell}>
                  <span className={s.spinner} />
                  正在加载...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className={s.emptyCell}>
                  暂无字典数据
                </td>
              </tr>
            ) : (
              items.map((item: DictionaryItem) => (
                <tr key={item.id}>
                  <td className={s.colType}>{typeNameMap.get(item.type) ?? item.type}</td>
                  <td className={s.colKey}>{item.dict_key}</td>
                  <td className={s.colValue}>{item.dict_value}</td>
                  <td className={s.colSort}>{item.sort_order}</td>
                  <td className={s.colStatus}>
                    <span className={`${s.statusBadge} ${item.is_enabled ? s.statusEnabled : s.statusDisabled}`}>
                      {item.is_enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className={s.colActions}>
                    <button
                      type="button"
                      className={s.editBtn}
                      onClick={() => void openEdit(item)}
                      disabled={busy}
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                    <button
                      type="button"
                      className={s.deleteBtn}
                      onClick={() => setDeleteTarget(item)}
                      disabled={busy}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={s.paginationRow}>
        <span className={s.paginationInfo}>
          共 <strong>{total}</strong> 条，第 <strong>{page}</strong> / {totalPages} 页
        </span>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={(p) => setPage(p)} alwaysShow />
      </div>

      {editor.open && (
        <div className={s.modalBackdrop} onClick={closeEditor}>
          <div className={s.modalCard} onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
            <div className={s.modalHeader}>
              <h3>{editor.id === null ? '新增字典' : '编辑字典'}</h3>
              <button type="button" className={s.modalClose} onClick={closeEditor} disabled={busy}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className={s.modalBody}>
                {editor.error ? <div className={s.formError}>{editor.error}</div> : null}
                <div className={s.formField}>
                  <label className={s.formLabel}>
                    分类<span className={s.required}>*</span>
                  </label>
                  <select
                    className={s.formInput}
                    value={editor.type}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setEditor((current: EditorState) => ({ ...current, type: event.target.value, error: '' }))
                    }
                    disabled={typesLoading}
                    required
                  >
                    <option value="">请选择分类</option>
                    {editor.type && !types.some((t: DictionaryTypeOption) => t.type === editor.type) && (
                      <option value={editor.type}>{editor.type}</option>
                    )}
                    {types.map((type: DictionaryTypeOption) => (
                      <option key={type.type} value={type.type}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={s.formField}>
                  <label className={s.formLabel}>
                    字典键<span className={s.required}>*</span>
                  </label>
                  <input
                    type="text"
                    className={s.formInput}
                    value={editor.dict_key}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setEditor((current: EditorState) => ({ ...current, dict_key: event.target.value, error: '' }))
                    }
                    placeholder="例如：solved"
                    required
                  />
                </div>
                <div className={s.formField}>
                  <label className={s.formLabel}>
                    字典值<span className={s.required}>*</span>
                  </label>
                  <input
                    type="text"
                    className={s.formInput}
                    value={editor.dict_value}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setEditor((current: EditorState) => ({ ...current, dict_value: event.target.value, error: '' }))
                    }
                    placeholder="例如：已解决"
                    required
                  />
                </div>
                <div className={s.formField}>
                  <label className={s.formLabel}>排序</label>
                  <input
                    type="number"
                    className={s.formInput}
                    value={editor.sort_order}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setEditor((current: EditorState) => ({ ...current, sort_order: Number(event.target.value), error: '' }))
                    }
                    placeholder="例如：0"
                    required
                  />
                </div>
                <label className={s.switchField}>
                  <input
                    type="checkbox"
                    checked={editor.is_enabled}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setEditor((current: EditorState) => ({ ...current, is_enabled: event.target.checked }))
                    }
                  />
                  <span>
                    <strong>启用</strong>
                    <small>禁用后该字典项将不在业务端展示</small>
                  </span>
                </label>
              </div>
              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeEditor} disabled={busy}>
                  取消
                </button>
                <button type="submit" className={s.confirmBtn} disabled={busy}>
                  {busy ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className={s.modalBackdrop} onClick={() => setDeleteTarget(null)}>
          <div className={s.modalCard} onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
            <div className={s.modalHeader}>
              <h3>确认删除</h3>
              <button type="button" className={s.modalClose} onClick={() => setDeleteTarget(null)} disabled={busy}>
                <X size={18} />
              </button>
            </div>
            <div className={s.modalBody}>
              <p className={s.deleteHint}>
                确定要删除字典项 <strong>「{deleteTarget.dict_value}」</strong> 吗？此操作不可恢复。
              </p>
            </div>
            <div className={s.modalFooter}>
              <button type="button" className={s.cancelBtn} onClick={() => setDeleteTarget(null)} disabled={busy}>
                取消
              </button>
              <button type="button" className={s.dangerBtn} onClick={handleDelete} disabled={busy}>
                {busy ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
