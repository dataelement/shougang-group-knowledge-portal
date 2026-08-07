/**
 * Portal 运营后台 — 积分管理最小面板（概览 / 规则启停 / 调分）。
 * 权限：后端强制平台超管；前端仅在 Admin 入口展示。
 */

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  adjustUserPoints,
  fetchAdminPointRules,
  fetchPointsOverview,
  updatePointRuleStatus,
  type PointOverview,
  type PointRuleDTO,
} from '../../api/points';
import s from './PointsManagementPanel.module.css';

/**
 * 积分管理面板组件。
 * 支撑 G-M1：规则列表可见、可启停、可对用户调分。
 */
export default function PointsManagementPanel() {
  const [overview, setOverview] = useState<PointOverview | null>(null);
  const [rules, setRules] = useState<PointRuleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [userId, setUserId] = useState('');
  const [delta, setDelta] = useState('10');
  // Backend requires remark length 5–100; keep default compliant for G-M1 adjust.
  const [remark, setRemark] = useState('联调调分验证');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, ruleList] = await Promise.all([
        fetchPointsOverview(),
        fetchAdminPointRules(),
      ]);
      setOverview(ov);
      setRules(ruleList || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 切换规则启用状态。
   * @param rule 当前规则行
   */
  async function handleToggle(rule: PointRuleDTO) {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const next = rule.status === 'enabled' ? 'disabled' : 'enabled';
      await updatePointRuleStatus(rule.id, next);
      setMsg(`已将 ${rule.rule_code} 设为 ${next === 'enabled' ? '启用' : '禁用'}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }

  /** 提交手动调分 */
  async function handleAdjust() {
    const uid = Number(userId);
    const d = Number(delta);
    if (!Number.isInteger(uid) || uid <= 0) {
      setError('请填写有效用户 ID');
      return;
    }
    if (!Number.isInteger(d) || d === 0) {
      setError('调分 delta 须为非 0 整数');
      return;
    }
    if (!remark.trim() || remark.trim().length < 2) {
      setError('请填写调分原因');
      return;
    }
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const log = await adjustUserPoints(uid, d, remark.trim());
      setMsg(`调分成功：用户 ${uid} ${log.delta >= 0 ? '+' : ''}${log.delta}，余额 ${log.balance_after}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '调分失败');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className={s.loading}>
        <Loader2 size={18} className="spin" /> 加载积分数据…
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>积分管理</h2>
        <button type="button" className={s.ghostBtn} onClick={() => void load()} disabled={busy}>
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {error ? <div className={s.err}>{error}</div> : null}
      {msg ? <div className={s.msg}>{msg}</div> : null}

      {overview ? (
        <div className={s.cards}>
          <div className={s.card}>
            <div className={s.cardLabel}>总发放</div>
            <div className={s.cardValue}>{overview.total_issued}</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>当前余额合计</div>
            <div className={s.cardValue}>{overview.total_balance}</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>违规扣减合计</div>
            <div className={s.cardValue}>{overview.total_violation_deducted}</div>
          </div>
        </div>
      ) : null}

      <div className={s.section}>
        <h3 className={s.sectionTitle}>规则列表（启停）</h3>
        <table className={s.table}>
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>类型</th>
              <th>受益人</th>
              <th>日上限</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.rule_code}</td>
                <td>{rule.name}</td>
                <td>{rule.rule_type}</td>
                <td>{rule.beneficiary || '—'}</td>
                <td>{rule.daily_cap ?? '—'}</td>
                <td>{rule.status === 'enabled' ? '启用' : '禁用'}</td>
                <td>
                  <button
                    type="button"
                    className={s.ghostBtn}
                    disabled={busy}
                    onClick={() => void handleToggle(rule)}
                  >
                    {rule.status === 'enabled' ? '禁用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.section}>
        <h3 className={s.sectionTitle}>手动调分</h3>
        <div className={s.formRow}>
          <div className={s.field}>
            <label htmlFor="points-user-id">用户 ID</label>
            <input
              id="points-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="例如 4"
            />
          </div>
          <div className={s.field}>
            <label htmlFor="points-delta">变动分值</label>
            <input
              id="points-delta"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="可正可负"
            />
          </div>
          <div className={s.field} style={{ minWidth: 220 }}>
            <label htmlFor="points-remark">原因</label>
            <input
              id="points-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>
          <button type="button" className={s.primaryBtn} disabled={busy} onClick={() => void handleAdjust()}>
            提交调分
          </button>
        </div>
      </div>
    </div>
  );
}
