/**
 * Portal tag-review API — BiSheng workstation review-tag endpoints via /workspace/api.
 */

import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

const TAGS_BASE = '/workspace/api/v1/workstation/tags';
const TAG_LIBRARY_BASE = '/workspace/api/v1/knowledge/space/tag-libraries';
const DEFAULT_TIMEOUT = 15_000;

export class TagReviewApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'TagReviewApiError';
  }
}

export interface ReviewTagResourceItem {
  file_source?: string;
  file_name?: string;
  file_id?: number;
  id?: number;
  submit_time?: string;
  knowledge_id?: number;
  file_url?: string;
  /** Immediate parent folder id; null/omitted means space root. */
  parent_id?: number | null;
}

export interface ReviewTagItem {
  tag_name: string;
  resource_type: string;
  tags_count?: number;
  resource_files: ReviewTagResourceItem[];
  knowledge_ids?: number[];
  tag_library_id?: number | null;
}

export interface ReviewTagPage {
  data: ReviewTagItem[];
  total: number;
}

export interface TagLibraryListItem {
  id: number;
  name: string;
}

interface ApiEnvelope<T> {
  status_code?: number;
  status_message?: string;
  data?: T;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      credentials: 'include',
      signal: controller.signal,
      ...init,
    });
  } catch (err) {
    throw new TagReviewApiError(normalizeUserFacingErrorMessage(err, '请求失败，请稍后重试。'), 0);
  } finally {
    clearTimeout(tid);
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new TagReviewApiError(
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
    throw new TagReviewApiError(msg, res.status);
  }

  const wrapped = payload as ApiEnvelope<T>;
  return wrapped.data !== undefined ? wrapped.data : (payload as T);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new TagReviewApiError('无权限审核标签', res.status);
  }
  return parseResponse<T>(res);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithTimeout(path, { method: 'GET' });
  if (res.status === 401 || res.status === 403) {
    throw new TagReviewApiError('无权限访问标签库', res.status);
  }
  return parseResponse<T>(res);
}

/** List pending review tags visible to the current reviewer. */
export async function listReviewTags(params: {
  page: number;
  page_size: number;
  keyword?: string;
}): Promise<ReviewTagPage> {
  const data = await postJson<ReviewTagPage>(`${TAGS_BASE}/list_review`, {
    page: params.page,
    page_size: params.page_size,
    keyword: params.keyword || '',
  });
  return {
    data: data?.data || [],
    total: data?.total || 0,
  };
}

/** Approve or reject a pending review tag. */
export async function approveOrRejectReviewTag(payload: {
  tag_name: string;
  status: number;
  resource_type: string;
  reject_reason?: string;
  tag_library_id?: number;
  knowledge_id?: number;
}): Promise<unknown> {
  return postJson(`${TAGS_BASE}/approve_or_reject`, payload);
}

/** List tag libraries bound to a knowledge space (for approve dialog). */
export async function listTagLibrariesByKnowledge(knowledgeId: number): Promise<TagLibraryListItem[]> {
  const data = await getJson<TagLibraryListItem[] | { data?: TagLibraryListItem[] }>(
    `${TAG_LIBRARY_BASE}/by-knowledge/${knowledgeId}`,
  );
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { data?: TagLibraryListItem[] }).data)) {
    return (data as { data: TagLibraryListItem[] }).data;
  }
  return [];
}

export function formatTagSourceLabel(resourceType: string): string {
  if (resourceType === 'ai_auto_tag') return 'AI标签';
  if (resourceType === 'system_tag') return '系统标签';
  return '人工标签';
}
