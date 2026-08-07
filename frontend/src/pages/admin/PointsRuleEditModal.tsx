/**
 * 积分规则编辑弹窗。
 * fixed：名称 / 分值 / 日 cap；tier（如 G3）：档位阈值·分值 + 终身上限（不用 daily_cap）。
 */

import type { KeyboardEvent } from 'react';
import type { PointRuleDTO } from '../../api/points';
import {
  BENEFICIARY_LABEL,
  isTierRule,
  type PointTierDraft,
} from './pointsAdminUtils';
import s from './PointsManagementPanel.module.css';

interface PointsRuleEditModalProps {
  rule: PointRuleDTO;
  busy: boolean;
  name: string;
  score: string;
  dailyCap: string;
  tiers: PointTierDraft[];
  lifetimeCap: string;
  beneficiary: string;
  remark: string;
  onNameChange: (v: string) => void;
  onScoreChange: (v: string) => void;
  onDailyCapChange: (v: string) => void;
  onTiersChange: (tiers: PointTierDraft[]) => void;
  onLifetimeCapChange: (v: string) => void;
  onBeneficiaryChange: (v: string) => void;
  onRemarkChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** 规则编辑对话框。 */
export default function PointsRuleEditModal({
  rule,
  busy,
  name,
  score,
  dailyCap,
  tiers,
  lifetimeCap,
  beneficiary,
  remark,
  onNameChange,
  onScoreChange,
  onDailyCapChange,
  onTiersChange,
  onLifetimeCapChange,
  onBeneficiaryChange,
  onRemarkChange,
  onCancel,
  onSave,
}: PointsRuleEditModalProps) {
  const tierMode = isTierRule(rule);

  function updateTier(index: number, field: keyof PointTierDraft, raw: string) {
    const next = tiers.map((row, i) =>
      i === index ? { ...row, [field]: digitsOnly(raw) } : row,
    );
    onTiersChange(next);
  }

  return (
    <div className={s.modalMask} role="dialog" aria-modal="true" aria-labelledby="rule-edit-title">
      <div className={`${s.modal} ${tierMode ? s.tierModal : ''}`}>
        <h3 id="rule-edit-title">编辑规则 {rule.rule_code}</h3>
        <label className={s.copyField}>
          <span>
            积分项名称 <em className={s.req}>*</em>
          </span>
          <input
            id="points-rule-name"
            value={name}
            maxLength={40}
            placeholder="请输入积分项名称"
            onChange={(e) => onNameChange(e.target.value)}
            disabled={busy}
          />
        </label>

        {tierMode ? (
          <>
            <div className={s.tierHint}>
              收藏人数达阈值时按档位补差发放；单文档终身累计不超过下方终身上限。取消收藏再达阈值不重复发放。
            </div>
            <div className={s.tierTableWrap}>
              <table className={s.tierTable}>
                <thead>
                  <tr>
                    <th>档位</th>
                    <th>收藏人数阈值</th>
                    <th>奖励积分</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((row, index) => (
                    <tr key={`tier-${index}`}>
                      <td>第 {index + 1} 档</td>
                      <td>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={row.threshold}
                          placeholder="人数"
                          disabled={busy}
                          onChange={(e) => updateTier(index, 'threshold', e.target.value)}
                          onKeyDown={blockNonDigitKeys}
                          aria-label={`第${index + 1}档收藏人数阈值`}
                        />
                      </td>
                      <td>
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={row.score}
                          placeholder="分值"
                          disabled={busy}
                          onChange={(e) => updateTier(index, 'score', e.target.value)}
                          onKeyDown={blockNonDigitKeys}
                          aria-label={`第${index + 1}档奖励积分`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className={s.copyField}>
              <span>
                终身上限（分） <em className={s.req}>*</em>
              </span>
              <input
                id="points-rule-lifetime-cap"
                inputMode="numeric"
                pattern="[0-9]*"
                value={lifetimeCap}
                placeholder="如 15"
                onChange={(e) => onLifetimeCapChange(digitsOnly(e.target.value))}
                onKeyDown={blockNonDigitKeys}
                disabled={busy}
              />
            </label>
          </>
        ) : (
          <>
            <label className={s.copyField}>
              <span>分值</span>
              <input
                id="points-rule-score"
                inputMode="numeric"
                pattern="[0-9]*"
                value={score}
                placeholder="请输入分值"
                onChange={(e) => onScoreChange(digitsOnly(e.target.value))}
                onKeyDown={blockNonDigitKeys}
                disabled={busy}
              />
            </label>
            <label className={s.copyField}>
              <span>每日上限（空=不限）</span>
              <input
                id="points-rule-daily-cap"
                inputMode="numeric"
                pattern="[0-9]*"
                value={dailyCap}
                placeholder="空表示不限"
                onChange={(e) => onDailyCapChange(digitsOnly(e.target.value))}
                onKeyDown={blockNonDigitKeys}
                disabled={busy}
              />
            </label>
          </>
        )}

        {rule.beneficiary_options?.length ? (
          <label className={s.copyField}>
            <span>积分受益主体</span>
            <select value={beneficiary} onChange={(e) => onBeneficiaryChange(e.target.value)} disabled={busy}>
              {rule.beneficiary_options.map((opt) => (
                <option key={opt} value={opt}>
                  {BENEFICIARY_LABEL[opt] || opt}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={s.copyField}>
          <span>备注</span>
          <input value={remark} onChange={(e) => onRemarkChange(e.target.value)} disabled={busy} />
        </label>
        <div className={s.modalActions}>
          <button type="button" className={s.ghostBtn} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={s.primaryBtn} disabled={busy} onClick={onSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keep only digits so score / daily cap cannot accept signs or decimals. */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Block + / - / e / decimal while typing in numeric fields. */
function blockNonDigitKeys(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === '+' || e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '.') {
    e.preventDefault();
  }
}
