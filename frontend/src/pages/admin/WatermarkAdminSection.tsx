import { useState } from 'react';

import type { WatermarkConfig } from '../../api/adminConfig';
import {
  createWatermarkDraft,
  DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT,
  resolvePortalWatermarkHorizontalText,
  validateWatermarkDraft,
  type WatermarkDraft,
} from '../../utils/adminWatermarkConfig';
import s from '../AdminPage.module.css';

function WatermarkConfigTable({
  watermark,
  saving,
  onEdit,
}: {
  watermark?: WatermarkConfig;
  saving: boolean;
  onEdit: () => void;
}) {
  const configuredText = watermark?.horizontal_text?.trim() ?? '';
  const effectiveText = resolvePortalWatermarkHorizontalText(configuredText);
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>水印设置</h2>
      </div>
      <p className={s.pageNote}>
        配置预览、聊天界面与 PDF 下载水印的第二行水平平铺文案。第一行始终为「部门-姓名-账号-日期」，按当前登录用户动态生成，不可配置。
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
            <td>水印水平文本</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{effectiveText}</span>
                <span className={s.valueMeta}>
                  {configuredText
                    ? '已配置自定义文案'
                    : `未配置，当前使用默认文案：${DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT}`}
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEdit} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function WatermarkEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: WatermarkDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<WatermarkDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑水印水平文本</h3>
            <p className={s.modalNote}>
              留空并保存将回退为默认文案。建议不超过 80 个字符，且不要包含换行。
            </p>
          </div>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.formLabel}>水印第二行文案</span>
            <input
              className={s.textInput}
              value={draft.horizontalText}
              placeholder={DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT}
              maxLength={80}
              onChange={(event) => onChange({ horizontalText: event.target.value })}
            />
            <span className={s.formHint}>
              当前生效预览：{resolvePortalWatermarkHorizontalText(draft.horizontalText)}
            </span>
          </label>
        </div>
        {error ? <p className={s.formError}>{error}</p> : null}
        <div className={s.modalActions}>
          <button type="button" className={s.subtleBtn} onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="button" className={s.primaryBtn} onClick={onSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WatermarkAdminSection({
  watermark,
  saving,
  onSave,
}: {
  watermark?: WatermarkConfig;
  saving: boolean;
  onSave: (watermark: WatermarkConfig) => Promise<void>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<WatermarkDraft>(() => createWatermarkDraft(watermark));
  const [dialogError, setDialogError] = useState('');

  return (
    <>
      <WatermarkConfigTable
        watermark={watermark}
        saving={saving}
        onEdit={() => {
          setDraft(createWatermarkDraft(watermark));
          setDialogError('');
          setDialogOpen(true);
        }}
      />
      <WatermarkEditorDialog
        open={dialogOpen}
        draft={draft}
        saving={saving}
        error={dialogError}
        onClose={() => setDialogOpen(false)}
        onChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }));
          setDialogError('');
        }}
        onSubmit={() => {
          const result = validateWatermarkDraft(draft);
          if (!result.watermark) {
            setDialogError(result.error || '水印配置无效');
            return;
          }
          void onSave(result.watermark)
            .then(() => setDialogOpen(false))
            .catch((error: unknown) => {
              setDialogError(error instanceof Error ? error.message : '保存失败');
            });
        }}
      />
    </>
  );
}
