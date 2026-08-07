/**
 * 管理端「调整用户积分」弹窗：对齐运营设计稿。
 * 加减由前缀按钮切换，分值输入只允许正整数。
 */

import { X } from 'lucide-react';
import s from './PointsManagementPanel.module.css';

export type AdjustSign = '+' | '-';

interface PointsAdjustModalProps {
  userId: number;
  userName: string;
  balance: number;
  busy: boolean;
  sign: AdjustSign;
  amount: string;
  remark: string;
  /** Inline validation / API error shown inside the dialog. */
  error: string;
  onSignChange: (v: AdjustSign) => void;
  onAmountChange: (v: string) => void;
  onRemarkChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 对指定用户提交手动调分。 */
export default function PointsAdjustModal({
  userId,
  userName,
  balance,
  busy,
  sign,
  amount,
  remark,
  error,
  onSignChange,
  onAmountChange,
  onRemarkChange,
  onCancel,
  onSubmit,
}: PointsAdjustModalProps) {
  return (
    <div className={s.modalMask} role="dialog" aria-modal="true" aria-labelledby="points-adjust-title">
      <div className={`${s.modal} ${s.adjustModal}`}>
        <div className={s.adjustModalHead}>
          <h3 id="points-adjust-title">调整用户积分</h3>
          <button
            type="button"
            className={s.modalClose}
            aria-label="关闭"
            onClick={onCancel}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <div className={s.adjustReadonlyRow}>
          <div className={s.adjustField}>
            <span>用户名</span>
            <input value={userName || `用户${userId}`} disabled readOnly />
          </div>
          <div className={s.adjustField}>
            <span>当前积分</span>
            <input value={formatBalance(balance)} disabled readOnly />
          </div>
        </div>

        <div className={s.adjustField}>
          <span>
            调整分值 <em className={s.req}>*</em>
          </span>
          <div className={s.adjustAmountRow}>
            <button
              type="button"
              id="points-adjust-sign"
              className={`${s.adjustSignBtn} ${sign === '-' ? s.adjustSignMinus : s.adjustSignPlus}`}
              aria-label={sign === '+' ? '当前加分，点击切换为扣减' : '当前扣减，点击切换为加分'}
              title={sign === '+' ? '加分（点击切换为扣减）' : '扣减（点击切换为加分）'}
              onClick={() => onSignChange(sign === '+' ? '-' : '+')}
              disabled={busy}
            >
              {sign}
            </button>
            <input
              id="points-adjust-delta"
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount}
              placeholder="请输入分值"
              onChange={(e) => onAmountChange(digitsOnly(e.target.value))}
              onKeyDown={(e) => {
                // Block + / - and other non-digit editing keys (keep navigation/edit keys).
                if (e.key === '+' || e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '.') {
                  e.preventDefault();
                }
              }}
              disabled={busy}
            />
          </div>
        </div>

        <div className={s.adjustField}>
          <span>
            调整原因 <em className={s.req}>*</em>
          </span>
          <textarea
            id="points-adjust-remark"
            value={remark}
            placeholder="请填写调整原因（至少 5 个字）"
            rows={4}
            onChange={(e) => onRemarkChange(e.target.value)}
            disabled={busy}
          />
        </div>

        {error ? (
          <div className={s.adjustError} role="alert">
            {error}
          </div>
        ) : null}

        <div className={s.modalActions}>
          <button type="button" className={s.outlineBtn} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={s.primaryBtn} disabled={busy} onClick={onSubmit}>
            确认调整
          </button>
        </div>
      </div>
    </div>
  );
}

/** Strip everything except digits so users cannot type sign or decimals. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** 当前积分千分位展示。 */
function formatBalance(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n ?? 0);
}
