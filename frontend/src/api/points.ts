/**
 * 积分 API（F070）— 经 Vite `/workspace/api` 直连 BiSheng `/api/v1/points/*`。
 */

import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

const POINTS_BASE = '/workspace/api/v1/points';
const DEFAULT_TIMEOUT = 15_000;

/** 积分接口业务错误 */
export class PointsApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'PointsApiError';
  }
}

export interface PointSummary {
  balance: number;
  month_earned: number;
  month_deducted: number;
  dept_rank: number | null;
  global_rank: number | null;
  global_rank_display: string;
  rank_refreshed_at: string | null;
}

export interface PointLogItem {
  id: number;
  title: string;
  delta: number;
  balance_after: number;
  direction: string;
  rule_code: string | null;
  source: string;
  remark: string | null;
  occurred_at: string;
}

export interface PointRuleDTO {
  id: number;
  rule_code: string;
  rule_type: string;
  name: string;
  score_expr: Record<string, unknown>;
  daily_cap: number | null;
  beneficiary: string | null;
  beneficiary_options?: string[];
  status: string;
  remark: string | null;
  sort_order: number;
}

export interface PointOverview {
  total_issued: number;
  total_balance: number;
  total_violation_deducted: number;
}

interface ApiEnvelope<T> {
  status_code?: number;
  status_message?: string;
  data?: T;
}

interface PageData<T> {
  data: T[];
  total: number;
}

/**
 * 带超时的 fetch（携带 Cookie）。
 * @param input 请求 URL
 * @param init fetch 选项
 * @param timeoutMs 超时毫秒
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      credentials: 'include',
      signal: controller.signal,
      ...init,
    });
  } catch (err) {
    throw new PointsApiError(normalizeUserFacingErrorMessage(err, '请求失败，请稍后重试。'), 0);
  } finally {
    clearTimeout(tid);
  }
}

/**
 * 解析 BiSheng 统一响应包。
 * @param res HTTP 响应
 */
async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new PointsApiError(
        normalizeUserFacingMessage(res.statusText, '请求失败，请稍后重试。', res.status),
        res.status,
      );
    }
    return text as unknown as T;
  }

  if (!res.ok) {
    const msg = normalizeUserFacingMessage(
      (payload as ApiEnvelope<unknown>)?.status_message || res.statusText,
      '请求失败，请稍后重试。',
      res.status,
    );
    throw new PointsApiError(msg, res.status);
  }

  const wrapped = payload as ApiEnvelope<T>;
  // 业务错误码也可能以 200 + status_code!=200 返回
  if (typeof wrapped.status_code === 'number' && wrapped.status_code !== 200) {
    throw new PointsApiError(
      normalizeUserFacingMessage(wrapped.status_message, '请求失败，请稍后重试。', wrapped.status_code),
      wrapped.status_code,
    );
  }
  return wrapped.data !== undefined ? wrapped.data : (payload as T);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithTimeout(path, { method: 'GET' });
  return parseResponse<T>(res);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

/** 我的积分摘要 */
export async function fetchMyPointsSummary(): Promise<PointSummary> {
  return getJson<PointSummary>(`${POINTS_BASE}/me/summary`);
}

/**
 * 我的积分明细分页。
 * @param params.direction earn|deduct|all
 * @param params.from_date 起始日 YYYY-MM-DD（含）
 * @param params.to_date 结束日 YYYY-MM-DD（含）
 */
export async function fetchMyPointsLogs(params: {
  page?: number;
  page_size?: number;
  direction?: string;
  from_date?: string;
  to_date?: string;
}): Promise<PageData<PointLogItem>> {
  const q = new URLSearchParams();
  q.set('page', String(params.page ?? 1));
  q.set('page_size', String(params.page_size ?? 20));
  if (params.direction && params.direction !== 'all') {
    q.set('direction', params.direction);
  }
  if (params.from_date) q.set('from_date', params.from_date);
  if (params.to_date) q.set('to_date', params.to_date);
  return getJson<PageData<PointLogItem>>(`${POINTS_BASE}/me/logs?${q.toString()}`);
}

/** 前台公开规则（不含月奖 M*） */
export interface PointPublicRules {
  earn_rules: PointRuleDTO[];
  deduct_rules: PointRuleDTO[];
  copies: { copy_key: string; content: string; sort_order: number }[];
}

/** 拉取前台积分规则与说明文案 */
export async function fetchPublicPointRules(): Promise<PointPublicRules> {
  return getJson<PointPublicRules>(`${POINTS_BASE}/rules/public`);
}

/** 管理端概览三绝对数 */
export async function fetchPointsOverview(): Promise<PointOverview> {
  return getJson<PointOverview>(`${POINTS_BASE}/admin/overview`);
}

/**
 * 管理端规则列表。
 * @param ruleType 可选 earn|deduct|admin_reward
 */
export async function fetchAdminPointRules(ruleType?: string): Promise<PointRuleDTO[]> {
  const q = ruleType ? `?rule_type=${encodeURIComponent(ruleType)}` : '';
  return getJson<PointRuleDTO[]>(`${POINTS_BASE}/admin/rules${q}`);
}

/**
 * 启用/禁用规则。
 * @param ruleId 规则主键
 * @param status enabled|disabled
 */
export async function updatePointRuleStatus(
  ruleId: number,
  status: 'enabled' | 'disabled',
): Promise<PointRuleDTO> {
  return putJson<PointRuleDTO>(`${POINTS_BASE}/admin/rules/${ruleId}`, { status });
}

/**
 * 后台手动调分。
 * @param userId 目标用户
 * @param delta 非 0 整数
 * @param remark 原因
 */
export async function adjustUserPoints(
  userId: number,
  delta: number,
  remark: string,
): Promise<PointLogItem> {
  return postJson<PointLogItem>(`${POINTS_BASE}/admin/adjust`, {
    user_id: userId,
    delta,
    remark,
  });
}
