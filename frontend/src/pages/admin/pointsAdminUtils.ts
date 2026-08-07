/**
 * 积分管理后台展示辅助（受益人文案、分值/时间格式、阶梯规则）。
 */

import type { PointRuleDTO } from '../../api/points';

export const BENEFICIARY_LABEL: Record<string, string> = {
  uploader: '上传人',
  publisher: '发布人',
  sharer: '分享人',
  answerer: '回答者',
  subject: '主体',
};

export type PointTierDraft = {
  threshold: string;
  score: string;
};

/** Dropdown label: G1：发布/上传到公共库 */
export function formatRuleOptionLabel(rule: PointRuleDTO): string {
  return `${rule.rule_code}：${rule.name}`;
}

/** Whether score_expr uses favorite-count tiers (e.g. G3). */
export function isTierScoreExpr(expr: Record<string, unknown> | null | undefined): boolean {
  return Boolean(expr && expr.mode === 'tier');
}

/** Tier editor for explicit tier mode or known G3 (even if score_expr was corrupted). */
export function isTierRule(rule: Pick<PointRuleDTO, 'rule_code' | 'score_expr'>): boolean {
  return rule.rule_code === 'G3' || isTierScoreExpr(rule.score_expr);
}

/**
 * Human-readable tier rule: 75人→+5；150人→+10；300人→+15，终身累计≤15
 */
export function formatTierDescription(expr: Record<string, unknown>): string {
  const tiers = Array.isArray(expr.tiers) ? [...expr.tiers] : [];
  tiers.sort((a, b) => Number((a as { threshold?: number }).threshold || 0) - Number((b as { threshold?: number }).threshold || 0));
  const parts = tiers.map((raw) => {
    const t = raw as { threshold?: number; score?: number };
    return `${t.threshold ?? '—'}人→+${t.score ?? '—'}`;
  });
  const cap =
    expr.lifetime_cap != null && expr.lifetime_cap !== ''
      ? `，终身累计≤${expr.lifetime_cap}`
      : '';
  if (!parts.length) return `阶梯奖励${cap}`;
  return `${parts.join('；')}${cap}`;
}

/** 规则分值单元格展示（固定分或完整阶梯说明）。 */
export function formatScoreCell(rule: PointRuleDTO, asDeduct: boolean): string {
  const expr = rule.score_expr || {};
  if (isTierRule(rule)) return formatTierDescription(expr);
  const score = Number(expr.score ?? 0);
  if (!Number.isFinite(score)) return '—';
  return asDeduct ? `-${Math.abs(score)}` : `+${score}`;
}

/** Parse tiers from score_expr into digit-string drafts for the editor. */
export function tiersFromScoreExpr(expr: Record<string, unknown> | null | undefined): PointTierDraft[] {
  const tiers = Array.isArray(expr?.tiers) ? [...expr!.tiers] : [];
  tiers.sort(
    (a, b) =>
      Number((a as { threshold?: number }).threshold || 0) -
      Number((b as { threshold?: number }).threshold || 0),
  );
  if (!tiers.length) {
    return [
      { threshold: '75', score: '5' },
      { threshold: '150', score: '10' },
      { threshold: '300', score: '15' },
    ];
  }
  return tiers.map((raw) => {
    const t = raw as { threshold?: number; score?: number };
    return {
      threshold: String(Math.max(0, Math.trunc(Number(t.threshold) || 0))),
      score: String(Math.max(0, Math.trunc(Number(t.score) || 0))),
    };
  });
}

/** 审计时间格式化。 */
export function formatAuditTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
