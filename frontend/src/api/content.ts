import { fetchAdminConfig, type PortalConfig } from './adminConfig';

export interface FileItem {
  id: number;
  spaceId: number;
  title: string;
  summary: string;
  source: string;
  date: string;
  tags: string[];
  ext: string;
  sizeLabel: string;
  fileEncoding: string;
}

export interface FileDetail extends FileItem {
  space: { id: number; name: string };
}

export interface KnowledgeSpace {
  id: number;
  name: string;
  description: string;
  authType: string;
  userRole: string;
  spaceKind: string;
  departmentName: string;
  fileCount: number;
  memberCount: number;
  isPinned: boolean;
  updatedAt: string;
  sources: string[];
}

export type FilePreviewMode = 'pdf' | 'docx' | 'spreadsheet' | 'markdown' | 'html' | 'text' | 'image' | 'unsupported' | 'chunks';
export type FilePreviewSourceKind = 'preview_url' | 'original_url' | 'preview_task' | 'none';

export interface FilePreviewManifest {
  downloadUrl: string;
  mode: FilePreviewMode;
  reason: string;
  sourceKind: FilePreviewSourceKind;
  supportsChunksFallback: boolean;
  viewerUrl: string;
}

export interface FileChunkItem {
  chunkIndex: number;
  text: string;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
  detail?: string;
}

export class ApiRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

interface KnowledgeFileItemDto {
  id: number;
  space_id: number;
  title: string;
  summary: string;
  source: string;
  updated_at: string;
  tags: string[];
  file_ext?: string;
  file_size?: string;
  file_encoding?: string;
}

interface KnowledgeFileDetailDto extends KnowledgeFileItemDto {
  space: { id: number; name: string };
}

interface PagedKnowledgeFileDataDto {
  data: KnowledgeFileItemDto[];
  total: number;
  page: number;
  page_size: number;
}

interface KnowledgeSpaceDto {
  id: number;
  name: string;
  description?: string;
  auth_type?: string;
  user_role?: string;
  space_kind?: string;
  department_name?: string;
  file_count?: number;
  file_num?: number;
  member_count?: number;
  follower_num?: number;
  is_pinned?: boolean;
  updated_at?: string;
  update_time?: string;
  sources?: string[];
}

interface KnowledgeSpaceListDataDto {
  data: KnowledgeSpaceDto[];
  total: number;
}

interface RelatedKnowledgeFileDataDto {
  data: KnowledgeFileItemDto[];
  total: number;
}

interface HomeKnowledgeDataDto {
  sections: Record<string, KnowledgeFileItemDto[]>;
  tags: string[];
}

interface FilePreviewManifestDto {
  download_url: string;
  mode: FilePreviewMode;
  reason: string;
  source_kind: FilePreviewSourceKind;
  supports_chunks_fallback: boolean;
  viewer_url: string;
}

interface FileChunkItemDto {
  chunk_index: number;
  text: string;
}

export function mapKnowledgeFileItem(dto: KnowledgeFileItemDto): FileItem {
  return {
    id: dto.id,
    spaceId: dto.space_id,
    title: dto.title,
    summary: dto.summary,
    source: dto.source,
    date: dto.updated_at,
    tags: dto.tags ?? [],
    ext: dto.file_ext ?? '',
    sizeLabel: dto.file_size ?? '',
    fileEncoding: dto.file_encoding ?? '',
  };
}

function mapKnowledgeFileDetail(dto: KnowledgeFileDetailDto): FileDetail {
  return {
    ...mapKnowledgeFileItem(dto),
    space: dto.space,
  };
}

function mapKnowledgeSpace(dto: KnowledgeSpaceDto): KnowledgeSpace {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? '',
    authType: dto.auth_type ?? '',
    userRole: dto.user_role ?? '',
    spaceKind: dto.space_kind ?? 'normal',
    departmentName: dto.department_name ?? '',
    fileCount: dto.file_count ?? dto.file_num ?? 0,
    memberCount: dto.member_count ?? dto.follower_num ?? 0,
    isPinned: Boolean(dto.is_pinned),
    updatedAt: dto.updated_at ?? dto.update_time ?? '',
    sources: dto.sources ?? [],
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok) {
    throw new ApiRequestError(payload?.status_message || payload?.detail || '请求失败', response.status);
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  return parseResponse<T>(response);
}

let portalContentConfigPromise: Promise<PortalConfig> | null = null;

export function invalidatePortalContentConfigCache() {
  portalContentConfigPromise = null;
}

export async function fetchPortalContentConfig(): Promise<PortalConfig> {
  if (!portalContentConfigPromise) {
    portalContentConfigPromise = fetchAdminConfig().catch((error) => {
      portalContentConfigPromise = null;
      throw error;
    });
  }
  return portalContentConfigPromise;
}

export async function fetchAggregatedTags(spaceIds?: number[], spaceLevel?: string): Promise<string[]> {
  const params = new URLSearchParams();
  spaceIds?.forEach((id) => params.append('space_ids', String(id)));
  if (spaceLevel) params.set('space_level', spaceLevel);
  const query = params.toString();
  return request<string[]>(`/api/v1/knowledge/tags${query ? `?${query}` : ''}`);
}

export async function fetchHomeContent(): Promise<{ sections: Record<string, FileItem[]>; tags: string[] }> {
  const data = await request<HomeKnowledgeDataDto>('/api/v1/knowledge/home');
  return {
    sections: Object.fromEntries(
      Object.entries(data.sections ?? {}).map(([tag, items]) => [tag, items.map(mapKnowledgeFileItem)]),
    ),
    tags: data.tags ?? [],
  };
}

export async function fetchSpaceTags(spaceId: number): Promise<string[]> {
  return request<string[]>(`/api/v1/knowledge/space/${spaceId}/tags`);
}

export async function searchFiles(params: {
  q?: string;
  tag?: string;
  spaceIds?: number[];
  spaceLevel?: string;
  fileExt?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: FileItem[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.tag) query.set('tag', params.tag);
  if (params.spaceLevel) query.set('space_level', params.spaceLevel);
  if (params.fileExt) query.set('file_ext', params.fileExt);
  if (params.sort) query.set('sort', params.sort);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  params.spaceIds?.forEach((id) => query.append('space_ids', String(id)));

  const data = await request<PagedKnowledgeFileDataDto>(`/api/v1/knowledge/files?${query.toString()}`);
  return {
    data: data.data.map(mapKnowledgeFileItem),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
  };
}

export async function fetchSpaceFiles(params: {
  spaceId: number;
  tag?: string;
  fileExt?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: FileItem[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.tag) query.set('tag', params.tag);
  if (params.fileExt) query.set('file_ext', params.fileExt);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));

  const data = await request<PagedKnowledgeFileDataDto>(
    `/api/v1/knowledge/space/${params.spaceId}/files?${query.toString()}`,
  );
  return {
    data: data.data.map(mapKnowledgeFileItem),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
  };
}

export async function fetchKnowledgeSpaces(): Promise<{ data: KnowledgeSpace[]; total: number }> {
  const data = await request<KnowledgeSpaceListDataDto>('/api/v1/knowledge/spaces');
  return {
    data: data.data.map(mapKnowledgeSpace),
    total: data.total,
  };
}

export async function fetchFileDetail(spaceId: number, fileId: number): Promise<FileDetail | null> {
  const data = await request<KnowledgeFileDetailDto | null>(`/api/v1/knowledge/space/${spaceId}/files/${fileId}`);
  return data ? mapKnowledgeFileDetail(data) : null;
}

export async function fetchFilePreview(spaceId: number, fileId: number): Promise<FilePreviewManifest | null> {
  const data = await request<FilePreviewManifestDto | null>(`/api/v1/knowledge/space/${spaceId}/files/${fileId}/preview`);
  if (!data) return null;
  return {
    downloadUrl: data.download_url,
    mode: data.mode,
    reason: data.reason,
    sourceKind: data.source_kind,
    supportsChunksFallback: data.supports_chunks_fallback,
    viewerUrl: data.viewer_url,
  };
}

export async function fetchFileChunks(spaceId: number, fileId: number): Promise<FileChunkItem[]> {
  const data = await request<FileChunkItemDto[]>(`/api/v1/knowledge/space/${spaceId}/files/${fileId}/chunks`);
  return data.map((item) => ({
    chunkIndex: item.chunk_index,
    text: item.text,
  }));
}

export async function fetchRelatedFiles(spaceId: number, fileId: number, limit: number): Promise<FileItem[]> {
  const data = await request<RelatedKnowledgeFileDataDto>(
    `/api/v1/knowledge/space/${spaceId}/files/${fileId}/related?limit=${limit}`,
  );
  return data.data.map(mapKnowledgeFileItem);
}

export interface CitationSourcePayload {
  knowledgeId?: number;
  knowledgeName?: string;
  documentId?: number;
  documentName?: string;
  fileType?: string;
  snippet?: string;
}

export interface Citation {
  key: string;
  citationId?: string;
  itemId?: string;
  type?: string;
  sourcePayload?: CitationSourcePayload;
}

interface BishengStreamPayload {
  category?: string;
  type?: string;
  message?: { msg?: string; text?: string };
  citations?: Citation[];
  final?: boolean;
  responseMessage?: { text?: string; citations?: Citation[] };
}

export async function streamChatCompletion(params: {
  scene: 'search' | 'qa';
  text: string;
  knowledgeSpaceIds: number[];
  model?: string;
  onUpdate: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
}): Promise<void> {
  const response = await fetch('/api/v1/workstation/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientTimestamp: new Date().toISOString(),
      model: params.model ?? '',
      scene: params.scene,
      text: params.text,
      use_knowledge_base: {
        personal_knowledge_enabled: false,
        organization_knowledge_ids: [],
        knowledge_space_ids: params.knowledgeSpaceIds,
      },
      files: [],
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error('问答请求失败');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';
  let finalText = '';
  let lastCitations: Citation[] = [];

  const emit = (text: string) => {
    if (text && text !== accumulated) {
      accumulated = text;
      params.onUpdate(text);
    }
  };

  const emitCitations = (citations: Citation[] | undefined) => {
    if (citations && citations.length) {
      lastCitations = citations;
      params.onCitations?.(citations);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const dataLines = event.split('\n').filter((line) => line.startsWith('data: '));
      if (dataLines.length === 0) continue;
      const raw = dataLines.map((line) => line.slice(6)).join('\n');
      let payload: BishengStreamPayload;
      try {
        payload = JSON.parse(raw) as BishengStreamPayload;
      } catch {
        continue;
      }
      if (payload.category === 'agent_answer') {
        const msg = payload.message?.msg ?? '';
        if (payload.type === 'end') {
          if (msg) {
            finalText = msg;
            emit(msg);
          }
          emitCitations(payload.citations);
        } else if (msg) {
          emit(accumulated + msg);
        }
      } else if (payload.final) {
        const text = payload.responseMessage?.text || finalText || accumulated;
        if (text) emit(text);
        emitCitations(payload.responseMessage?.citations ?? lastCitations);
      }
    }
  }
}
