/** Recycle-bin API helpers for portal admin. */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    let detail = '请求失败，请稍后重试。';
    try {
      const body = await response.json();
      detail = body?.detail || body?.status_message || body?.msg || detail;
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : '请求失败，请稍后重试。');
  }
  return (await response.json()) as T;
}

export interface RecycleItem {
  id: number;
  file_id: number;
  file_type: number;
  name: string;
  space_level: string | null;
  space_level_label: string | null;
  file_category: string | null;
  file_category_code: string | null;
  business_domain_code: string | null;
  tags: unknown[];
  file_encoding: string | null;
  file_size: number | null;
  deleted_by: number;
  deleted_by_name: string | null;
  deleted_at: string;
  expire_at: string;
  original_path: string;
  original_knowledge_id: number;
  original_knowledge_name: string | null;
  can_restore_original: boolean;
  children_count: number;
}

export interface RecycleListResult {
  data: RecycleItem[];
  total: number;
}

export interface RecycleConfig {
  retention_days: number;
}

export interface RecycleConflictEntry {
  name?: string;
  reason?: string;
  target_file_id?: number;
  path?: string;
}

export interface RecycleConflictWarning {
  code: string;
  message: string;
  conflicts?: RecycleConflictEntry[];
  item_ids?: number[];
}

export interface RecyclePreviewResult {
  ok: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: RecycleConflictWarning[];
  need_confirm_merge: boolean;
  need_confirm_overwrite: boolean;
}

export async function fetchRecycleConfig(): Promise<RecycleConfig> {
  return request<RecycleConfig>('/api/v1/knowledge_recycle/config');
}

export async function updateRecycleConfig(retentionDays: number): Promise<RecycleConfig> {
  return request<RecycleConfig>('/api/v1/knowledge_recycle/config', {
    method: 'PUT',
    body: JSON.stringify({ retention_days: retentionDays }),
  });
}

export async function fetchRecycleItems(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  spaceLevel?: string;
  fileType?: number;
}): Promise<RecycleListResult> {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.pageSize ?? 20));
  if (params.keyword?.trim()) qs.set('keyword', params.keyword.trim());
  if (params.spaceLevel) qs.set('space_level', params.spaceLevel);
  if (params.fileType != null) qs.set('file_type', String(params.fileType));
  return request<RecycleListResult>(`/api/v1/knowledge_recycle/items?${qs.toString()}`);
}

export async function previewRestore(body: Record<string, unknown>): Promise<RecyclePreviewResult> {
  return request<RecyclePreviewResult>('/api/v1/knowledge_recycle/restore/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function restoreRecycleItems(body: Record<string, unknown>): Promise<{ restored: number }> {
  return request<{ restored: number }>('/api/v1/knowledge_recycle/restore', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function purgeRecycleItems(body: {
  item_ids?: number[];
  all?: boolean;
}): Promise<{ purged: number }> {
  return request<{ purged: number }>('/api/v1/knowledge_recycle/purge', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
