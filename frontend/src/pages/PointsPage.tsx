/**
 * 我的积分页 — 按运营设计稿：摘要英雄区 + 明细表 + 规则弹窗。
 */

import {
  Award,
  BarChart3,
  ClipboardList,
  Loader2,
  TrendingDown,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import PageShell from '../components/PageShell';
import {
  fetchMyPointsLogs,
  fetchMyPointsSummary,
  fetchPublicPointRules,
  type PointLogItem,
  type PointPublicRules,
  type PointSummary,
} from '../api/points';
import {
  POINTS_GUIDE_COPY_KEY,
  resolvePointsGuideContent,
} from './admin/pointsCopyGuide';
import { formatTierDescription, isTierScoreExpr } from './admin/pointsAdminUtils';
import { toQuestionDescriptionRenderModel } from '../utils/questionRichText';
import s from './PointsPage.module.css';

type DirectionFilter = 'all' | 'earn' | 'deduct';

/**
 * Portal「我的积分」页面。
 * 数据来自 BiSheng `/api/v1/points/me/*` 与 `/rules/public`。
 */
export default function PointsPage() {
  const [summary, setSummary] = useState<PointSummary | null>(null);
  const [logs, setLogs] = useState<PointLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<PointPublicRules | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sum, pageData] = await Promise.all([
        fetchMyPointsSummary(),
        fetchMyPointsLogs({
          page,
          page_size: pageSize,
          direction,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
        }),
      ]);
      setSummary(sum);
      setLogs(pageData.data || []);
      setTotal(pageData.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, direction, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 打开积分规则弹窗并懒加载公开规则。
   */
  async function handleOpenRules() {
    setRulesOpen(true);
    if (rules) return;
    setRulesLoading(true);
    try {
      setRules(await fetchPublicPointRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : '规则加载失败');
    } finally {
      setRulesLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const deptRank = summary?.dept_rank;
  const globalDisplay = summary?.global_rank_display || '—';
  const earnRules = (rules?.earn_rules || []).filter((r) => !/^M\d+/i.test(r.rule_code || ''));
  const deductRules = (rules?.deduct_rules || []).filter((r) => !/^M\d+/i.test(r.rule_code || ''));

  return (
    <PageShell>
      <div className={s.page}>
        {error ? <div className={s.error}>{error}</div> : null}

        <section className={s.hero} aria-label="积分摘要">
          <button type="button" className={s.rulesBtn} onClick={() => void handleOpenRules()}>
            <ClipboardList size={15} aria-hidden />
            积分规则
          </button>

          <div className={s.balanceRow}>
            <div className={s.medal} aria-hidden>
              <Award size={28} strokeWidth={2.2} />
            </div>
            <div className={s.balanceMeta}>
              <p className={s.balanceLabel}>我的积分</p>
              <p className={s.balanceValue}>
                {loading && !summary ? '…' : (summary?.balance ?? 0)}
              </p>
            </div>
          </div>

          <div className={s.statGrid}>
            <article className={s.statCard}>
              <div className={s.statIcon}>
                <BarChart3 size={20} />
              </div>
              <div className={s.statBody}>
                <p className={s.statLabel}>本月获得</p>
                <p className={`${s.statValue} ${s.statEarn}`}>
                  +{summary?.month_earned ?? 0}
                </p>
              </div>
            </article>
            <article className={s.statCard}>
              <div className={s.statIcon}>
                <TrendingDown size={20} />
              </div>
              <div className={s.statBody}>
                <p className={s.statLabel}>本月减扣</p>
                <p className={`${s.statValue} ${s.statDeduct}`}>
                  -{summary?.month_deducted ?? 0}
                </p>
              </div>
            </article>
            <article className={s.statCard}>
              <div className={s.statIcon}>
                <Trophy size={20} />
              </div>
              <div className={s.statBody}>
                <p className={s.statLabel}>排名</p>
                <div className={s.rankRow}>
                  <span className={s.rankItem}>
                    部门{' '}
                    {deptRank == null ? (
                      <span className={s.rankMuted}>—</span>
                    ) : (
                      `#${deptRank}`
                    )}
                  </span>
                  <span className={s.rankItem}>
                    总榜{' '}
                    {formatGlobalRankDisplay(globalDisplay)}
                  </span>
                </div>
                <p className={s.rankRefreshed}>
                  排名更新于 {formatRankRefreshedAt(summary?.rank_refreshed_at)}
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className={s.panel} aria-label="积分明细">
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>积分明细</h2>
            <div className={s.filters}>
              <label className={s.filterField}>
                类型
                <select
                  value={direction}
                  onChange={(e) => {
                    setPage(1);
                    setDirection(e.target.value as DirectionFilter);
                  }}
                >
                  <option value="all">全部</option>
                  <option value="earn">已获得</option>
                  <option value="deduct">已扣减</option>
                </select>
              </label>
              <label className={s.filterField}>
                时间
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setPage(1);
                    setFromDate(e.target.value);
                  }}
                />
                <span className={s.dateSep}>-</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setPage(1);
                    setToDate(e.target.value);
                  }}
                />
              </label>
            </div>
          </div>

          {loading && logs.length === 0 ? (
            <div className={s.loading}>
              <Loader2 size={18} className="spin" /> 加载中…
            </div>
          ) : logs.length === 0 ? (
            <div className={s.empty} role="status">
              暂无积分明细，去上传文档或参与互动赚取积分吧
            </div>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>积分项</th>
                    <th>积分变动</th>
                    <th>余额</th>
                    <th>时间</th>
                    <th>类型</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => {
                    const earned = row.delta >= 0;
                    return (
                      <tr key={row.id}>
                        <td>{row.title}</td>
                        <td className={earned ? s.earn : s.deduct}>
                          {earned ? `+${row.delta}` : row.delta}
                        </td>
                        <td>{row.balance_after}</td>
                        <td>{formatTime(row.occurred_at)}</td>
                        <td>
                          <span className={s.typeCell}>
                            <span
                              className={`${s.dot} ${earned ? s.dotEarn : s.dotDeduct}`}
                            />
                            {earned ? '已获得' : '已扣减'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className={s.pager}>
            <div className={s.pagerMeta}>
              共 {total} 条明细，当前第 {page} 页
            </div>
            <div className={s.pagerBtns}>
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </button>
              <span className={s.pageNum}>{page}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </section>

        {rulesOpen ? (
          <div
            className={s.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="points-rules-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setRulesOpen(false);
            }}
          >
            <div className={s.modal}>
              <div className={s.modalHead}>
                <h2 id="points-rules-title" className={s.modalTitle}>
                  积分规则
                </h2>
                <button
                  type="button"
                  className={s.modalClose}
                  aria-label="关闭"
                  onClick={() => setRulesOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>
              {rulesLoading ? (
                <div className={s.loading}>加载规则…</div>
              ) : (
                <>
                  <div className={s.modalSection}>
                    <h3>获得积分</h3>
                    <ul className={s.ruleList}>
                      {earnRules.map((r) => (
                        <li key={r.id}>
                          <span className={s.ruleName}>{r.name}</span>
                          <span className={s.ruleScore}>{formatScoreExpr(r.score_expr)}</span>
                        </li>
                      ))}
                      {!earnRules.length ? <li>暂无启用中的获得规则</li> : null}
                    </ul>
                  </div>
                  <div className={s.modalSection}>
                    <h3>扣减积分</h3>
                    <ul className={s.ruleList}>
                      {deductRules.map((r) => (
                        <li key={r.id}>
                          <span className={s.ruleName}>{r.name}</span>
                          <span className={s.ruleScore}>{formatScoreExpr(r.score_expr, true)}</span>
                        </li>
                      ))}
                      {!deductRules.length ? <li>暂无启用中的扣减规则</li> : null}
                    </ul>
                  </div>
                  <PointsRulesCopyBlocks copies={rules?.copies || []} />
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}

/** Renders the single `guide` rich-text block (legacy multi-key fallback). */
function PointsRulesCopyBlocks({
  copies,
}: {
  copies: { copy_key: string; content: string }[];
}) {
  const hasGuide = copies.some((c) => c.copy_key === POINTS_GUIDE_COPY_KEY && c.content?.trim());
  const hasLegacy = copies.some(
    (c) => c.copy_key !== POINTS_GUIDE_COPY_KEY && c.content?.trim(),
  );

  if (hasGuide || !hasLegacy) {
    const model = toQuestionDescriptionRenderModel(resolvePointsGuideContent(copies));
    if (model.kind === 'html') {
      return <div className={s.copyBlock} dangerouslySetInnerHTML={{ __html: model.html }} />;
    }
    return (
      <div className={s.copyBlock}>
        {model.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    );
  }

  return (
    <>
      {copies
        .filter((c) => c.content?.trim())
        .map((c) => {
          const model = toQuestionDescriptionRenderModel(c.content);
          if (model.kind === 'html') {
            return (
              <div
                key={c.copy_key}
                className={s.copyBlock}
                dangerouslySetInnerHTML={{ __html: model.html }}
              />
            );
          }
          return (
            <div key={c.copy_key} className={s.copyBlock}>
              {model.paragraphs.map((p) => (
                <p key={`${c.copy_key}-${p}`}>{p}</p>
              ))}
            </div>
          );
        })}
    </>
  );
}

/**
 * 格式化发生时间（设计稿：YYYY/MM/DD HH:mm:ss）。
 * @param value ISO 或后端日期字符串
 */
function formatTime(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 总榜展示：后端已给 `999+` / `-` / 名次数字，避免再拼成 `#999+`。
 * @param display `global_rank_display`
 */
function formatGlobalRankDisplay(display: string): ReactNode {
  if (!display || display === '-' || display === '—') {
    return <span className={s.rankMuted}>—</span>;
  }
  if (display === '999+' || display.startsWith('#')) {
    return display;
  }
  return `#${display}`;
}

/**
 * 排名快照刷新时间（AC-14）；无值时展示 —。
 * @param value ISO 或后端日期字符串
 */
function formatRankRefreshedAt(value: string | null | undefined): string {
  if (!value) return '—';
  return formatTime(value);
}

/**
 * 将 score_expr 收成简短展示文案。
 * @param expr 规则分值表达式
 * @param asDeduct 扣减规则时加负号
 */
function formatScoreExpr(expr: Record<string, unknown>, asDeduct = false): string {
  if (!expr || typeof expr !== 'object') return '—';
  if (isTierScoreExpr(expr)) return formatTierDescription(expr);
  const score = Number(expr.score ?? 0);
  if (!Number.isFinite(score)) return '—';
  return asDeduct ? `-${Math.abs(score)}` : `+${score}`;
}
