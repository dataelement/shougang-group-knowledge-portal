/**
 * 首页积分榜面板：对齐运营设计稿（领奖台 + 4–10 表）。
 * TOP10；榜内当前用户可标「(我)」高亮，无置底粘性行（AC-15）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchPointsLeaderboard,
  type PointLeaderboardItem,
  type PointLeaderboardPeriod,
} from '../../api/points';
import { useAuth } from '../../hooks/useAuth';
import iconRank from '../../assets/icon-rank@2x.png';
import medalGold from '../../assets/medal-gold@2x.png';
import medalSilver from '../../assets/medal-silver@2x.png';
import medalBronze from '../../assets/medal-bronze@2x.png';
import s from '../HomePage.module.css';

const PERIOD_TABS: { key: PointLeaderboardPeriod; label: string }[] = [
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
  { key: 'all', label: '总榜' },
];

const MEDALS = [
  { rank: 1, medal: medalGold, tone: 'gold' as const },
  { rank: 2, medal: medalSilver, tone: 'silver' as const },
  { rank: 3, medal: medalBronze, tone: 'bronze' as const },
];

/**
 * 渲染首页右侧积分榜；数据来自小时快照 API。
 */
export default function PointsLeaderboardPanel() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PointLeaderboardPeriod>('month');
  const [items, setItems] = useState<PointLeaderboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPeriod: PointLeaderboardPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPointsLeaderboard(nextPeriod);
      setItems(Array.isArray(data.items) ? data.items.slice(0, 10) : []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : '积分榜加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const periodScoreLabel = useMemo(() => {
    if (period === 'year') return '本年积分';
    if (period === 'all') return '总积分';
    return '本月积分';
  }, [period]);

  const myUserId = useMemo(() => {
    const raw = user?.externalId?.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [user?.externalId]);

  const isMe = useCallback(
    (row: PointLeaderboardItem) => {
      if (myUserId != null && row.user_id === myUserId) return true;
      const name = user?.name?.trim();
      return !!name && name === (row.user_name || '').trim();
    },
    [myUserId, user?.name],
  );

  const podium = useMemo(() => {
    const top3 = items.filter((row) => row.rank >= 1 && row.rank <= 3);
    // 展示顺序：银、金、铜（第二、第一、第三）
    const order = [2, 1, 3];
    return order
      .map((rank) => {
        const row = top3.find((item) => item.rank === rank);
        const meta = MEDALS.find((m) => m.rank === rank);
        if (!row || !meta) return null;
        return { ...row, medal: meta.medal, tone: meta.tone };
      })
      .filter(Boolean) as Array<
      PointLeaderboardItem & { medal: string; tone: 'gold' | 'silver' | 'bronze' }
    >;
  }, [items]);

  const tableRows = useMemo(() => items.filter((row) => row.rank >= 4), [items]);
  // 有领奖台时表格只列 4–10；否则整表展示（人数不足 3 时）。
  const listRows = podium.length > 0 ? tableRows : items;

  return (
    <div className={`${s.panel} ${s.rankPanel}`}>
      <div className={`${s.panelHeader} ${s.headerRank}`}>
        <div className={s.panelHeaderLeft}>
          <img src={iconRank} alt="" className={s.panelIconImg} />
          <span className={s.panelTitle}>积分榜单</span>
        </div>
        <div className={s.rankTabs} role="tablist" aria-label="积分榜周期">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={period === tab.key}
              className={`${s.rankTab} ${period === tab.key ? s.rankTabActive : ''}`}
              onClick={() => setPeriod(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={s.sectionEmpty}>
          <Loader2 size={18} className="spin" /> 加载积分榜…
        </div>
      ) : null}

      {!loading && error ? <div className={s.sectionEmpty}>{error}</div> : null}

      {!loading && !error && items.length === 0 ? (
        <div className={s.sectionEmpty}>暂无积分榜数据</div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <>
          {podium.length > 0 ? (
            <div className={s.podium} aria-label="积分榜前三名">
              {podium.map((p) => (
                <div
                  key={p.rank}
                  className={`${s.podiumItem} ${p.rank === 1 ? s.podiumItemFirst : ''} ${
                    isMe(p) ? s.podiumItemMe : ''
                  }`}
                >
                  <img src={p.medal} alt={`第${p.rank}名`} className={s.podiumMedal} />
                  <span className={s.podiumName}>
                    {displayUserName(p)}
                    {isMe(p) ? <span className={s.meTag}>(我)</span> : null}
                  </span>
                  {p.dept_name ? (
                    <span className={s.podiumDept} title={p.dept_name}>
                      {p.dept_name}
                    </span>
                  ) : (
                    <span className={s.podiumDeptSpacer} aria-hidden />
                  )}
                  {/* 设计稿领奖台展示当前积分（balance），非周期增量 */}
                  <span className={`${s.podiumScore} ${s[`podiumScore_${p.tone}`]}`}>
                    {formatInt(p.balance)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {listRows.length > 0 ? (
            <div className={s.rankTable}>
              <div className={s.rankHead}>
                <span>排名</span>
                <span>用户</span>
                <span>部门</span>
                <span className={s.rankColNum}>当前积分</span>
                <span className={s.rankColNum}>{periodScoreLabel}</span>
              </div>
              {listRows.map((r) => {
                const me = isMe(r);
                return (
                  <div
                    key={r.user_id}
                    className={`${s.rankRow} ${me ? s.rankRowMe : ''}`}
                  >
                    <span className={s.rankNo}>{r.rank}</span>
                    <span className={s.rankUser} title={displayUserName(r)}>
                      {displayUserName(r)}
                      {me ? <span className={s.meTag}>(我)</span> : null}
                    </span>
                    <span className={s.rankDept} title={r.dept_name || undefined}>
                      {r.dept_name || '—'}
                    </span>
                    <span className={s.rankScore}>{formatInt(r.balance)}</span>
                    <span className={s.rankDelta}>{formatPeriodScore(r.period_score, period)}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** 榜单用户展示名；缺省时不用裸 id，避免领奖台只剩数字。 */
function displayUserName(row: PointLeaderboardItem): string {
  const name = (row.user_name || '').trim();
  if (name) return name;
  return `用户${row.user_id}`;
}

/** 整数展示。 */
function formatInt(n: number): string {
  return String(n ?? 0);
}

/**
 * 周期分展示：本月/本年正数带 +；总榜与余额同量级时仍原样。
 * @param score period_score
 * @param period 当前 Tab
 */
function formatPeriodScore(score: number, period: PointLeaderboardPeriod): string {
  if (period === 'all') return formatInt(score);
  if (score > 0) return `+${score}`;
  return String(score);
}
