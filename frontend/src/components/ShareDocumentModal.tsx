import { Check, Clipboard, Eye, Loader2, Lock, X } from 'lucide-react';
import type {
  FileItem,
  ShareDocumentResult,
  ShareDocumentType,
  ShareDocumentVisibility,
} from '../api/content';
import s from './ShareDocumentModal.module.css';

interface Props {
  open: boolean;
  file: FileItem | null;
  shareType: ShareDocumentType;
  visibility: ShareDocumentVisibility;
  allowDownload: boolean;
  passwordEnabled: boolean;
  password: string;
  expireSeconds: number;
  creating: boolean;
  error: string;
  result: ShareDocumentResult | null;
  shareUrl: string;
  onShareTypeChange: (value: ShareDocumentType) => void;
  onVisibilityChange: (value: ShareDocumentVisibility) => void;
  onAllowDownloadChange: (value: boolean) => void;
  onPasswordEnabledChange: (value: boolean) => void;
  onPasswordChange: (value: string) => void;
  onExpireSecondsChange: (value: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const EXPIRE_OPTIONS = [
  { value: 0, label: '永久有效' },
  { value: 24 * 60 * 60, label: '1 天' },
  { value: 7 * 24 * 60 * 60, label: '7 天' },
  { value: 30 * 24 * 60 * 60, label: '30 天' },
];

function RadioRow({
  checked,
  title,
  desc,
  onClick,
}: {
  checked: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={s.radioRow} onClick={onClick}>
      <span className={`${s.radio} ${checked ? s.radioChecked : ''}`}>{checked ? <Check size={14} /> : null}</span>
      <span className={s.radioText}>
        <span className={s.radioTitle}>{title}</span>
        <span className={s.radioDesc}>{desc}</span>
      </span>
    </button>
  );
}

export default function ShareDocumentModal({
  open,
  file,
  shareType,
  visibility,
  allowDownload,
  passwordEnabled,
  password,
  expireSeconds,
  creating,
  error,
  result,
  shareUrl,
  onShareTypeChange,
  onVisibilityChange,
  onAllowDownloadChange,
  onPasswordEnabledChange,
  onPasswordChange,
  onExpireSecondsChange,
  onClose,
  onConfirm,
}: Props) {
  if (!open || !file) return null;

  const copyShareUrl = () => {
    if (!shareUrl) return;
    void navigator.clipboard?.writeText(shareUrl);
  };

  const copyInviteCode = () => {
    if (!result?.inviteCode) return;
    void navigator.clipboard?.writeText(result.inviteCode);
  };

  return (
    <div className={s.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-document-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={s.closeButton} aria-label="关闭" onClick={onClose}>
          <X size={24} />
        </button>

        <header className={s.header}>
          <h2 id="share-document-title" className={s.title}>分享设置</h2>
          <p className={s.subtitle}>文档：{file.title}</p>
        </header>

        <div className={s.section}>
          <div className={s.sectionTitle}>分享类型</div>
          <RadioRow
            checked={shareType === 'link'}
            title="链接分享"
            desc="生成唯一 URL，可设置密码和有效期"
            onClick={() => onShareTypeChange('link')}
          />
          <RadioRow
            checked={shareType === 'invite_code'}
            title="邀请码"
            desc="生成 6 位邀请码，输入后获得访问权限"
            onClick={() => onShareTypeChange('invite_code')}
          />
        </div>

        <div className={s.section}>
          <div className={s.sectionTitle}>可见范围</div>
          <div className={s.scopeBox}>
            <RadioRow
              checked={visibility === 'department'}
              title="仅本部门"
              desc="登录用户部门与文档所属部门一致后可访问"
              onClick={() => onVisibilityChange('department')}
            />
            <RadioRow
              checked={visibility === 'public'}
              title="公开"
              desc="通过访问控制后可查看，不走审批"
              onClick={() => onVisibilityChange('public')}
            />
          </div>
        </div>

        <div className={s.section}>
          <div className={s.sectionTitle}>权限设置</div>
          <label className={s.checkRow}>
            <input type="checkbox" checked readOnly />
            <Eye size={18} />
            <span>仅查看（浏览文档）</span>
          </label>
          <label className={s.checkRow}>
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(event) => onAllowDownloadChange(event.target.checked)}
            />
            <span>允许下载</span>
          </label>
          <label className={`${s.checkRow} ${s.disabledRow}`}>
            <input type="checkbox" disabled />
            <span>允许上传（仅文件夹）</span>
          </label>
        </div>

        <div className={s.section}>
          <div className={s.sectionTitle}>访问控制</div>
          <label className={s.checkRow}>
            <input
              type="checkbox"
              checked={passwordEnabled}
              onChange={(event) => onPasswordEnabledChange(event.target.checked)}
            />
            <Lock size={18} />
            <span>设置密码</span>
          </label>
          {passwordEnabled ? (
            <input
              className={s.input}
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="输入访问密码"
            />
          ) : null}
          <select
            className={s.select}
            value={expireSeconds}
            onChange={(event) => onExpireSecondsChange(Number(event.target.value))}
          >
            {EXPIRE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>

        {result ? (
          <div className={s.resultBox}>
            <div className={s.resultLabel}>分享链接</div>
            <div className={s.copyLine}>
              <input className={s.copyInput} readOnly value={shareUrl} />
              <button type="button" className={s.copyButton} onClick={copyShareUrl} aria-label="复制分享链接">
                <Clipboard size={18} />
              </button>
            </div>
            {result.inviteCode ? (
              <>
                <div className={s.resultLabel}>邀请码</div>
                <div className={s.copyLine}>
                  <input className={s.copyInput} readOnly value={result.inviteCode} />
                  <button type="button" className={s.copyButton} onClick={copyInviteCode} aria-label="复制邀请码">
                    <Clipboard size={18} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {error ? <div className={s.errorText}>{error}</div> : null}

        <footer className={s.footer}>
          <button type="button" className={s.cancelButton} onClick={onClose} disabled={creating}>取消</button>
          <button type="button" className={s.confirmButton} onClick={onConfirm} disabled={creating}>
            {creating ? <Loader2 size={18} className={s.spin} /> : null}
            {result ? '重新生成' : '生成链接'}
          </button>
        </footer>
      </section>
    </div>
  );
}
