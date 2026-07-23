import { useState } from 'react';
import {
  updateRestAuthRuntimeConfig,
  type RestAuthRuntimeConfig,
} from '../../api/adminConfig';
import {
  createRestAuthDraft,
  validateRestAuthDraft,
  type RestAuthDraft,
} from '../../utils/adminRestAuthConfig';
import s from '../AdminPage.module.css';

function RestAuthConfigTable({
  config,
  saving,
  onEdit,
}: {
  config: RestAuthRuntimeConfig | null;
  saving: boolean;
  onEdit: () => void;
}) {
  const missing = config?.missing_fields?.filter((field) => field !== 'enabled') ?? [];
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>统一认证 REST 配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户后端调用统一身份认证 REST 接口的参数。login_sync_hmac_secret 可留空，将自动沿用环境变量中的配置。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>启用状态</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.enabled ? '已启用' : '未启用'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>REST Base URL</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.rest_base_url || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>REST AppId</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.rest_app_id || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>IAM 接口地址</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueMeta}>Authenticate：{config?.authenticate_url?.trim() || '按 Base URL 自动拼接'}</span>
                <span className={s.valueMeta}>TokenValid：{config?.token_valid_url?.trim() || '按 Base URL 自动拼接'}</span>
                <span className={s.valueMeta}>UserAttributes：{config?.user_attributes_url?.trim() || '按 Base URL 自动拼接'}</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>URL tokenId 参数</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.rest_token_id_param || 'tokenId'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>超时与校验</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>
                  {config?.http_timeout_seconds ?? 10}s · 校验间隔 {config?.token_check_interval_seconds ?? 300}s · TLS {config?.verify_tls ? '开启' : '关闭（测试）'}
                </span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>密钥状态</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>login_sync_hmac_secret {config?.has_login_sync_hmac_secret ? '已配置' : '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          {missing.length ? (
            <tr>
              <td>缺失项</td>
              <td><div className={s.valueStack}><span className={s.valueTitle} style={{ color: '#b45309' }}>{missing.join('、')}</span></div></td>
              <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>编辑</button></div></td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

function RestAuthEditorDialog({
  open,
  draft,
  saving,
  error,
  config,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: RestAuthDraft;
  saving: boolean;
  error: string;
  config: RestAuthRuntimeConfig | null;
  onClose: () => void;
  onChange: (patch: Partial<RestAuthDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑统一认证 REST 配置</h3>
            <p className={s.modalNote}>REST AppId 与 Base URL 在 IAM 平台单独注册；接口路径留空时由后端按 base/idp/restful/* 拼接。login_sync_hmac_secret 可留空，自动沿用环境变量配置。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={`${s.modalScrollBody} ${s.qaTemplateScrollBody}`}>
          <form
            className={`${s.formGrid} ${s.qaTemplateFormGrid}`}
            autoComplete="off"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className={s.formField}>
              <span className={s.formLabel}>启用 REST 登录</span>
              <select className={s.formInput} value={draft.enabled ? '1' : '0'} onChange={(event) => onChange({ enabled: event.target.value === '1' })}>
                <option value="0">未启用</option>
                <option value="1">启用</option>
              </select>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.formLabel}>REST Base URL</span>
              <input className={s.formInput} value={draft.rest_base_url} placeholder="https://gfsso.shougang.com.cn" autoComplete="off" onChange={(event) => onChange({ rest_base_url: event.target.value })} />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>REST AppId</span>
              <input className={s.formInput} value={draft.rest_app_id} placeholder="restful" autoComplete="off" onChange={(event) => onChange({ rest_app_id: event.target.value })} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.formLabel}>authenticate_url</span>
              <input className={s.formInput} value={draft.authenticate_url} placeholder="留空自动拼接" autoComplete="off" onChange={(event) => onChange({ authenticate_url: event.target.value })} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.formLabel}>token_valid_url</span>
              <input className={s.formInput} value={draft.token_valid_url} placeholder="留空自动拼接" autoComplete="off" onChange={(event) => onChange({ token_valid_url: event.target.value })} />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.formLabel}>user_attributes_url</span>
              <input
                className={s.formInput}
                value={draft.user_attributes_url}
                placeholder="留空自动拼接（推荐）"
                autoComplete="off"
                name="rest-user-attributes-url"
                onChange={(event) => onChange({ user_attributes_url: event.target.value })}
              />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>URL tokenId 参数名</span>
              <input className={s.formInput} value={draft.rest_token_id_param} placeholder="tokenId" autoComplete="off" onChange={(event) => onChange({ rest_token_id_param: event.target.value })} />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>HTTP 超时（秒）</span>
              <input className={s.formInput} value={draft.http_timeout_seconds} autoComplete="off" onChange={(event) => onChange({ http_timeout_seconds: event.target.value })} />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>Token 校验间隔（秒）</span>
              <input className={s.formInput} value={draft.token_check_interval_seconds} autoComplete="off" onChange={(event) => onChange({ token_check_interval_seconds: event.target.value })} />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>校验 TLS 证书</span>
              <select className={s.formInput} value={draft.verify_tls ? '1' : '0'} onChange={(event) => onChange({ verify_tls: event.target.value === '1' })}>
                <option value="1">是</option>
                <option value="0">否（测试环境）</option>
              </select>
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.formLabel}>login_sync_hmac_secret</span>
              <input
                className={s.formInput}
                type="password"
                value={draft.login_sync_hmac_secret}
                placeholder={config?.has_login_sync_hmac_secret ? '留空沿用环境变量' : '留空则尝试沿用环境变量'}
                autoComplete="new-password"
                name="rest-login-sync-hmac-secret"
                onChange={(event) => onChange({ login_sync_hmac_secret: event.target.value })}
              />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>签名请求头</span>
              <input className={s.formInput} value={draft.login_sync_signature_header} autoComplete="off" onChange={(event) => onChange({ login_sync_signature_header: event.target.value })} />
            </label>
            <label className={s.formField}>
              <span className={s.formLabel}>BiSheng 查询失败策略</span>
              <select className={s.formInput} value={draft.bisheng_lookup_required ? '1' : '0'} onChange={(event) => onChange({ bisheng_lookup_required: event.target.value === '1' })}>
                <option value="0">默认走 IAM REST</option>
                <option value="1">直接报错</option>
              </select>
            </label>
          </form>
        </div>
        <div className={s.modalActions}>
          <button className={s.subtleBtn} onClick={onClose} disabled={saving}>取消</button>
          <button className={s.primaryBtn} onClick={onSubmit} disabled={saving}>{saving ? '保存中...' : '保存并验证'}</button>
        </div>
      </div>
    </div>
  );
}

export function RestAuthAdminSection({
  config,
  saving,
  onConfigChange,
  showToast,
}: {
  config: RestAuthRuntimeConfig | null;
  saving: boolean;
  onConfigChange: (config: RestAuthRuntimeConfig) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<RestAuthDraft>(createRestAuthDraft());
  const [formError, setFormError] = useState('');

  function openEditor() {
    setDraft(createRestAuthDraft(config ?? undefined));
    setFormError('');
    setEditorOpen(true);
  }

  return (
    <>
      <p className={s.pageNote}>
        启用 REST 后，门户登录走 /login 独立页面。本地用户（BiSheng source=local）仍走 BiSheng 密码，无需 IAM REST。
      </p>
      <RestAuthConfigTable config={config} saving={saving} onEdit={openEditor} />
      <RestAuthEditorDialog
        open={editorOpen}
        draft={draft}
        saving={saving}
        error={formError}
        config={config}
        onClose={() => setEditorOpen(false)}
        onChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }));
          setFormError('');
        }}
        onSubmit={() => {
          const result = validateRestAuthDraft(draft, config);
          if (!result.payload) {
            setFormError(result.error || 'REST 配置无效');
            return;
          }
          void updateRestAuthRuntimeConfig(result.payload)
            .then((updated) => {
              onConfigChange(updated);
              setEditorOpen(false);
              showToast('REST 配置已保存', 'success');
            })
            .catch((err) => {
              setFormError(err instanceof Error ? err.message : '保存失败');
            });
        }}
      />
    </>
  );
}
