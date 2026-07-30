export type MigrationStatus =
  | 'preflight_queued'
  | 'preflighting'
  | 'awaiting_confirmation'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'partial_success'
  | 'failed'
  | 'abandoned';

interface ApiEnvelope<T> {
  status_code: number;
  status_message?: string;
  detail?: string;
  data: T;
}

export interface MigrationPage<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface MigrationSpace {
  id: number;
  name: string;
  level: string;
  owner_valid: boolean;
  selectable: boolean;
}

export interface MigrationNode {
  id: number;
  name: string;
  node_type: 'file' | 'folder';
  selectable: boolean;
  unavailable_reason?: string | null;
  has_children: boolean;
  status?: number | null;
}

export interface MigrationChildrenPage {
  data: MigrationNode[];
  page_size: number;
  has_more: boolean;
  next_cursor?: string | null;
}

export interface MigrationBatch {
  batch_no: string;
  request_id: string;
  operator_id: number;
  operator_name: string;
  source_selection: Array<{
    space_id: number;
    nodes: Array<{
      node_type: 'file' | 'folder';
      node_id: number;
      name?: string;
      file_level_path?: string;
    }>;
  }>;
  source_spaces: Array<{
    id: number;
    name: string;
    level?: string;
  }>;
  target_space_id: number;
  target_space_name: string;
  target_folder_id: number | null;
  target_folder_name: string | null;
  target_path: string;
  conflict_strategy: 'skip' | 'overwrite';
  preserve_structure: boolean;
  status: MigrationStatus;
  current_stage: string;
  round_no: number;
  scanned_count: number;
  total_count: number;
  executable_count: number;
  completed_count: number;
  succeeded_count: number;
  skipped_count: number;
  failed_count: number;
  unprocessed_count: number;
  overwrite_target_count: number;
  last_error_code: string | null;
  last_error_summary: string | null;
  confirmed_by: number | null;
  confirmed_at: string | null;
  abandoned_by: number | null;
  abandoned_at: string | null;
  create_time: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface MigrationFile {
  id: number;
  source_file_id: number;
  source_document_id: number | null;
  source_version_id: number | null;
  source_file_name: string;
  source_space_id: number;
  source_space_name: string;
  source_path: string;
  source_version_no: number | null;
  is_primary: boolean;
  target_file_id: number | null;
  target_space_id: number;
  target_space_name: string;
  target_path: string;
  target_file_name: string;
  status: string;
  checkpoint: string;
  reason_code: string | null;
  summary: string | null;
}

export interface MigrationUnit {
  id: number;
  unit_key: string;
  unit_type: 'file' | 'version_chain';
  source_document_id: number | null;
  target_document_id: number | null;
  source_space_id: number;
  source_space_name: string;
  source_path: string;
  planned_target_path: string;
  status: string;
  checkpoint: string;
  reason_code: string | null;
  summary: string | null;
  overwrite_unit_key: string | null;
  overwrite_snapshot: {
    unit_key?: string;
    matched_by?: string[];
    target_files?: Array<{
      id: number;
      knowledge_id: number;
      file_name: string;
      file_level_path?: string;
      md5?: string;
      reference_document_id?: number;
      document_id?: number;
      version_id?: number;
      version_no?: number;
      is_primary?: boolean;
    }>;
  } | null;
  folder_mapping: Array<{
    source_folder_id: number;
    source_name: string;
    target_folder_id?: number | null;
    action: string;
  }>;
  attempt_count: number;
  files: MigrationFile[];
}

export interface MigrationAttempt {
  id: number;
  unit_id: number;
  round_no: number;
  attempt_no: number;
  start_checkpoint: string;
  end_checkpoint: string | null;
  result: string;
  reason_code: string | null;
  error_summary: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface CreateMigrationRequest {
  request_id: string;
  source_selections: Array<{
    space_id: number;
    nodes: Array<{
      node_type: 'file' | 'folder';
      node_id: number;
    }>;
  }>;
  target_space_id: number;
  target_folder_id: number | null;
  preserve_structure: boolean;
  conflict_strategy: 'skip' | 'overwrite';
}

export class MigrationApiError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(
    message: string,
    status: number,
    code?: number,
  ) {
    super(message);
    this.name = 'MigrationApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    if (!response.ok) {
      throw new MigrationApiError('请求失败，请稍后重试。', response.status);
    }
  }
  if (!response.ok || !envelope || envelope.status_code !== 200) {
    const rawMessage =
      envelope?.detail || envelope?.status_message || '请求失败，请稍后重试。';
    const message =
      typeof rawMessage === 'string' ? rawMessage : '请求失败，请稍后重试。';
    throw new MigrationApiError(
      message,
      response.status,
      envelope?.status_code,
    );
  }
  return envelope.data;
}

function queryString(params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export function fetchMigrationSpaces(params: {
  purpose: 'source' | 'target';
  keyword?: string;
  spaceLevel?: string;
  page?: number;
  pageSize?: number;
}): Promise<MigrationPage<MigrationSpace>> {
  const query = queryString({
    purpose: params.purpose,
    keyword: params.keyword,
    space_level: params.spaceLevel,
    page: params.page ?? 1,
    page_size: params.pageSize ?? 100,
  });
  return request(`/api/v1/knowledge/migrations/spaces?${query}`);
}

export function fetchMigrationChildren(params: {
  spaceId: number;
  purpose: 'source' | 'target';
  parentId?: number | null;
  cursor?: string | null;
  pageSize?: number;
}): Promise<MigrationChildrenPage> {
  const query = queryString({
    purpose: params.purpose,
    parent_id: params.parentId,
    cursor: params.cursor,
    page_size: params.pageSize ?? 200,
  });
  return request(
    `/api/v1/knowledge/migrations/spaces/${params.spaceId}/children?${query}`,
  );
}

export function createMigrationBatch(
  body: CreateMigrationRequest,
): Promise<MigrationBatch> {
  return request('/api/v1/knowledge/migrations/batches', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchMigrationBatches(params: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<MigrationPage<MigrationBatch>> {
  const query = queryString({
    page: params.page ?? 1,
    page_size: params.pageSize ?? 20,
    status: params.status,
  });
  return request(`/api/v1/knowledge/migrations/batches?${query}`);
}

export function fetchMigrationBatch(batchNo: string): Promise<MigrationBatch> {
  return request(`/api/v1/knowledge/migrations/batches/${batchNo}`);
}

export function fetchMigrationUnits(
  batchNo: string,
  params: { page?: number; pageSize?: number; status?: string } = {},
): Promise<MigrationPage<MigrationUnit>> {
  const query = queryString({
    page: params.page ?? 1,
    page_size: params.pageSize ?? 100,
    status: params.status,
  });
  return request(
    `/api/v1/knowledge/migrations/batches/${batchNo}/units?${query}`,
  );
}

export function fetchMigrationAttempts(
  batchNo: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<MigrationPage<MigrationAttempt>> {
  const query = queryString({
    page: params.page ?? 1,
    page_size: params.pageSize ?? 100,
  });
  return request(
    `/api/v1/knowledge/migrations/batches/${batchNo}/attempts?${query}`,
  );
}

function postBatchCommand(
  batchNo: string,
  command: string,
): Promise<MigrationBatch> {
  return request(
    `/api/v1/knowledge/migrations/batches/${batchNo}/${command}`,
    { method: 'POST' },
  );
}

export function confirmMigrationOverwrite(batchNo: string) {
  return postBatchCommand(batchNo, 'confirm-overwrite');
}

export function abandonMigrationBatch(batchNo: string) {
  return postBatchCommand(batchNo, 'abandon');
}

export function retryMigrationBatch(batchNo: string) {
  return postBatchCommand(batchNo, 'retry');
}

export function deleteMigrationBatch(
  batchNo: string,
): Promise<{ deleted: boolean }> {
  return request(`/api/v1/knowledge/migrations/batches/${batchNo}`, {
    method: 'DELETE',
  });
}
