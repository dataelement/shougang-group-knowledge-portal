/**
 * 用户积分列表 + 操作记录区块。
 */

import type { PointAdminUserItem, PointAuditLogItem } from '../../api/points';
import { formatAuditTime } from './pointsAdminUtils';
import s from './PointsManagementPanel.module.css';

type UserTab = 'users' | 'audit';

interface PointsUsersAuditSectionProps {
  userTab: UserTab;
  onUserTabChange: (tab: UserTab) => void;
  keyword: string;
  onKeywordChange: (v: string) => void;
  users: PointAdminUserItem[];
  userTotal: number;
  userPage: number;
  onUserPageChange: (page: number) => void;
  audits: PointAuditLogItem[];
  auditTotal: number;
  auditPage: number;
  onAuditPageChange: (page: number) => void;
  /** 打开直接调分（不走 R* 扣减规则） */
  onAdjustUser: (user: PointAdminUserItem) => void;
  /** 打开按 R* 规则违规扣减 */
  onDeductUser: (user: PointAdminUserItem) => void;
}

/** 渲染用户列表与审计 Tab。 */
export default function PointsUsersAuditSection({
  userTab,
  onUserTabChange,
  keyword,
  onKeywordChange,
  users,
  userTotal,
  userPage,
  onUserPageChange,
  audits,
  auditTotal,
  auditPage,
  onAuditPageChange,
  onAdjustUser,
  onDeductUser,
}: PointsUsersAuditSectionProps) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <h3 className={s.sectionTitle}>用户积分管理</h3>
        <div className={s.tabs} role="tablist" aria-label="用户管理">
          <button
            type="button"
            role="tab"
            aria-selected={userTab === 'users'}
            className={`${s.tab} ${userTab === 'users' ? s.tabActive : ''}`}
            onClick={() => onUserTabChange('users')}
          >
            用户积分列表
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={userTab === 'audit'}
            className={`${s.tab} ${userTab === 'audit' ? s.tabActive : ''}`}
            onClick={() => onUserTabChange('audit')}
          >
            操作记录
          </button>
        </div>
      </div>

      {userTab === 'users' ? (
        <>
          <div className={s.formRow}>
            <div className={s.field} style={{ minWidth: 220 }}>
              <label htmlFor="points-user-search">搜索用户</label>
              <input
                id="points-user-search"
                value={keyword}
                placeholder="用户名或用户 ID"
                onChange={(e) => onKeywordChange(e.target.value)}
              />
            </div>
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th>用户姓名</th>
                <th>部门</th>
                <th>用户 ID</th>
                <th>当前积分</th>
                <th>本月积分</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.user_name}</td>
                  <td>{u.dept_name || '—'}</td>
                  <td>{u.user_id}</td>
                  <td className={s.pos}>{u.balance}</td>
                  <td className={s.pos}>
                    {u.month_score > 0 ? `+${u.month_score}` : u.month_score}
                  </td>
                  <td className={s.ops}>
                    <button type="button" className={s.linkBtn} onClick={() => onAdjustUser(u)}>
                      调整积分
                    </button>
                    <button type="button" className={s.linkBtn} onClick={() => onDeductUser(u)}>
                      违规扣减
                    </button>
                  </td>
                </tr>
              ))}
              {!users.length ? (
                <tr>
                  <td colSpan={6}>暂无用户积分账户</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className={s.pager}>
            共 {userTotal} 人 · 第 {userPage} 页
            <button type="button" disabled={userPage <= 1} onClick={() => onUserPageChange(userPage - 1)}>
              上一页
            </button>
            <button
              type="button"
              disabled={userPage * 20 >= userTotal}
              onClick={() => onUserPageChange(userPage + 1)}
            >
              下一页
            </button>
          </div>
        </>
      ) : (
        <>
          <table className={s.table}>
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>操作</th>
                <th>变动</th>
                <th>余额</th>
                <th>规则</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((row) => (
                <tr key={row.id}>
                  <td>{formatAuditTime(row.occurred_at)}</td>
                  <td>
                    {row.user_name} ({row.user_id})
                  </td>
                  <td>{row.title}</td>
                  <td className={row.delta >= 0 ? s.pos : s.neg}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </td>
                  <td>{row.balance_after}</td>
                  <td>{row.rule_code || '—'}</td>
                  <td>{row.remark || '—'}</td>
                </tr>
              ))}
              {!audits.length ? (
                <tr>
                  <td colSpan={7}>暂无操作记录</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className={s.pager}>
            共 {auditTotal} 条 · 第 {auditPage} 页
            <button type="button" disabled={auditPage <= 1} onClick={() => onAuditPageChange(auditPage - 1)}>
              上一页
            </button>
            <button
              type="button"
              disabled={auditPage * 20 >= auditTotal}
              onClick={() => onAuditPageChange(auditPage + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}
