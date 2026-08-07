/**
 * 管理端「违规扣减」弹窗：按启用中的 R* 规则扣分（AC-17 / G-M4）。
 * Client 文档页入口（T025）延后时，本弹窗作为浏览器扣减路径。
 */

import { X } from 'lucide-react';
import type { PointRuleDTO } from '../../api/points';
import { formatScoreCell } from './pointsAdminUtils';
import s from './PointsManagementPanel.module.css';

interface PointsDeductModalProps {
  userId: number;
  userName: string;
  balance: number;
  busy: boolean;
  rules: PointRuleDTO[];
  ruleCode: string;
  remark: string;
  error: string;
  onRuleCodeChange: (v: string) => void;
  onRemarkChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 对指定用户按 R* 规则提交扣减。 */
export default function PointsDeductModal({
  userId,
  userName,
  balance,
  busy,
  rules,
  ruleCode,
  remark,
  error,
  onRuleCodeChange,
  onRemarkChange,
  onCancel,
  onSubmit,
}: PointsDeductModalProps) {
  return (
    <div className={s.modalMask} role="dialog" aria-modal="true" aria-labelledby="points-deduct-title">
      <div className={`${s.modal} ${s.adjustModal}`}>
        <div className={s.adjustModalHead}>
          <h3 id="points-deduct-title">违规扣减</h3>
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
            扣减规则 <em className={s.req}>*</em>
          </span>
          <select
            id="points-deduct-rule"
            value={ruleCode}
            onChange={(e) => onRuleCodeChange(e.target.value)}
            disabled={busy || !rules.length}
          >
            <option value="">请选择启用中的 R* 规则</option>
            {rules.map((r) => (
              <option key={r.id} value={r.rule_code}>
                {r.rule_code} · {r.name}（{formatScoreCell(r, true)}）
              </option>
            ))}
          </select>
        </div>

        <div className={s.adjustField}>
          <span>扣减原因</span>
          <textarea
            id="points-deduct-remark"
            value={remark}
            placeholder="选填，将写入流水与站内信"
            rows={3}
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
            确认扣减
          </button>
        </div>
      </div>
    </div>
  );
}

/** 当前积分千分位展示。 */
function formatBalance(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n ?? 0);
}
