import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import {
  type DepartmentBusinessDomainBinding,
  type DepartmentOption,
  type DomainConfig,
  fetchBindingDepartments,
  fetchDepartmentBusinessDomains,
  updateDepartmentBusinessDomains,
} from '../../api/adminConfig';
import {
  flattenDepartmentOptions,
  normalizeBusinessDomainCode,
  normalizeDepartmentBusinessDomainBindings,
  validateDepartmentBusinessDomainBindings,
} from '../../utils/departmentBusinessDomains';
import s from '../AdminPage.module.css';

type BindingDraft = DepartmentBusinessDomainBinding & { row_id: string };

function createDraft(
  binding: DepartmentBusinessDomainBinding = { department_id: 0, business_domain_codes: [] },
  index = 0,
): BindingDraft {
  return {
    department_id: binding.department_id,
    business_domain_codes: binding.business_domain_codes,
    row_id: [binding.department_id || 'new', index, Date.now()].join('-'),
  };
}

export default function DepartmentBusinessDomainBindingsPanel({ domains }: { domains: DomainConfig[] }) {
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [drafts, setDrafts] = useState<BindingDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const domainOptions = useMemo(() => domains
    .map((domain) => ({
      code: normalizeBusinessDomainCode(domain.code),
      name: domain.name,
      enabled: domain.enabled,
    }))
    .filter((domain) => domain.enabled && domain.code), [domains]);
  const flatDepartments = useMemo(() => flattenDepartmentOptions(departments), [departments]);
  const selectedDepartmentIds = useMemo(
    () => new Set(drafts.map((draft) => draft.department_id).filter(Boolean)),
    [drafts],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([fetchBindingDepartments(), fetchDepartmentBusinessDomains()])
      .then(([departmentItems, response]) => {
        if (!active) return;
        setDepartments(departmentItems);
        setDrafts(response.bindings.map(createDraft));
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : '部门业务域绑定加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateDraft = (rowId: string, patch: Partial<DepartmentBusinessDomainBinding>) => {
    setDrafts((current) => current.map((draft) => (
      draft.row_id === rowId ? { ...draft, ...patch } : draft
    )));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    const validationError = validateDepartmentBusinessDomainBindings(
      drafts,
      domainOptions.map((domain) => domain.code),
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    const normalized = normalizeDepartmentBusinessDomainBindings(drafts);
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await updateDepartmentBusinessDomains(normalized);
      setDrafts(response.bindings.map(createDraft));
      setSuccess('部门业务域绑定已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '部门业务域绑定保存失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="department-business-domain-title">
      <div className={s.titleBar}>
        <div>
          <h2 id="department-business-domain-title" className={s.pageTitle}>部门业务域绑定</h2>
          <p className={s.panelDescription}>
            每个部门可精确绑定多个业务域。绑定只用于推荐特征，不向父部门或子部门继承，也不会授予文件权限。
          </p>
        </div>
        <div className={s.actions}>
          <button
            type="button"
            className={s.subtleBtn}
            onClick={() => setDrafts((current) => [...current, createDraft(undefined, current.length)])}
            disabled={loading || saving}
          >
            <Plus size={16} />
            新增绑定
          </button>
          <button type="button" className={s.addBtn} onClick={() => void handleSave()} disabled={loading || saving}>
            <Save size={16} />
            {saving ? '保存中…' : '保存全部'}
          </button>
        </div>
      </div>

      {error ? <div className={s.errorBox} role="alert">{error}</div> : null}
      {success ? <div className={s.successBox} role="status">{success}</div> : null}
      {loading ? <div className={s.emptyState}>正在加载部门与绑定配置…</div> : null}
      {!loading && drafts.length === 0 ? (
        <div className={s.emptyState}>
          暂未配置部门业务域。点击“新增绑定”开始配置；保持空列表并保存可清空全部绑定。
        </div>
      ) : null}

      {!loading && drafts.length > 0 ? (
        <div className={s.bindingList}>
          {drafts.map((draft, index) => {
            const departmentInputId = 'binding-department-' + draft.row_id;
            return (
              <fieldset key={draft.row_id} className={s.bindingCard}>
                <legend className={s.bindingLegend}>绑定 {index + 1}</legend>
                <div className={s.bindingDepartment}>
                  <label className={s.fieldLabel} htmlFor={departmentInputId}>部门</label>
                  <select
                    id={departmentInputId}
                    className={s.formSelect}
                    value={draft.department_id || ''}
                    onChange={(event) => updateDraft(draft.row_id, { department_id: Number(event.target.value) })}
                    disabled={saving}
                  >
                    <option value="">请选择部门</option>
                    {flatDepartments.map((department) => (
                      <option
                        key={department.id}
                        value={department.id}
                        disabled={department.id !== draft.department_id && selectedDepartmentIds.has(department.id)}
                      >
                        {department.label}
                      </option>
                    ))}
                  </select>
                  <span className={s.fieldHint}>只绑定当前部门，不继承上级或下级部门。</span>
                </div>

                <div className={s.bindingDomains}>
                  <span className={s.fieldLabel}>业务域（可多选）</span>
                  <div className={s.domainCheckboxGrid}>
                    {domainOptions.map((domain) => {
                      const selected = draft.business_domain_codes.includes(domain.code);
                      return (
                        <label
                          key={domain.code}
                          className={[s.domainCheckbox, selected ? s.domainCheckboxSelected : ''].filter(Boolean).join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={saving}
                            onChange={(event) => {
                              const nextCodes = event.target.checked
                                ? [...draft.business_domain_codes, domain.code]
                                : draft.business_domain_codes.filter((code) => code !== domain.code);
                              updateDraft(draft.row_id, { business_domain_codes: nextCodes });
                            }}
                          />
                          <span>{domain.name}</span>
                          <small>{domain.code}</small>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  className={s.bindingDeleteButton}
                  aria-label={'删除绑定 ' + (index + 1)}
                  onClick={() => setDrafts((current) => current.filter((item) => item.row_id !== draft.row_id))}
                  disabled={saving}
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
