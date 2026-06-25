/**
 * expertQa.ts — Expert QA API Layer
 * 对齐后端路由 /workspace/api/v1/qa_experts/...
 *
 * 模块分区：
 *  1. 通用工具（错误类、HTTP 工具函数）
 *  2. 类型定义（接口 & 数据传输对象）
 *  3. 专家管理 API
 *  4. 问题 API
 *  5. 回答 API
 *  6. 评论 API
 *  7. 投票 API
 *  8. 通知 API
 *  9. 草稿 API
 * 10. 数据映射工具
 * 11. 文件上传 API
 */

import type { TranslationStatistics } from '../types/expertQa';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';
import type { DomainConfig, PortalConfig } from './adminConfig';

// ═══════════════════════════════════════════════════════════════
// §1  通用工具
// ═══════════════════════════════════════════════════════════════

/** API 基础路径 */
const BASE = '/workspace/api/v1/qa_experts';

/** 单次请求超时毫秒数 */
const DEFAULT_TIMEOUT = 8_000;
const KNOWLEDGE_TREE_TIMEOUT = 90_000;

// ─── 错误类 ──────────────────────────────────────────────────

/** 携带 HTTP 状态码的请求错误 */
export class ApiRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ApiRequestError';
  }
}

// ─── 底层 HTTP 工具 ──────────────────────────────────────────

/**
 * 带超时的 fetch 封装。
 * 支持传入外部 AbortSignal（如组件卸载时取消请求），
 * 与内部超时控制的 signal 合并使用。
 */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }

  const tid = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      credentials: 'include',
      signal: controller.signal,
      ...init,
    });
  } catch (err) {
    if (externalSignal?.aborted) {
      throw err; // 外部主动取消，原样抛出，由调用方判断 err.name === 'AbortError'
    }
    if (timedOut) {
      throw new ApiRequestError('请求超时，请稍后重试', 408);
    }
    throw new ApiRequestError(normalizeUserFacingErrorMessage(err, '请求失败，请稍后重试。'), 0);
  } finally {
    clearTimeout(tid);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 解析响应体
 * - 后端统一包装格式：`{ data, status_code, status_message }`
 * - 兼容后端直接返回裸数据的情况
 */
async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new ApiRequestError(
        normalizeUserFacingMessage(res.statusText, '请求失败，请稍后重试。', res.status),
        res.status,
      );
    }
    return text as unknown as T;
  }

  if (!res.ok) {
    const msg = normalizeUserFacingMessage(
      (payload as ApiResponse<unknown>)?.status_message || res.statusText,
      '请求失败，请稍后重试。',
      res.status,
    );
    throw new ApiRequestError(msg, res.status);
  }

  const wrapped = payload as ApiResponse<T>;
  return wrapped.data !== undefined ? wrapped.data : (payload as T);
}

/** 统一请求入口，处理 401/403 鉴权错误 */
async function req<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithTimeout(path, init, timeoutMs, signal);
  if (res.status === 401 || res.status === 403) {
    throw new ApiRequestError('权限不足，请重新登录或联系管理员', res.status);
  }
  return parseResponse<T>(res);
}

/** 将对象序列化为 URL 查询字符串（忽略 null/undefined/"" 值） */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

/**
 * 依次尝试多个候选请求路径，成功则返回，全部失败则静默处理。
 * 用于对接尚未稳定的后端 API（如投票、点赞等可选操作）。
 */
async function optionalAction(
  candidates: Array<{ path: string; body?: unknown }>,
): Promise<void> {
  for (const candidate of candidates) {
    try {
      await req<unknown>(candidate.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: candidate.body === undefined ? undefined : JSON.stringify(candidate.body),
      });
      return;
    } catch {
      // 后端接口可能尚未实现，尝试下一个候选路径；全部失败则降级为乐观更新
    }
  }
}

/**
 * 统一的分页响应归一化工具。
 * 兼容三种常见后端返回格式：
 *  1. 裸数组
 *  2. { data: T[], total, page, page_size }
 *  3. { <itemsKey>: T[], total, page, page_size }（如 { answers: [...] }）
 */
function normalizePaged<T>(
  raw: unknown,
  itemsKey: string,
  fallback: { page: number; pageSize: number },
): { items: T[]; total: number; page: number; pageSize: number } {
  if (Array.isArray(raw)) {
    return { items: raw, total: raw.length, page: fallback.page, pageSize: fallback.pageSize };
  }
  if (!raw || typeof raw !== 'object') {
    return { items: [], total: 0, page: fallback.page, pageSize: fallback.pageSize };
  }

  const obj = raw as Record<string, unknown>;
  const items =
    (Array.isArray(obj.data) && (obj.data as T[])) ||
    (Array.isArray(obj[itemsKey]) && (obj[itemsKey] as T[])) ||
    (Array.isArray(obj.items) && (obj.items as T[])) ||
    [];

  return {
    items,
    total: typeof obj.total === 'number' ? obj.total : items.length,
    page: typeof obj.page === 'number' ? obj.page : fallback.page,
    pageSize:
      typeof obj.page_size === 'number'
        ? (obj.page_size as number)
        : typeof obj.pageSize === 'number'
          ? (obj.pageSize as number)
          : fallback.pageSize,
  };
}

// ═══════════════════════════════════════════════════════════════
// §2  类型定义
// ═══════════════════════════════════════════════════════════════

// ─── 通用响应包装 ─────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  status_code: number;
  status_message: string;
}

// ─── 专家相关 ────────────────────────────────────────────────

/** 对应后端 Expert ORM 表字段 */
export interface ExpertProfileResponse {
  id: number;
  user_id: number;
  expert_name: string;
  introduction: string | null;
  depart_ment: string | null;
  major: string | null;
  answer_count: number;
  adoption_count: number;
  vote_count: number;
  created_at: string;
  updated_at: string;
}

/** GET /experts 分页响应 */
export interface PagedExpertResponse {
  experts: ExpertProfileResponse[];
  total: number;
  page: number;
  limit: number;
}

/** POST/PUT /experts 请求体 */
export interface ExpertUpsertPayload {
  user_id: number;
  expert_name: string;
  introduction?: string;
  depart_ment?: string;
  major?: string;
}

// ─── 用户相关 ────────────────────────────────────────────────

export interface UserListItem {
  user_id: number;
  user_name: string;
  department_id: number | string | null;
  dept_id: number | string | null;
  department_name?: string | null;
  department?: string | null;
  groups?: { id: number; name: string }[];
  roles?: { id: number; name: string }[];
}

export interface PagedUserResponse {
  users: UserListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── 问题相关 ────────────────────────────────────────────────

/** 后端 Question ORM 字段 */
export interface ApiQuestion {
  id: number;
  user_id: number;
  title: string;
  description: string;
  business_domain: string;
  /** 0: 未解决  1: 已解决  2: 已关闭 */
  status: 0 | 1 | 2;
  attachments: string | null;
  related_docs: string | null;
  invited_experts: string | null;
  experts_names: string | null;
  image_url: string | null;
  adopted_answer_id: number | null;
  vote_count: number;
  answer_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  comment_count: number;
}

/** GET /questions 列表响应（后端原始格式） */
export interface QuestionListResponse {
  data: ApiQuestion[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /questions 标准化后的前端列表结果 */
export interface ExpertQuestionListResult {
  questions: ApiQuestion[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /questions 请求体 */
export interface CreateQuestionPayload {
  title: string;
  body: string;
  domain: string;
  invited_expert_ids?: string;
  invited_expert_names?: string;
  image_url?: string;
  attachments?: string;
  related_docs?: string;
}

export interface UpdateQuestionPayload {
  title?: string;
  body?: string;
  domain?: string;
  invited_expert_ids?: string;
  invited_expert_names?: string;
  image_url?: string | null;
  attachments?: string | null;
  related_docs?: string | null;
}

export interface SimilarQuestionItem {
  id: number;
  title: string;
  answer_count?: number;
  view_count?: number;
}

// ─── 回答相关 ────────────────────────────────────────────────

export interface ApiAnswer {
  id: number;
  question_id: number;
  expert_id: number | null;
  expert_name: string | null;
  content: string;
  /** 1: normal  2: adopted  3: deleted */
  status: 1 | 2 | 3;
  attachments: string | null;
  related_docs: string | null;
  images_url: string | null;
  vote_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  /** 后端可能 JOIN 补充的专家信息 */
  expert?: ExpertProfileResponse;
  isExpert?: boolean;
  adopted?: boolean;
}

export interface PagedAnswerResponse {
  answers: ApiAnswer[];
  total: number;
  page: number;
  page_size: number;
}

/** POST /answers 请求体 */
export interface CreateAnswerPayload {
  question_id: number;
  content: string;
  expert_id?: number;
  attachments?: string | null;
  related_docs?: string | null;
  images_url: string | null;
}

// ─── 评论相关 ────────────────────────────────────────────────

export interface ApiComment {
  id: number;
  answer_id: number;
  user_id: number;
  content: string;
  is_follow_up: boolean;
  vote_count: number;
  created_at: string;
  user_name: string;
}

/** 分页评论响应 */
export interface PagedCommentResponse {
  data: ApiComment[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateCommentPayload {

  answer_id: number;
  content: string;
  is_follow_up?: boolean;
  question_id?: number;
}

function normalizeSingleResource<T>(raw: unknown, resourceKey: string): T {
  if (!raw || typeof raw !== 'object') return raw as T;

  const obj = raw as Record<string, unknown>;
  if (obj[resourceKey] && typeof obj[resourceKey] === 'object') {
    return obj[resourceKey] as T;
  }
  if (obj.data && typeof obj.data === 'object') {
    const data = obj.data as Record<string, unknown>;
    if (data[resourceKey] && typeof data[resourceKey] === 'object') {
      return data[resourceKey] as T;
    }
  }

  return raw as T;
}

// ─── 投票相关 ────────────────────────────────────────────────

export interface VoteQuestionPayload {
  target_type: string;
  target_id: number;
}

export interface VoteAnswerPayload {
  target_type: string;
  target_id: number;
}

// ─── 通知相关 ────────────────────────────────────────────────

export interface ApiNotification {
  id: number;
  recipient_id: number;
  sender_id: number;
  notification_type: 'invited' | 'answered' | 'commented' | 'adopted';
  question_id: number;
  answer_id: number | null;
  content: string;
  read: boolean;
  tenant_id: number;
  created_at: string;
}

// ─── 草稿相关 ────────────────────────────────────────────────

export interface DraftPayload {
  title?: string;
  description?: string;
  business_domain?: string;
  attachments?: unknown[];
  related_docs?: unknown[];
  invited_experts?: unknown[];
  anonymous?: boolean;
}

// ─── 文件上传相关 ─────────────────────────────────────────────

export interface QaUploadResult {
  image_url: string;
  file_name: string;
}

export interface QaKnowledgeSpaceOption {
  id: number;
  name: string;
  fileNum: number;
}

/** 后端上传接口原始响应（字段可能不统一） */
interface QaUploadResponse {
  image_url?: string;
  file_path?: string;
  file_name?: string | null;
}

export interface QaKnowledgeFileOption {
  id: string;
  fileId: number;
  spaceId: number;
  parentId: number | null;
  type: 'folder' | 'file';
  title: string;
  name: string;
  path: string;
  url: string;
  source?: string;
  ext?: string;
  sizeLabel?: string;
  hasChildren: boolean;
  resolvedFileCount: number;
  disabledReason?: string;
}

interface QaKnowledgeSpaceDto {
  id?: number | string;
  name?: string;
  file_num?: number | string;
  file_count?: number | string;
}

interface QaKnowledgeGroupedSpacesDto {
  public_spaces?: QaKnowledgeSpaceDto[];
}

interface QaKnowledgeFileDto {
  id?: number | string;
  file_id?: number | string;
  knowledge_id?: number | string;
  space_id?: number | string;
  parent_id?: number | string | null;
  parentId?: number | string | null;
  file_type?: number | string;
  type?: number | string;
  file_name?: string;
  name?: string;
  title?: string;
  source?: string;
  source_path?: string;
  folder_path?: string;
  file_level_path?: string;
  path?: string;
  url?: string;
  file_ext?: string;
  ext?: string;
  file_size?: number | string;
  sizeLabel?: string;
  has_children?: boolean;
  visible_success_file_num?: number | string;
  success_file_num?: number | string;
  resolved_file_count?: number | string;
  file_num?: number | string;
  file_count?: number | string;
  children_count?: number | string;
  selectable?: boolean;
  disabled_reason?: string;
}

interface QaKnowledgeFilesDto {
  data?:
    | QaKnowledgeFileDto[]
    | {
        data?: QaKnowledgeFileDto[];
        list?: QaKnowledgeFileDto[];
        items?: QaKnowledgeFileDto[];
      };
  list?: QaKnowledgeFileDto[];
  items?: QaKnowledgeFileDto[];
  total?: number;
}

// ═══════════════════════════════════════════════════════════════
// §3  专家管理 API
// ═══════════════════════════════════════════════════════════════

/** 获取专家档案列表（支持分页与姓名过滤） */
export async function fetchExpertProfiles(
  page = 1,
  limit = 10,
  name: string | undefined = undefined,
  signal?: AbortSignal,
): Promise<PagedExpertResponse> {
  const raw = await req<{ experts: ExpertProfileResponse[]; total: number } | ExpertProfileResponse[]>
  (`${BASE}/experts${qs({ page, limit, keyword:name})}`, undefined, DEFAULT_TIMEOUT, signal);
  if (Array.isArray(raw)) {
    return { experts: raw, total: raw.length, page, limit };
  }
  return { experts: raw.experts ?? [], total: raw.total ?? 0, page, limit };
}

/** 获取用户列表（GET /user/list） */
export async function fetchUserList(
  pageNum = 1,
  pageSize = 10,
): Promise<PagedUserResponse> {
  type RawUserList =
    | UserListItem[]
    | {
        list?: UserListItem[];
        users?: UserListItem[];
        data?: UserListItem[];
        total?: number;
      };

  const raw = await req<RawUserList>(
    `/workspace/api/v1/user/list${qs({ page_size: pageSize, page_num: pageNum, simple: 'false' })}`,
    undefined,
    KNOWLEDGE_TREE_TIMEOUT,
    
  );

  if (Array.isArray(raw)) {
    return { users: raw, total: raw.length, page: pageNum, pageSize };
  }

  const users = raw.list ?? raw.users ?? raw.data ?? [];
  return { users, total: raw.total ?? users.length, page: pageNum, pageSize };
}

/** 新增专家（POST /experts） */
export async function createExpert(
  payload: ExpertUpsertPayload,
): Promise<ExpertProfileResponse> {
  return req<ExpertProfileResponse>(`${BASE}/experts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** 更新专家信息（PUT /experts/:id） */
export async function updateExpert(
  expertId: number,
  payload: Partial<ExpertUpsertPayload>,
): Promise<ExpertProfileResponse> {
  return req<ExpertProfileResponse>(`${BASE}/experts/${expertId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** 删除专家（DELETE /experts/:id） */
export async function deleteExpert(expertId: number): Promise<void> {
  await req<unknown>(`${BASE}/experts/${expertId}`, { method: 'DELETE' });
}

export async function fetchExpertInfoDetail(expertName: string): Promise<ExpertProfileResponse> {
  return req<ExpertProfileResponse>(`${BASE}/experts/${encodeURIComponent(expertName)}`);
}

export async function fetchExpertAnswerDetail(
  questionId: number,
  expertName: string,
): Promise<ApiAnswer | null> {
  try {
    const res = await req<unknown>(
      `${BASE}/answers/${encodeURIComponent(questionId)}${qs({ expert_name: expertName })}`,
    );
    if (Array.isArray(res)) return (res[0] as ApiAnswer | undefined) ?? null;
    if (!res || typeof res !== 'object') return null;

    const obj = res as Record<string, unknown>;
    if (obj.answer === null) return null;
    if (obj.answer && typeof obj.answer === 'object') return obj.answer as ApiAnswer;
    if (Array.isArray(obj.data)) return (obj.data[0] as ApiAnswer | undefined) ?? null;
    if (Array.isArray(obj.answers)) return (obj.answers[0] as ApiAnswer | undefined) ?? null;
    if (typeof obj.id === 'number') return obj as unknown as ApiAnswer;
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// §4  问题 API
// ═══════════════════════════════════════════════════════════════

// ─── 业务领域配置（带单例缓存） ───────────────────────────────

/** 缓存门户配置请求，避免重复发起 */
let portalContentConfigPromise: Promise<PortalConfig> | null = null;

/** 获取业务领域列表（来源：门户配置接口） */
export async function fetchConfigData(): Promise<DomainConfig[]> {
  if (!portalContentConfigPromise) {
    portalContentConfigPromise = req<PortalConfig>('/api/v1/knowledge/config').catch((error) => {
      // 请求失败时重置缓存，允许下次重试
      portalContentConfigPromise = null;
      throw error;
    });
  }

  const config = await portalContentConfigPromise;
  if (!config?.domains) {
    console.warn('获取门户配置失败，domains 字段缺失');
    portalContentConfigPromise = null; // 数据非法也清空缓存，避免一直返回坏数据
    throw new Error('门户配置格式异常，请联系管理员。');
  }

  return config.domains;
}

/**
 * 清空业务领域配置缓存。
 * 用于后台修改配置后，强制下一次 fetchConfigData() 重新拉取最新数据。
 */
export function clearConfigDataCache(): void {
  portalContentConfigPromise = null;
}

// ─── 后端问题列表原始响应联合类型 ────────────────────────────

type RawQuestionListResponse =
  | QuestionListResponse
  | ApiQuestion[]
  | {
      questions?: ApiQuestion[];
      total?: number | number[];
      page?: number;
      pageSize?: number;
    };

/** 获取问题列表（支持领域/状态/排序/分页过滤） */
export async function fetchExpertQuestions(params: {
  domain?: string;
  status?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<ExpertQuestionListResult> {
  const raw = await req<RawQuestionListResponse>(
    `${BASE}/questions${qs({
      domain: params.domain,
      status: params.status,
      sort: params.sort,
      page: params.page,
      page_size: params.pageSize,
    })}`,
  );

  let questions: ApiQuestion[] = [];
  let total = 0;
  let page = params.page ?? 1;
  let pageSize = params.pageSize ?? 10;

  if (raw && typeof raw === 'object' && 'questions' in raw && Array.isArray(raw.questions)) {
    questions = raw.questions;

    // 兼容后端将 total 包装为数组的情况（如 [6]）
    total = Array.isArray(raw.total) ? Number(raw.total[0]) || 0 : Number(raw.total) || 0;
    page = raw.page ?? page;
    pageSize = raw.pageSize ?? pageSize;
  }

  return { questions, total, page, pageSize };
}

/** 获取问题详情（GET /questions/:id） */
export async function fetchExpertQuestionDetail(questionId: string): Promise<ApiQuestion> {
  return req<ApiQuestion>(`${BASE}/questions/${encodeURIComponent(questionId)}`);
}

export async function handleCheckQuestion(text: string): Promise<void> {
  await req<unknown>(`${BASE}/check_questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ check_text: text }),
  });
}

/** 创建问题（POST /questions） */
export async function createExpertQuestion(
  payload: CreateQuestionPayload,
): Promise<{ id: string }> {
  // 将前端字段映射为后端期望的字段名
  const backendPayload = {
    title: payload.title,
    description: payload.body,
    business_domain: payload.domain,
    invited_experts: payload.invited_expert_ids,
    experts_names: payload.invited_expert_names,
    image_url: payload.image_url ?? null,
    attachments: payload.attachments ?? null,
    related_docs: payload.related_docs ?? null,
  };

  const res = await req<ApiQuestion>(`${BASE}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backendPayload),
  });

  return { id: String(res.id) };
}

/** 更新问题（PUT /questions/:id） */
export async function updateExpertQuestion(
  questionId: number,
  payload: UpdateQuestionPayload,
): Promise<ApiQuestion> {
  const backendPayload = {
    title: payload.title,
    description: payload.body,
    business_domain: payload.domain,
    invited_experts: payload.invited_expert_ids,
    experts_names: payload.invited_expert_names,
    image_url: payload.image_url,
    attachments: payload.attachments,
    related_docs: payload.related_docs,
  };

  return req<ApiQuestion>(`${BASE}/questions/${questionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backendPayload),
  });
}

/** 删除问题（DELETE /questions/:id） */
export async function deleteExpertQuestion(questionId: number): Promise<void> {
  await req<unknown>(`${BASE}/questions/${questionId}`, { method: 'DELETE' });
}

/** 采纳回答（POST /questions/:id/adopt） */
export async function adoptAnswer(questionId: number, answerId: number): Promise<void> {
  await req<unknown>(`${BASE}/questions/${questionId}/adopt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer_id: answerId }),
  });
}

// ─── 相似问题搜索（本地 token 匹配） ─────────────────────────

/** 从标题文本中提取搜索词（支持中文分词与英文词拆分） */
function extractQuestionTokens(text: string): string[] {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return [];

  const tokens = new Set<string>();
  const wordMatches = normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fa5]{2,}/g) ?? [];

  for (const word of wordMatches) {
    tokens.add(word);
    // 对长度 >4 的纯中文词进行 2-gram / 3-gram 切分
    if (/^[\u4e00-\u9fa5]+$/.test(word) && word.length > 4) {
      for (let i = 0; i <= word.length - 2; i++) tokens.add(word.slice(i, i + 2));
      for (let i = 0; i <= word.length - 3; i++) tokens.add(word.slice(i, i + 3));
    }
  }

  // 过滤高频停用词，限制最多 12 个 token
  return Array.from(tokens)
    .filter((item) => !['问题', '如何', '怎么', '什么', '请问', '处理', '解决'].includes(item))
    .slice(0, 12);
}

/** 计算问题与 token 集合的匹配分数 */
function getQuestionMatchScore(question: ApiQuestion, tokens: string[]): number {
  const haystack = `${question.title} ${question.description ?? ''}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

/** 根据标题文本搜索相似问题（客户端本地 token 匹配） */
export async function fetchSimilarExpertQuestions(
  title: string,
  limit = 5,
): Promise<SimilarQuestionItem[]> {
  const tokens = extractQuestionTokens(title);
  if (!tokens.length) return [];

  const { questions } = await fetchExpertQuestions({ page: 1, pageSize: 50, sort: 'latest' });

  return questions
    .map((question) => ({ question, score: getQuestionMatchScore(question, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.question.view_count - a.question.view_count)
    .slice(0, limit)
    .map(({ question }) => ({
      id: question.id,
      title: question.title,
      answer_count: question.answer_count,
      view_count: question.view_count,
    }));
}

// ─── 问题互动操作 ─────────────────────────────────────────────

/** 点赞问题（兼容两种后端路径） */
export async function likeQuestion(questionId: number): Promise<void> {
  await optionalAction([
    { path: `${BASE}/questions/${questionId}/like` },
    { path: `${BASE}/votes/question`, body: { question_id: questionId } },
  ]);
}

/** 接受回答（兼容两种后端路径） */
export async function acceptAnswer(questionId: number, answerId: number): Promise<void> {
  await optionalAction([
    { path: `${BASE}/questions/${questionId}/adopt`, body: { answer_id: answerId } },
    { path: `${BASE}/answers/${answerId}/accept`, body: { question_id: questionId } },
  ]);
}

// ═══════════════════════════════════════════════════════════════
// §5  回答 API
// ═══════════════════════════════════════════════════════════════

/** 获取某问题的所有回答（GET /answers/:question_id） */
export async function fetchAnswers(questionId: number): Promise<ApiAnswer[]> {
  const raw = await req<ApiAnswer[] | { data: ApiAnswer[] }>(`${BASE}/answers/${questionId}`);
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

/** 分页获取某问题的回答（GET /answers/:question_id?page=&page_size=） */
export async function fetchAnswersPaged(
  questionId: number,
  page = 1,
  pageSize = 10,
): Promise<PagedAnswerResponse> {
  const raw = await req<unknown>(`${BASE}/answers/${questionId}${qs({ page, page_size: pageSize })}`);
  const { items, total, page: p, pageSize: ps } = normalizePaged<ApiAnswer>(raw, 'answers', {
    page,
    pageSize,
  });
  return { answers: items, total, page: p, page_size: ps };
}

/**
 * 获取某问题最新回答的摘要（截取前 60 字符）
 * 出错时静默返回 undefined，不影响主流程
 */
export async function fetchLatestAnswerExcerpt(params: {
  questionId: number;
  page?: number;
  pageSize?: number;
}): Promise<string | undefined> {
  try {
    const res = await req<ApiAnswer[]>(
      `${BASE}/answers/${params.questionId}${qs({
        page: params.page,
        page_size: params.pageSize,
      })}`,
    );

    if (res.length > 0) {
      const content = res[0].content;
      if (typeof content === 'string' && content.trim()) {
        return content.length > 60 ? content.substring(0, 60) + '...' : content;
      }
    }
  } catch (err) {
    console.error(`获取问题 ${params.questionId} 的最新回答失败:`, err);
  }

  return undefined;
}

/** 创建回答（POST /answers） */
export async function createAnswer(payload: CreateAnswerPayload): Promise<ApiAnswer> {
  const raw = await req<unknown>(`${BASE}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return normalizeSingleResource<ApiAnswer>(raw, 'answer');
}

/** 更新回答内容（PUT /answers/:id） */
export async function updateAnswer(answerId: number, content: string): Promise<ApiAnswer> {
  return req<ApiAnswer>(`${BASE}/answers/${answerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

/** 删除回答（DELETE /answers/:id） */
export async function deleteAnswer(answerId: number): Promise<void> {
  await req<unknown>(`${BASE}/answers/${answerId}`, { method: 'DELETE' });
}

// ─── 回答互动操作 ─────────────────────────────────────────────

/** 点赞回答（兼容两种后端路径） */
export async function likeAnswer(answerId: number): Promise<void> {
  await optionalAction([
    { path: `${BASE}/votes/answer`, body: { target_id: answerId, target_type: 'support' } },
  ]);
}

/** 标记回答为有用 */
export async function markAnswerUseful(payload: {
  target_id: number;
  target_type: string;
}): Promise<void> {
  await req<unknown>(`${BASE}/votes/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ═══════════════════════════════════════════════════════════════
// §6  评论 API
// ═══════════════════════════════════════════════════════════════

/** 获取某回答的所有评论（GET /comments/:answer_id） */
export async function fetchComments(answerId: number): Promise<ApiComment[]> {
  const raw = await req<ApiComment[] | { data: ApiComment[] }>(`${BASE}/comments/${answerId}`);
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

/** 分页获取某回答的评论（POST /allcomments，参数放在请求体中） */
export async function fetchCommentsPaged(
  answerId: number,
  questionId: number,
  page = 1,
  pageSize = 20,
): Promise<PagedCommentResponse> {
  try {
    const raw = await req<unknown>(`${BASE}/allcomments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer_id: answerId,
        question_id: questionId,
        page,
        page_size: pageSize,
      }),
    });

    const { items, total, page: p, pageSize: ps } = normalizePaged<ApiComment>(raw, 'comments', {
      page,
      pageSize,
    });
    return { data: items, total, page: p, page_size: ps };
  } catch {
    return { data: [], total: 0, page, page_size: pageSize };
  }
}

/**
 * 创建评论（POST /comments）
 */
export async function createComment(payload: CreateCommentPayload): Promise<ApiComment> {
  try {
    const raw = await req<unknown>(`${BASE}/comments`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'accept': 'application/json' // 补充 accept 头，与你的 curl 请求保持一致
      },
      body: JSON.stringify(payload), // 直接发送完整的 payload
    });
    return normalizeSingleResource<ApiComment>(raw, 'comment');

  } catch (err) {
    throw err instanceof Error ? err : new Error('评论发布失败，请稍后重试');
  }
}
// ─── 评论互动操作 ─────────────────────────────────────────────

/**
 * 点赞评论。
 */
export async function likeComment(payload: VoteAnswerPayload): Promise<void> {
  await req<unknown>(`${BASE}/votes/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ═══════════════════════════════════════════════════════════════
// §7  投票 API
// ═══════════════════════════════════════════════════════════════

/** 投票给问题（POST /votes/question） */
export async function voteQuestion(payload: VoteQuestionPayload): Promise<void> {
  await req<unknown>(`${BASE}/votes/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** 投票给回答（POST /votes/answer） */
export async function voteAnswer(payload: VoteAnswerPayload): Promise<void> {
  await req<unknown>(`${BASE}/votes/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ═══════════════════════════════════════════════════════════════
// §8  通知 API
// ═══════════════════════════════════════════════════════════════

/** 获取当前用户的通知列表（GET /notifications） */
export async function fetchNotifications(): Promise<ApiNotification[]> {
  const raw = await req<ApiNotification[] | { data: ApiNotification[] }>(`${BASE}/notifications`);
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

/** 将指定通知标记为已读（POST /notifications/:id/read） */
export async function markNotificationRead(notificationId: number): Promise<void> {
  await req<unknown>(`${BASE}/notifications/${notificationId}/read`, { method: 'POST' });
}


// ═══════════════════════════════════════════════════════════════
// §11  文件上传 API
// ═══════════════════════════════════════════════════════════════

export async function uploadQaImage(file: File): Promise<QaUploadResult> {
  const form = new FormData();
  form.append('file', file);

  const data = await req<QaUploadResponse>(`${BASE}/upload`, {
    method: 'POST',
    body: form,
  });

  return {
    image_url: data?.file_path ?? data?.image_url ?? '',
    file_name: data?.file_name ?? file.name,
  };
}

function toFiniteNumber(value: number | string | null | undefined, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readKnowledgeFilesPayload(raw: QaKnowledgeFilesDto | QaKnowledgeFileDto[]): QaKnowledgeFileDto[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  if (raw.data && typeof raw.data === 'object') {
    return raw.data.data ?? raw.data.list ?? raw.data.items ?? [];
  }
  return raw.list ?? raw.items ?? [];
}

function getKnowledgeFileTitle(file: QaKnowledgeFileDto): string {
  return (file.file_name || file.name || file.title || '').trim();
}

function getKnowledgeFileExt(title: string, file: QaKnowledgeFileDto): string {
  const explicitExt = (file.file_ext || file.ext || '').trim();
  if (explicitExt) return explicitExt.replace(/^\./, '');

  const dotIndex = title.lastIndexOf('.');
  return dotIndex >= 0 ? title.slice(dotIndex + 1).toLowerCase() : '';
}

function getKnowledgeNodeType(file: QaKnowledgeFileDto): 'folder' | 'file' {
  if (file.type === 'folder') return 'folder';
  if (file.type === 'file') return 'file';
  return toFiniteNumber(file.file_type ?? file.type, 1) === 0 ? 'folder' : 'file';
}

function getKnowledgeResolvedFileCount(file: QaKnowledgeFileDto): number {
  return toFiniteNumber(
    file.visible_success_file_num ??
      file.success_file_num ??
      file.resolved_file_count ??
      file.file_num ??
      file.file_count ??
      file.children_count,
  );
}

function mapKnowledgeFileOption(
  file: QaKnowledgeFileDto,
  fallbackSpaceId: number,
): QaKnowledgeFileOption | null {
  const fileId = toFiniteNumber(file.file_id ?? file.id);
  const spaceId = toFiniteNumber(file.knowledge_id ?? file.space_id, fallbackSpaceId);
  const parentId = toFiniteNumber(file.parent_id ?? file.parentId) || null;
  const type = getKnowledgeNodeType(file);
  const title = getKnowledgeFileTitle(file);
  const resolvedFileCount = type === 'file' ? 1 : getKnowledgeResolvedFileCount(file);

  if (!fileId || !spaceId || !title) return null;

  const path =
    (file.url || file.path || file.source_path || file.file_level_path || '').trim() ||
    `/space/${spaceId}/file/${fileId}`;

  return {
    id: `${spaceId}-${fileId}`,
    fileId,
    spaceId,
    parentId,
    type,
    title,
    name: title,
    path,
    url: path,
    source: file.source,
    ext: type === 'file' ? getKnowledgeFileExt(title, file) : '',
    sizeLabel:
      typeof file.file_size === 'number'
        ? String(file.file_size)
        : file.file_size || file.sizeLabel,
    hasChildren: type === 'folder' && (Boolean(file.has_children) || resolvedFileCount > 0),
    resolvedFileCount,
    disabledReason: file.disabled_reason,
  };
}

export async function fetchQaKnowledgePublicSpaces(): Promise<QaKnowledgeSpaceOption[]> {
  const data = await req<QaKnowledgeGroupedSpacesDto>(
    '/workspace/api/v1/knowledge/space/grouped?order_by=update_time',
  );

  return (data.public_spaces ?? [])
    .map((space) => ({
      id: toFiniteNumber(space.id),
      name: (space.name ?? '').trim(),
      fileNum: toFiniteNumber(space.file_num ?? space.file_count),
    }))
    .filter((space) => space.id > 0 && Boolean(space.name));
}

export async function fetchQaKnowledgeSpaceFiles(
  spaceId: number,
  parentId?: number | null,
): Promise<QaKnowledgeFileOption[]> {
  const query = qs({
    parent_id: parentId,
    page_size: 20,
  });
  const raw = await req<QaKnowledgeFilesDto | QaKnowledgeFileDto[]>(
    `/workspace/api/v1/knowledge/space/${spaceId}/children${query}`,
    undefined,
    KNOWLEDGE_TREE_TIMEOUT,
  );

  return readKnowledgeFilesPayload(raw)
    .map((file) => mapKnowledgeFileOption(file, spaceId))
    .filter((file): file is QaKnowledgeFileOption => Boolean(file));
}

/** 统计 */
export async function statistics(): Promise<TranslationStatistics> {
  return await req<TranslationStatistics>(`${BASE}/stats`, { method: 'GET' });
}
