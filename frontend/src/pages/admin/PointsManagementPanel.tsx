/**
 * Portal 运营后台 — 积分管理完整面板（概览 / 规则四 Tab / 用户与审计）。
 * 用户列表：直接调分（AC-02）+ R* 违规扣减（AC-17，Client 入口延后时的浏览器路径）。
 */

import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adjustUserPoints,
  deductUserPoints,
  fetchAdminPointAuditLogs,
  fetchAdminPointCopies,
  fetchAdminPointRules,
  fetchAdminPointUsers,
  fetchPointsOverview,
  saveAdminPointCopies,
  updatePointRule,
  type PointAdminUserItem,
  type PointAuditLogItem,
  type PointCopyItem,
  type PointOverview,
  type PointRuleDTO,
} from '../../api/points';
import SimpleRichTextEditor from '../../components/SimpleRichTextEditor';
import { normalizeQuestionDescriptionEditorHtml } from '../../utils/questionRichText';
import PointsAdjustModal from './PointsAdjustModal';
import PointsDeductModal from './PointsDeductModal';
import PointsRuleEditModal from './PointsRuleEditModal';
import PointsUsersAuditSection from './PointsUsersAuditSection';
import s from './PointsManagementPanel.module.css';
import {
  POINTS_GUIDE_COPY_KEY,
  POINTS_GUIDE_SAMPLE_HTML,
  resolvePointsGuideContent,
} from './pointsCopyGuide';
import {
  BENEFICIARY_LABEL,
  formatRuleOptionLabel,
  formatScoreCell,
  isTierRule,
  tiersFromScoreExpr,
  type PointTierDraft,
} from './pointsAdminUtils';

type RuleTab = 'earn' | 'deduct' | 'admin_reward' | 'copies';
type UserTab = 'users' | 'audit';

const RULE_TABS: { key: RuleTab; label: string }[] = [
  { key: 'earn', label: '积分获取规则' },
  { key: 'deduct', label: '积分扣减规则' },
  { key: 'admin_reward', label: '管理员奖励' },
  { key: 'copies', label: '说明文案' },
];

/**
 * 积分管理面板：规则配置 + 用户积分管理。
 */
export default function PointsManagementPanel() {
  const [overview, setOverview] = useState<PointOverview | null>(null);
  const [rules, setRules] = useState<PointRuleDTO[]>([]);
  const [copies, setCopies] = useState<PointCopyItem[]>([]);
  /** Single rich-text guide body (copy_key = guide). */
  const [guideHtml, setGuideHtml] = useState(POINTS_GUIDE_SAMPLE_HTML);
  const [users, setUsers] = useState<PointAdminUserItem[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [audits, setAudits] = useState<PointAuditLogItem[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [ruleTab, setRuleTab] = useState<RuleTab>('earn');
  const [userTab, setUserTab] = useState<UserTab>('users');
  const [keyword, setKeyword] = useState('');
  const [userPage, setUserPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<PointRuleDTO | null>(null);
  const [editName, setEditName] = useState('');
  const [editScore, setEditScore] = useState('');
  const [editCap, setEditCap] = useState('');
  const [editTiers, setEditTiers] = useState<PointTierDraft[]>([]);
  const [editLifetimeCap, setEditLifetimeCap] = useState('');
  const [editBeneficiary, setEditBeneficiary] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<PointAdminUserItem | null>(null);
  const [adjustSign, setAdjustSign] = useState<'+' | '-'>('+');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustRemark, setAdjustRemark] = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [deductTarget, setDeductTarget] = useState<PointAdminUserItem | null>(null);
  const [deductRuleCode, setDeductRuleCode] = useState('');
  const [deductRemark, setDeductRemark] = useState('');
  const [deductError, setDeductError] = useState('');
  const loadCore = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ov, ruleList, copyList] = await Promise.all([
        fetchPointsOverview(),
        // 拉取全部规则：表格只展示 enabled；添加下拉需要含 disabled。
        fetchAdminPointRules(),
        fetchAdminPointCopies(),
      ]);
      setOverview(ov);
      setRules(ruleList || []);
      setCopies(copyList || []);
      setGuideHtml(resolvePointsGuideContent(copyList || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const page = await fetchAdminPointUsers({
        keyword: keyword.trim() || undefined,
        page: userPage,
        page_size: 20,
      });
      setUsers(page.data || []);
      setUserTotal(page.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户列表加载失败');
    }
  }, [keyword, userPage]);

  const loadAudits = useCallback(async () => {
    try {
      const page = await fetchAdminPointAuditLogs({ page: auditPage, page_size: 20 });
      setAudits(page.data || []);
      setAuditTotal(page.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作记录加载失败');
    }
  }, [auditPage]);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (userTab === 'users') void loadUsers();
    else void loadAudits();
  }, [userTab, loadUsers, loadAudits]);

  const filteredRules = useMemo(
    () => rules.filter((r) => r.rule_type === ruleTab && r.status === 'enabled'),
    [rules, ruleTab],
  );

  /** 当前 Tab 类型下全部规则（含已启用，供添加下拉置灰展示）。 */
  const addCandidates = useMemo(() => {
    if (ruleTab === 'copies') return [];
    return rules
      .filter((r) => r.rule_type === ruleTab)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.rule_code.localeCompare(b.rule_code));
  }, [rules, ruleTab]);

  const enabledDeductRules = useMemo(
    () => rules.filter((r) => r.rule_type === 'deduct' && r.status === 'enabled'),
    [rules],
  );

  // Close「新增规则」dropdown on outside click or tab switch.
  useEffect(() => {
    setAddMenuOpen(false);
  }, [ruleTab]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!addMenuRef.current?.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [addMenuOpen]);

  /**
   * 「新增规则」下拉选中：仅打开编辑弹窗，不调后端；保存后才启用并进入列表。
   */
  function handlePickAddRule(code: string) {
    if (!code) return;
    const picked = addCandidates.find((r) => r.rule_code === code);
    if (!picked || picked.status === 'enabled') return;
    setAddMenuOpen(false);
    setMsg('');
    setError('');
    openEdit(picked);
  }

  function openEdit(rule: PointRuleDTO) {
    setEditing(rule);
    setEditName(rule.name || '');
    const expr = rule.score_expr || {};
    if (isTierRule(rule)) {
      setEditTiers(tiersFromScoreExpr(expr));
      const life = Number(expr.lifetime_cap ?? 15);
      setEditLifetimeCap(String(Number.isFinite(life) ? Math.max(0, Math.trunc(life)) : 15));
      setEditScore('');
      setEditCap('');
    } else {
      const score = Number(expr.score ?? 0);
      setEditScore(String(Number.isFinite(score) ? Math.max(0, Math.trunc(score)) : 0));
      setEditCap(rule.daily_cap == null ? '' : String(Math.max(0, Math.trunc(rule.daily_cap))));
      setEditTiers([]);
      setEditLifetimeCap('');
    }
    setEditBeneficiary(rule.beneficiary || '');
    setEditRemark(rule.remark || '');
  }

  async function handleSaveEdit() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) {
      setError('请填写积分项名称');
      return;
    }
    if (name.length > 40) {
      setError('积分项名称最多 40 个字');
      return;
    }

    const tierMode = isTierRule(editing);
    let scoreExpr: Record<string, unknown>;
    let dailyCap: number | null;

    if (tierMode) {
      if (!editTiers.length) {
        setError('请至少配置一档阶梯');
        return;
      }
      for (let i = 0; i < editTiers.length; i += 1) {
        const row = editTiers[i];
        if (!/^\d+$/.test(row.threshold.trim()) || !/^\d+$/.test(row.score.trim())) {
          setError(`第 ${i + 1} 档阈值与分值须为非负整数`);
          return;
        }
      }
      if (!/^\d+$/.test(editLifetimeCap.trim())) {
        setError('终身上限须为非负整数');
        return;
      }
      const parsed = editTiers.map((row) => ({
        threshold: Number(row.threshold),
        score: Number(row.score),
      }));
      parsed.sort((a, b) => a.threshold - b.threshold);
      for (let i = 1; i < parsed.length; i += 1) {
        if (parsed[i].threshold <= parsed[i - 1].threshold) {
          setError('收藏人数阈值须随档位递增');
          return;
        }
        if (parsed[i].score < parsed[i - 1].score) {
          setError('档位奖励分值须随档位非递减');
          return;
        }
      }
      const lifetimeCap = Number(editLifetimeCap);
      const topScore = parsed[parsed.length - 1]?.score ?? 0;
      if (lifetimeCap < topScore) {
        setError('终身上限不得低于最高档奖励分');
        return;
      }
      // P3: lifetime_cap lives in score_expr; daily_cap stays null for tier rules.
      scoreExpr = { mode: 'tier', tiers: parsed, lifetime_cap: lifetimeCap };
      dailyCap = null;
    } else {
      if (!/^\d+$/.test(editScore.trim())) {
        setError('分值须为非负整数');
        return;
      }
      if (editCap.trim() !== '' && !/^\d+$/.test(editCap.trim())) {
        setError('每日上限须为非负整数或留空');
        return;
      }
      scoreExpr = { ...(editing.score_expr || {}), mode: 'fixed', score: Number(editScore) };
      dailyCap = editCap.trim() === '' ? null : Number(editCap);
    }

    // Add-from-dropdown starts with disabled; only persist + enable on Save.
    const enablingNew = editing.status !== 'enabled';
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const body: Parameters<typeof updatePointRule>[1] = {
        name,
        score_expr: scoreExpr,
        daily_cap: dailyCap,
        remark: editRemark.trim() || null,
      };
      if (editing.beneficiary_options?.length) {
        body.beneficiary = editBeneficiary || null;
      }
      if (enablingNew) {
        body.status = 'enabled';
      }
      await updatePointRule(editing.id, body);
      setMsg(enablingNew ? `已添加 ${editing.rule_code}` : `已保存 ${editing.rule_code}`);
      setEditing(null);
      await loadCore();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCopies() {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const content = normalizeQuestionDescriptionEditorHtml(guideHtml || '');
      // Backend replace-set: only `guide` remains in point_copy.
      const payload: PointCopyItem[] = [
        { copy_key: POINTS_GUIDE_COPY_KEY, content, sort_order: 1 },
      ];
      const saved = await saveAdminPointCopies(payload);
      setCopies(saved || payload);
      setGuideHtml(content || POINTS_GUIDE_SAMPLE_HTML);
      setMsg('说明文案已保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '文案保存失败');
    } finally {
      setBusy(false);
    }
  }

  /** 从用户列表打开直接调分弹窗。 */
  function openAdjust(user: PointAdminUserItem) {
    setAdjustTarget(user);
    setAdjustSign('+');
    setAdjustAmount('');
    setAdjustRemark('');
    setAdjustError('');
    setError('');
  }

  /** 提交直接调分（前缀按钮决定正负，不走 R*）。 */
  async function handleAdjust() {
    if (!adjustTarget) return;
    const uid = adjustTarget.user_id;
    const amount = Number(adjustAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setAdjustError('请输入正整数分值');
      return;
    }
    if (adjustRemark.trim().length < 5) {
      setAdjustError('调整原因至少 5 个字');
      return;
    }
    const d = adjustSign === '-' ? -amount : amount;
    setBusy(true);
    setMsg('');
    setAdjustError('');
    setError('');
    try {
      const log = await adjustUserPoints(uid, d, adjustRemark.trim());
      setMsg(
        `调分成功：${adjustTarget.user_name || uid} ${log.delta >= 0 ? '+' : ''}${log.delta}，余额 ${log.balance_after}`,
      );
      setAdjustTarget(null);
      await Promise.all([loadCore(), loadUsers(), loadAudits()]);
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : '调分失败');
    } finally {
      setBusy(false);
    }
  }

  /** 打开按 R* 规则扣减弹窗。 */
  function openDeduct(user: PointAdminUserItem) {
    setDeductTarget(user);
    setDeductRuleCode(enabledDeductRules[0]?.rule_code || '');
    setDeductRemark('');
    setDeductError('');
    setError('');
  }

  /** 提交 R* 违规扣减。 */
  async function handleDeduct() {
    if (!deductTarget) return;
    const code = deductRuleCode.trim().toUpperCase();
    if (!code) {
      setDeductError('请选择扣减规则');
      return;
    }
    setBusy(true);
    setMsg('');
    setDeductError('');
    setError('');
    try {
      const log = await deductUserPoints(
        deductTarget.user_id,
        code,
        deductRemark.trim() || undefined,
      );
      setMsg(
        `扣减成功：${deductTarget.user_name || deductTarget.user_id} ${log.delta}（${log.rule_code}），余额 ${log.balance_after}`,
      );
      setDeductTarget(null);
      await Promise.all([loadCore(), loadUsers(), loadAudits()]);
    } catch (err) {
      setDeductError(err instanceof Error ? err.message : '扣减失败');
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
        <button
          type="button"
          className={s.ghostBtn}
          onClick={() => {
            void loadCore();
            void loadUsers();
            void loadAudits();
          }}
          disabled={busy}
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {error ? <div className={s.err}>{error}</div> : null}
      {msg ? <div className={s.msg}>{msg}</div> : null}

      {overview ? (
        <div className={s.cards} aria-label="积分概览">
          <div className={s.card}>
            <div className={s.cardLabel}>平台总积分发放</div>
            <div className={s.cardValue}>{overview.total_issued}</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>当前有效可用总积分</div>
            <div className={s.cardValue}>{overview.total_balance}</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>违规扣减合计</div>
            <div className={`${s.cardValue} ${s.cardNeg}`}>
              {overview.total_violation_deducted === 0
                ? '0'
                : `-${Math.abs(overview.total_violation_deducted)}`}
            </div>
          </div>
        </div>
      ) : null}

      <div className={s.section}>
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>积分规则配置</h3>
          <div className={s.tabs} role="tablist" aria-label="规则类型">
            {RULE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={ruleTab === tab.key}
                className={`${s.tab} ${ruleTab === tab.key ? s.tabActive : ''}`}
                onClick={() => setRuleTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {ruleTab !== 'copies' ? (
            <div className={s.sectionActions} ref={addMenuRef}>
              <button
                type="button"
                className={s.addRuleBtn}
                disabled={busy || !addCandidates.length}
                aria-haspopup="listbox"
                aria-expanded={addMenuOpen}
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <Plus size={16} strokeWidth={2.5} aria-hidden />
                新增规则
              </button>
              {addMenuOpen ? (
                <ul className={s.addRuleMenu} role="listbox" aria-label="可选规则">
                  {addCandidates.map((rule) => {
                    const enabled = rule.status === 'enabled';
                    return (
                      <li key={rule.id} role="option" aria-disabled={enabled} aria-selected={false}>
                        <button
                          type="button"
                          className={`${s.addRuleMenuItem} ${enabled ? s.addRuleMenuItemDisabled : ''}`}
                          disabled={busy || enabled}
                          onClick={() => handlePickAddRule(rule.rule_code)}
                        >
                          {formatRuleOptionLabel(rule)}
                          {enabled ? '（已启用）' : ''}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        {ruleTab === 'copies' ? (
          <div className={s.copies}>
            <div className={s.copyField}>
              <SimpleRichTextEditor
                value={guideHtml}
                disabled={busy}
                aria-label="points guide"
                placeholder="Edit points guide…"
                onChange={setGuideHtml}
              />
            </div>
            <button type="button" className={s.primaryBtn} disabled={busy} onClick={() => void handleSaveCopies()}>
              保存文案
            </button>
          </div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>编号</th>
                <th>积分项</th>
                <th>{ruleTab === 'deduct' ? '扣减积分' : '奖励积分'}</th>
                <th>每日上限</th>
                <th>受益人</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.rule_code}</td>
                  <td>{rule.name}</td>
                  <td className={ruleTab === 'deduct' ? s.neg : s.pos}>
                    {formatScoreCell(rule, ruleTab === 'deduct')}
                  </td>
                  <td>{rule.daily_cap ?? '—'}</td>
                  <td>{BENEFICIARY_LABEL[rule.beneficiary || ''] || rule.beneficiary || '—'}</td>
                  <td>
                    <span className={rule.status === 'enabled' ? s.dotOn : s.dotOff}>
                      {rule.status === 'enabled' ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className={s.ops}>
                    <button type="button" className={s.linkBtn} disabled={busy} onClick={() => openEdit(rule)}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredRules.length ? (
                <tr>
                  <td colSpan={7}>暂无启用中的规则</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <PointsUsersAuditSection
        userTab={userTab}
        onUserTabChange={setUserTab}
        keyword={keyword}
        onKeywordChange={(v) => {
          setUserPage(1);
          setKeyword(v);
        }}
        users={users}
        userTotal={userTotal}
        userPage={userPage}
        onUserPageChange={setUserPage}
        audits={audits}
        auditTotal={auditTotal}
        auditPage={auditPage}
        onAuditPageChange={setAuditPage}
        onAdjustUser={openAdjust}
        onDeductUser={openDeduct}
      />

      {adjustTarget ? (
        <PointsAdjustModal
          userId={adjustTarget.user_id}
          userName={adjustTarget.user_name}
          balance={adjustTarget.balance}
          busy={busy}
          sign={adjustSign}
          amount={adjustAmount}
          remark={adjustRemark}
          error={adjustError}
          onSignChange={(v) => {
            setAdjustSign(v);
            setAdjustError('');
          }}
          onAmountChange={(v) => {
            setAdjustAmount(v);
            setAdjustError('');
          }}
          onRemarkChange={(v) => {
            setAdjustRemark(v);
            setAdjustError('');
          }}
          onCancel={() => setAdjustTarget(null)}
          onSubmit={() => void handleAdjust()}
        />
      ) : null}

      {deductTarget ? (
        <PointsDeductModal
          userId={deductTarget.user_id}
          userName={deductTarget.user_name}
          balance={deductTarget.balance}
          busy={busy}
          rules={enabledDeductRules}
          ruleCode={deductRuleCode}
          remark={deductRemark}
          error={deductError}
          onRuleCodeChange={(v) => {
            setDeductRuleCode(v);
            setDeductError('');
          }}
          onRemarkChange={(v) => {
            setDeductRemark(v);
            setDeductError('');
          }}
          onCancel={() => setDeductTarget(null)}
          onSubmit={() => void handleDeduct()}
        />
      ) : null}

      {editing ? (
        <PointsRuleEditModal
          rule={editing}
          busy={busy}
          name={editName}
          score={editScore}
          dailyCap={editCap}
          tiers={editTiers}
          lifetimeCap={editLifetimeCap}
          beneficiary={editBeneficiary}
          remark={editRemark}
          onNameChange={setEditName}
          onScoreChange={setEditScore}
          onDailyCapChange={setEditCap}
          onTiersChange={setEditTiers}
          onLifetimeCapChange={setEditLifetimeCap}
          onBeneficiaryChange={setEditBeneficiary}
          onRemarkChange={setEditRemark}
          onCancel={() => setEditing(null)}
          onSave={() => void handleSaveEdit()}
        />
      ) : null}

    </div>
  );
}
