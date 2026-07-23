import { useMemo, useState } from 'react';
import { Download, FileLock2, Loader2 } from 'lucide-react';
import type {
  DepartmentFileViewAccess,
} from '../api/content';
import s from './DepartmentFileAccessGate.module.css';

const STATUS_COPY: Record<
  DepartmentFileViewAccess['status'],
  { title: string; description: string }
> = {
  allowed: {
    title: '已获得查看权限',
    description: '正在加载文档内容。',
  },
  approval_required: {
    title: '查看此部门文件需要审批',
    description: '提交申请后，由文件所属部门的管理员审批。',
  },
  pending: {
    title: '查看申请审批中',
    description: '审批通过后即可查看文档详情和正文。',
  },
  rejected: {
    title: '上次查看申请未通过',
    description: '你可以补充新的申请原因后重新提交。',
  },
  withdrawn: {
    title: '上次查看申请已撤回',
    description: '如仍需查看，可重新提交申请。',
  },
  scenario_disabled: {
    title: '暂时无法提交查看申请',
    description: '部门文件查看审批当前已停用，请联系管理员。',
  },
  approver_unavailable: {
    title: '暂时找不到可审批人员',
    description: '请联系部门或系统管理员完成审批人配置。',
  },
  invalid_binding: {
    title: '文件归属配置异常',
    description: '当前文件无法申请查看，请联系管理员核对部门库绑定。',
  },
};

function metadataText(
  metadata: Record<string, unknown>,
  key: string,
): string {
  const value = metadata[key];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

export default function DepartmentFileAccessGate({
  access,
  applying,
  error,
  onApply,
  onOpenRequests,
  onDownload,
}: {
  access: DepartmentFileViewAccess;
  applying: boolean;
  error: string;
  onApply: (reason: string) => Promise<void> | void;
  onOpenRequests: () => void;
  onDownload?: () => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const copy = STATUS_COPY[access.status];
  const fileName = metadataText(access.safeMetadata, 'file_name') || `文件 ${access.fileId}`;
  const spaceName = metadataText(access.safeMetadata, 'space_name');
  const folderPath = metadataText(access.safeMetadata, 'folder_path');
  const canApply = ['approval_required', 'rejected', 'withdrawn'].includes(
    access.status,
  );
  const normalizedReason = reason.trim();
  const remaining = useMemo(() => 2000 - reason.length, [reason.length]);

  const submit = () => {
    if (!normalizedReason) {
      setValidationError('请填写申请原因');
      return;
    }
    if (normalizedReason.length > 2000) {
      setValidationError('申请原因不能超过2000个字符');
      return;
    }
    setValidationError('');
    void onApply(normalizedReason);
  };

  return (
    <section className={s.gate} aria-live="polite">
      <div className={s.icon}><FileLock2 size={28} /></div>
      <h1>{copy.title}</h1>
      <p className={s.description}>{copy.description}</p>
      <dl className={s.metadata}>
        <div><dt>文件</dt><dd>{fileName}</dd></div>
        {spaceName ? <div><dt>知识库</dt><dd>{spaceName}</dd></div> : null}
        {folderPath ? <div><dt>所在目录</dt><dd>{folderPath}</dd></div> : null}
      </dl>

      {canApply ? (
        <div className={s.form}>
          <label htmlFor="department-file-view-reason">申请原因</label>
          <textarea
            id="department-file-view-reason"
            value={reason}
            maxLength={2000}
            placeholder="请说明查看该文件的业务用途"
            onChange={(event) => {
              setReason(event.target.value);
              if (validationError) setValidationError('');
            }}
          />
          <div className={s.counter}>{remaining} / 2000</div>
          {validationError || error ? (
            <p className={s.error} role="alert">{validationError || error}</p>
          ) : null}
          <button
            type="button"
            className={s.primary}
            disabled={applying}
            onClick={submit}
          >
            {applying ? <Loader2 size={16} className={s.spin} /> : null}
            {applying ? '正在提交' : '提交查看申请'}
          </button>
        </div>
      ) : error ? (
        <p className={s.error} role="alert">{error}</p>
      ) : null}

      <div className={s.actions}>
        {access.instanceId ? (
          <button type="button" className={s.secondary} onClick={onOpenRequests}>
            打开我的申请
          </button>
        ) : null}
        {access.canDownload && onDownload ? (
          <button
            type="button"
            className={s.secondary}
            onClick={() => void onDownload()}
          >
            <Download size={16} />
            下载文件
          </button>
        ) : null}
      </div>
    </section>
  );
}
