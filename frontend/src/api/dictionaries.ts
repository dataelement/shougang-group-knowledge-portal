import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

export interface DictionaryItem {
  id: number;
  type: string;
  dict_key: string;
  dict_value: string;
  sort_order: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface DictionaryListQuery {
  type?: string;
  keyword?: string;
  is_enabled?: boolean;
  sort_by?: boolean;
  page?: number;
  page_size?: number;
}

export interface DictionaryListResponse {
  items: DictionaryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DictionaryCreateInput {
  type: string;
  dict_key: string;
  dict_value: string;
  sort_order?: number;
  is_enabled?: boolean;
}

export interface DictionaryUpdateInput {
  type?: string;
  dict_key?: string;
  dict_value?: string;
  sort_order?: number;
  is_enabled?: boolean;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
}

const BASE = '/workspace/api/v1/dictionaries/dictoption';

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(response.ok ? '响应内容为空' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? '响应不是有效 JSON' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  if (!response.ok) {
    throw new Error(normalizeUserFacingMessage(payload?.status_message, '请求失败，请稍后重试。', response.status));
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
    });
    return await parseResponse<T>(response);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '请求失败，请稍后重试。'));
  }
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

function normalizePagedList(raw: unknown, fallbackPage: number, fallbackPageSize: number): DictionaryListResponse {
  if (Array.isArray(raw)) {
    return { items: raw, total: raw.length, page: fallbackPage, pageSize: fallbackPageSize };
  }
  if (!raw || typeof raw !== 'object') {
    return { items: [], total: 0, page: fallbackPage, pageSize: fallbackPageSize };
  }
  const obj = raw as Record<string, unknown>;
  const items =
    (Array.isArray(obj.data) && (obj.data as DictionaryItem[])) ||
    (Array.isArray(obj.items) && (obj.items as DictionaryItem[])) ||
    [];
  return {
    items,
    total: typeof obj.total === 'number' ? obj.total : items.length,
    page: typeof obj.page === 'number' ? obj.page : fallbackPage,
    pageSize:
      typeof obj.page_size === 'number'
        ? (obj.page_size as number)
        : typeof obj.pageSize === 'number'
          ? (obj.pageSize as number)
          : fallbackPageSize,
  };
}

export interface DictionaryTypeOption {
  type: string;
  name: string;
}

export async function fetchDictionaryTypes(): Promise<DictionaryTypeOption[]> {
  const data = await request<DictionaryTypeOption[]>(`${BASE}/types`);
  return data;
}

export async function fetchDictionaries(query: DictionaryListQuery = {}): Promise<DictionaryListResponse> {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 20;
  const data = await request<unknown>(
    `${BASE}/list${buildQuery({
      type: query.type,
      keyword: query.keyword,
      is_enabled: query.is_enabled,
      sort_by: query.sort_by,
      page,
      page_size: pageSize,
    })}`,
  );
  return normalizePagedList(data, page, pageSize);
}

export async function fetchDictionaryById(id: number): Promise<DictionaryItem> {
  return request<DictionaryItem>(`${BASE}/query/${id}`);
}

export async function createDictionary(input: DictionaryCreateInput): Promise<DictionaryItem> {
  return request<DictionaryItem>(`${BASE}/create`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateDictionary(id: number, input: DictionaryUpdateInput): Promise<DictionaryItem> {
  return request<DictionaryItem>(`${BASE}/update/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteDictionary(id: number): Promise<void> {
  await request<unknown>(`${BASE}/delete/${id}`, {
    method: 'DELETE',
  });
}

export async function exportDictionaries(query: DictionaryListQuery = {}): Promise<void> {
  const response = await fetch(
    `${BASE}/export${buildQuery({
      type: query.type,
      keyword: query.keyword,
      is_enabled: query.is_enabled,
      sort_by: query.sort_by,
    })}`,
    {
      method: 'GET',
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = '导出失败，请稍后重试';
    if (text) {
      try {
        const payload = JSON.parse(text) as { status_message?: string; message?: string };
        message = payload.status_message || payload.message || message;
      } catch {
        message = text;
      }
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition');
  let filename = 'dictionaries.xlsx';
  if (contentDisposition) {
    const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
    if (match?.[1]) {
      filename = match[1].replace(/['"]/g, '').trim();
    }
  }
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export async function fetchNextSortOrder(type: string): Promise<number> {
  const data = await request<number | { next_sort_order?: number; sort_order?: number }>(
    `${BASE}/next_sort_order${buildQuery({ type })}`,
  );
  if (typeof data === 'number') return data;
  if (data && typeof data === 'object') {
    if (typeof data.next_sort_order === 'number') return data.next_sort_order;
    if (typeof data.sort_order === 'number') return data.sort_order;
  }
  return 1;
}

export async function importDictionaries(file: File): Promise<unknown> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${BASE}/import`, {
    method: 'POST',
    body: formData,
  });
  const text = await response.text();
  if (!text) {
    throw new Error(response.ok ? '响应内容为空' : '导入失败，请稍后重试');
  }
  let payload: { status_code?: number; status_message?: string; data?: unknown };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(response.ok ? '响应不是有效 JSON' : '导入失败，请稍后重试');
  }
  if (!response.ok || payload.status_code != null && payload.status_code !== 200) {
    throw new Error(payload.status_message || '导入失败，请稍后重试');
  }
  return payload.data;
}
