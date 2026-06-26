import type { PortalConfig } from './adminConfig';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

export interface FileTag {
  tag_name: string;
  resource_type: string;
}

export interface FileItem {
  id: number;
  spaceId: number;
  title: string;
  summary: string;
  source: string;
  date: string;
  tags: string[];
  tag_infos?: FileTag[];
  ext: string;
  sizeLabel: string;
  fileEncoding: string;
  /** 可读来源目录路径 "<source space>/<folder>/<folder>"，无法解析时为空。 */
  folderPath?: string;
  /** 可读文档来源路径 "<source space>><folder>/<file>"，根目录文件仅使用知识空间名称。 */
  sourcePath?: string;
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
  spaceLevel: string;
  departmentName: string;
  fileCount: number;
  memberCount: number;
  isPinned: boolean;
  updatedAt: string;
  sources: string[];
}

export interface QaKnowledgeTreeNode {
  id: number;
  spaceId: number;
  parentId: number | null;
  type: 'folder' | 'file';
  name: string;
  path: string;
  fileExt: string;
  selectable: boolean;
  disabledReason: string;
  hasChildren: boolean;
  resolvedFileCount: number;
}

export interface QaKnowledgeFileRef {
  knowledgeSpaceId: number;
  fileId: number;
}

export interface QaKnowledgeFolderRef {
  knowledgeSpaceId: number;
  folderId: number;
  resolvedFileCount?: number;
  fileRefs?: QaKnowledgeFileRef[];
}

export type QaKnowledgeScope =
  | { mode: 'none' }
  | { mode: 'knowledge_space'; knowledgeSpaceId: number }
  | {
      mode: 'files';
      fileRefs: QaKnowledgeFileRef[];
      folderRefs: QaKnowledgeFolderRef[];
      resolvedFileCount: number;
    };

export interface PersonalKnowledgeSpace {
  id: number;
  name: string;
  description: string;
  fileCount: number;
  updatedAt: string;
}

export interface FavoriteDocumentResult {
  fileId: number;
  spaceId: number;
  title: string;
}

export interface HomeStats {
  totalDocuments: number;
  readCount: number;
  favoriteCount: number;
  qaCount: number;
}

export type ShareDocumentType = 'link' | 'invite_code';
export type ShareDocumentVisibility = 'department' | 'public';

export interface ShareDocumentPermissions {
  view: boolean;
  download: boolean;
  upload: boolean;
}

export interface ShareDocumentResult {
  shareToken: string;
  link: string;
  inviteCode: string;
  expireSeconds: number;
}

export interface ShareDocumentMeta {
  shareToken: string;
  fileName: string;
  shareType: ShareDocumentType;
  visibility: ShareDocumentVisibility;
  permissions: ShareDocumentPermissions;
  requiresPassword: boolean;
  requiresInviteCode: boolean;
  expired: boolean;
}

export interface ShareDocumentAccessResult {
  shareToken: string;
  spaceId: number;
  fileId: number;
  allowDownload: boolean;
}

export interface WorkstationConversation {
  conversationId: string;
  title: string;
  createAt: string;
  updateAt: string;
  latestMessage: string;
}

export interface AgentWorkflowConversation {
  conversationId: string;
  agentId: string;
  agentName: string;
  workflowId: string;
  title: string;
  createAt: string;
  updateAt: string;
  latestMessage: string;
}

export interface ChatAttachment {
  file_id: string;
  temp_file_id: string;
  filepath: string;
  filename: string;
  type: string;
  context?: string;
  message?: string;
}

export interface WorkstationChatMessage {
  messageId: string;
  conversationId: string;
  role: 'user' | 'bot';
  text: string;
  files: ChatAttachment[];
  citations: Citation[];
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
  tags: Array<string | FileTag>;
  tag_infos?: FileTag[];
  file_ext?: string;
  file_size?: string;
  file_encoding?: string;
  folder_path?: string;
  source_path?: string;
}

function normalizeFileTagInfos(tags: Array<string | FileTag> = [], tagInfos: FileTag[] = []): FileTag[] {
  const normalized: FileTag[] = [];
  const seen = new Set<string>();

  const append = (tagName: string, resourceType = '') => {
    const name = tagName.trim();
    if (!name) return;
    const key = `${name}\u0000${resourceType}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ tag_name: name, resource_type: resourceType });
  };

  for (const tag of tagInfos) append(tag.tag_name, tag.resource_type);
  for (const tag of tags) {
    if (typeof tag === 'string') {
      append(tag);
    } else {
      append(tag.tag_name, tag.resource_type);
    }
  }

  return normalized;
}

function normalizeFileTagNames(tags: Array<string | FileTag> = [], tagInfos: FileTag[] = []): string[] {
  const names: string[] = [];
  for (const tag of normalizeFileTagInfos(tags, tagInfos)) {
    if (!names.includes(tag.tag_name)) names.push(tag.tag_name);
  }
  return names;
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
  space_level?: string;
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

interface QaKnowledgeTreeNodeDto {
  id: number;
  space_id: number;
  parent_id?: number | null;
  type: 'folder' | 'file';
  name: string;
  path?: string;
  file_ext?: string;
  selectable?: boolean;
  disabled_reason?: string;
  has_children?: boolean;
  resolved_file_count?: number;
}

interface QaKnowledgeTreeNodeDataDto {
  data: QaKnowledgeTreeNodeDto[];
  total: number;
  page: number;
  page_size: number;
}

interface PersonalKnowledgeSpaceDto {
  id: number;
  name: string;
  description?: string;
  file_count?: number;
  file_num?: number;
  updated_at?: string;
  update_time?: string;
}

interface PersonalKnowledgeSpaceListDataDto {
  data: PersonalKnowledgeSpaceDto[];
  total: number;
}

interface FavoriteDocumentDataDto {
  file_id: number;
  space_id: number;
  title?: string;
}

interface ShareDocumentDataDto {
  share_token: string;
  link: string;
  invite_code?: string;
  expire_seconds?: number;
}

interface ShareDocumentMetaDto {
  share_token: string;
  file_name?: string;
  share_type?: ShareDocumentType;
  visibility?: ShareDocumentVisibility;
  permissions?: Partial<ShareDocumentPermissions>;
  requires_password?: boolean;
  requires_invite_code?: boolean;
  expired?: boolean;
}

interface ShareDocumentAccessDataDto {
  share_token: string;
  space_id: number;
  file_id: number;
  allow_download?: boolean;
}

interface RelatedKnowledgeFileDataDto {
  data: KnowledgeFileItemDto[];
  total: number;
}

interface HomeKnowledgeDataDto {
  sections: Record<string, KnowledgeFileItemDto[]>;
  tags: string[];
}

interface HomeStatsDataDto {
  total_documents: number;
  read_count: number;
  favorite_count: number;
  qa_count: number;
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

interface WorkstationConversationDto {
  chat_id?: string;
  conversationId?: string;
  name?: string;
  title?: string;
  create_time?: string;
  createdAt?: string;
  update_time?: string;
  updateAt?: string;
  latest_message?: string | { message?: string; text?: string };
}

interface AgentWorkflowConversationDto {
  agent_id?: string;
  agent_name?: string;
  workflow_id?: string;
  chat_id?: string;
  conversationId?: string;
  name?: string;
  title?: string;
  flow_name?: string;
  create_time?: string;
  createdAt?: string;
  update_time?: string;
  updateAt?: string;
  latest_message?: string | { message?: string; text?: string };
}

interface WorkstationMessageDto {
  messageId?: string | number;
  message_id?: string | number;
  conversationId?: string;
  chat_id?: string;
  isCreatedByUser?: boolean;
  is_bot?: boolean;
  text?: string;
  message?: string | {
    query?: string;
    msg?: string;
    content?: string;
    text?: string;
    files?: unknown[];
    events?: Array<{ type?: string; content?: string }>;
  };
  files?: unknown[];
  category?: string;
  citations?: Citation[];
}

export function mapKnowledgeFileItem(dto: KnowledgeFileItemDto): FileItem {
  const tagInfos = normalizeFileTagInfos(dto.tags, dto.tag_infos);
  return {
    id: dto.id,
    spaceId: dto.space_id,
    title: dto.title,
    summary: dto.summary,
    source: dto.source,
    date: dto.updated_at,
    tags: normalizeFileTagNames(dto.tags, tagInfos),
    tag_infos: tagInfos,
    ext: dto.file_ext ?? '',
    sizeLabel: dto.file_size ?? '',
    fileEncoding: dto.file_encoding ?? '',
    folderPath: dto.folder_path ?? '',
    sourcePath: dto.source_path ?? '',
  };
}

function mapSearchResultForSummary(item: FileItem) {
  return {
    id: item.id,
    space_id: item.spaceId,
    title: item.title,
    summary: item.summary,
    source: item.source,
    updated_at: item.date,
    tags: item.tags,
    tag_infos: item.tag_infos ?? [],
    file_ext: item.ext,
    file_size: item.sizeLabel,
    file_encoding: item.fileEncoding,
    folder_path: item.folderPath,
    source_path: item.sourcePath,
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
    spaceLevel: dto.space_level ?? '',
    departmentName: dto.department_name ?? '',
    fileCount: dto.file_count ?? dto.file_num ?? 0,
    memberCount: dto.member_count ?? dto.follower_num ?? 0,
    isPinned: Boolean(dto.is_pinned),
    updatedAt: dto.updated_at ?? dto.update_time ?? '',
    sources: dto.sources ?? [],
  };
}

function mapQaKnowledgeTreeNode(dto: QaKnowledgeTreeNodeDto): QaKnowledgeTreeNode {
  return {
    id: dto.id,
    spaceId: dto.space_id,
    parentId: dto.parent_id ?? null,
    type: dto.type,
    name: dto.name,
    path: dto.path ?? '',
    fileExt: dto.file_ext ?? '',
    selectable: dto.selectable ?? true,
    disabledReason: dto.disabled_reason ?? '',
    hasChildren: Boolean(dto.has_children),
    resolvedFileCount: dto.resolved_file_count ?? (dto.type === 'file' ? 1 : 0),
  };
}

function mapPersonalKnowledgeSpace(dto: PersonalKnowledgeSpaceDto): PersonalKnowledgeSpace {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description ?? '',
    fileCount: dto.file_count ?? dto.file_num ?? 0,
    updatedAt: dto.updated_at ?? dto.update_time ?? '',
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      if (!response.ok) {
        throw new ApiRequestError(normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status), response.status);
      }
      throw new Error('响应不是有效 JSON');
    }
  }
  if (!response.ok) {
    const message = normalizeUserFacingMessage(
      payload?.status_message || payload?.detail,
      '请求失败，请稍后重试。',
      response.status,
    );
    throw new ApiRequestError(message, response.status);
  }
  if (!payload) {
    throw new Error('响应内容为空');
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, { credentials: 'include', ...init });
    return await parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new Error(normalizeUserFacingErrorMessage(error, '请求失败，请稍后重试。'));
  }
}

function appendShareToken(path: string, shareToken?: string): string {
  if (!shareToken) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}share_token=${encodeURIComponent(shareToken)}`;
}

let portalContentConfigPromise: Promise<PortalConfig> | null = null;

export function invalidatePortalContentConfigCache() {
  portalContentConfigPromise = null;
}

export async function fetchPortalContentConfig(): Promise<PortalConfig> {
  if (!portalContentConfigPromise) {
    portalContentConfigPromise = request<PortalConfig>('/api/v1/knowledge/config').catch((error) => {
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

export async function fetchDomainFileCounts(): Promise<Record<string, number>> {
  const data = await request<{ counts: Record<string, number> }>('/api/v1/knowledge/domain-file-counts');
  return data.counts ?? {};
}

export async function fetchHomeStats(): Promise<HomeStats> {
  const data = await request<HomeStatsDataDto>('/api/v1/knowledge/home/stats');
  return {
    totalDocuments: data.total_documents ?? 0,
    readCount: data.read_count ?? 0,
    favoriteCount: data.favorite_count ?? 0,
    qaCount: data.qa_count ?? 0,
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

export async function fetchQaKnowledgeTreeSpaces(): Promise<{ data: KnowledgeSpace[]; total: number }> {
  const data = await request<KnowledgeSpaceListDataDto>('/api/v1/knowledge/qa/tree/spaces');
  return {
    data: data.data.map(mapKnowledgeSpace),
    total: data.total,
  };
}

export async function fetchQaKnowledgeTreeChildren(
  spaceId: number,
  parentId?: number,
): Promise<{ data: QaKnowledgeTreeNode[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (parentId) query.set('parent_id', String(parentId));
  const suffix = query.toString();
  const data = await request<QaKnowledgeTreeNodeDataDto>(
    `/api/v1/knowledge/qa/tree/spaces/${spaceId}/children${suffix ? `?${suffix}` : ''}`,
  );
  return {
    data: data.data.map(mapQaKnowledgeTreeNode),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
  };
}

export async function searchQaKnowledgeFiles(
  q: string,
  page = 1,
  pageSize = 20,
): Promise<{ data: FileItem[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  query.set('q', q);
  query.set('page', String(page));
  query.set('page_size', String(pageSize));
  const data = await request<PagedKnowledgeFileDataDto>(`/api/v1/knowledge/qa/files/search?${query.toString()}`);
  return {
    data: data.data.map(mapKnowledgeFileItem),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
  };
}

export async function fetchPersonalKnowledgeSpaces(): Promise<{ data: PersonalKnowledgeSpace[]; total: number }> {
  const data = await request<PersonalKnowledgeSpaceListDataDto>('/api/v1/knowledge/personal-spaces');
  return {
    data: data.data.map(mapPersonalKnowledgeSpace),
    total: data.total,
  };
}

export async function favoriteDocument(params: {
  sourceSpaceId: number;
  sourceFileId: number;
  targetSpaceId: number;
}): Promise<FavoriteDocumentResult> {
  const data = await request<FavoriteDocumentDataDto>('/api/v1/knowledge/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_space_id: params.sourceSpaceId,
      source_file_id: params.sourceFileId,
      target_space_id: params.targetSpaceId,
    }),
  });
  return {
    fileId: data.file_id,
    spaceId: data.space_id,
    title: data.title ?? '',
  };
}

export async function createShareDocument(params: {
  spaceId: number;
  fileId: number;
  shareType: ShareDocumentType;
  visibility: ShareDocumentVisibility;
  allowDownload: boolean;
  password: string;
  expireSeconds: number;
}): Promise<ShareDocumentResult> {
  const data = await request<ShareDocumentDataDto>('/api/v1/knowledge/share-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      space_id: params.spaceId,
      file_id: params.fileId,
      share_type: params.shareType,
      visibility: params.visibility,
      allow_download: params.allowDownload,
      password: params.password,
      expire_seconds: params.expireSeconds,
    }),
  });
  return {
    shareToken: data.share_token,
    link: data.link,
    inviteCode: data.invite_code ?? '',
    expireSeconds: data.expire_seconds ?? 0,
  };
}

export async function fetchShareDocumentMeta(shareToken: string): Promise<ShareDocumentMeta> {
  const data = await request<ShareDocumentMetaDto>(`/api/v1/knowledge/share-links/${encodeURIComponent(shareToken)}`);
  return {
    shareToken: data.share_token,
    fileName: data.file_name ?? '',
    shareType: data.share_type ?? 'link',
    visibility: data.visibility ?? 'department',
    permissions: {
      view: data.permissions?.view ?? true,
      download: data.permissions?.download ?? false,
      upload: data.permissions?.upload ?? false,
    },
    requiresPassword: Boolean(data.requires_password),
    requiresInviteCode: Boolean(data.requires_invite_code),
    expired: Boolean(data.expired),
  };
}

export async function accessShareDocument(
  shareToken: string,
  params: { password: string; inviteCode: string },
): Promise<ShareDocumentAccessResult> {
  const data = await request<ShareDocumentAccessDataDto>(
    `/api/v1/knowledge/share-links/${encodeURIComponent(shareToken)}/access`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: params.password,
        invite_code: params.inviteCode,
      }),
    },
  );
  return {
    shareToken: data.share_token,
    spaceId: data.space_id,
    fileId: data.file_id,
    allowDownload: Boolean(data.allow_download),
  };
}

export async function fetchFileDetail(spaceId: number, fileId: number, shareToken?: string): Promise<FileDetail | null> {
  const data = await request<KnowledgeFileDetailDto | null>(
    appendShareToken(`/api/v1/knowledge/space/${spaceId}/files/${fileId}`, shareToken),
  );
  return data ? mapKnowledgeFileDetail(data) : null;
}

export async function fetchFilePreview(
  spaceId: number,
  fileId: number,
  shareToken?: string,
  entryPoint?: 'home_result_preview' | 'search_result_preview',
): Promise<FilePreviewManifest | null> {
  const path = appendShareToken(`/api/v1/knowledge/space/${spaceId}/files/${fileId}/preview`, shareToken);
  const previewPath = entryPoint
    ? `${path}${path.includes('?') ? '&' : '?'}entry_point=${encodeURIComponent(entryPoint)}`
    : path;
  const data = await request<FilePreviewManifestDto | null>(
    previewPath,
  );
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

export async function fetchFileChunks(spaceId: number, fileId: number, shareToken?: string): Promise<FileChunkItem[]> {
  const data = await request<FileChunkItemDto[]>(
    appendShareToken(`/api/v1/knowledge/space/${spaceId}/files/${fileId}/chunks`, shareToken),
  );
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

function mapWorkstationConversation(dto: WorkstationConversationDto): WorkstationConversation {
  const latest = dto.latest_message;
  const latestMessage = typeof latest === 'string'
    ? latest
    : latest?.message ?? latest?.text ?? '';
  const conversationId = String(dto.chat_id ?? dto.conversationId ?? '');
  return {
    conversationId,
    title: dto.name ?? dto.title ?? '新会话',
    createAt: dto.create_time ?? dto.createdAt ?? '',
    updateAt: dto.update_time ?? dto.updateAt ?? dto.create_time ?? dto.createdAt ?? '',
    latestMessage,
  };
}

function mapAgentWorkflowConversation(dto: AgentWorkflowConversationDto): AgentWorkflowConversation {
  const latest = dto.latest_message;
  const latestMessage = typeof latest === 'string'
    ? latest
    : latest?.message ?? latest?.text ?? '';
  const conversationId = String(dto.chat_id ?? dto.conversationId ?? '');
  const agentName = String(dto.agent_name ?? '');
  return {
    conversationId,
    agentId: String(dto.agent_id ?? ''),
    agentName,
    workflowId: String(dto.workflow_id ?? ''),
    title: (dto.name ?? dto.title ?? dto.flow_name ?? agentName) || '新会话',
    createAt: dto.create_time ?? dto.createdAt ?? '',
    updateAt: dto.update_time ?? dto.updateAt ?? dto.create_time ?? dto.createdAt ?? '',
    latestMessage,
  };
}

function parseMaybeJsonMessage(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readWorkstationMessageText(dto: WorkstationMessageDto): string {
  const rawMessage = typeof dto.message === 'string' ? parseMaybeJsonMessage(dto.message) : dto.message;
  if (typeof rawMessage === 'string') return rawMessage;
  if (rawMessage && typeof rawMessage === 'object') {
    if ('query' in rawMessage && typeof rawMessage.query === 'string') return rawMessage.query;
    if ('msg' in rawMessage && typeof rawMessage.msg === 'string') return rawMessage.msg;
    if ('content' in rawMessage && typeof rawMessage.content === 'string') return rawMessage.content;
    if ('text' in rawMessage && typeof rawMessage.text === 'string') return rawMessage.text;
    if ('events' in rawMessage && Array.isArray(rawMessage.events)) {
      return rawMessage.events
        .filter((event) => event?.type === 'text' && event.content)
        .map((event) => event.content)
        .join('');
    }
  }
  return dto.text ?? '';
}

function normalizeChatAttachment(raw: unknown): ChatAttachment | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const filepath = String(item.filepath ?? item.file_path ?? '');
  const filename = String(item.filename ?? item.file_name ?? item.name ?? '');
  if (!filepath && !filename) return null;
  const fileId = String(item.file_id ?? item.fileId ?? item.temp_file_id ?? item.tempFileId ?? '');
  const tempFileId = String(item.temp_file_id ?? item.tempFileId ?? fileId);
  return {
    file_id: fileId,
    temp_file_id: tempFileId,
    filepath,
    filename,
    type: String(item.type ?? ''),
    context: String(item.context ?? 'message_attachment'),
    message: String(item.message ?? ''),
  };
}

function readWorkstationMessageFiles(dto: WorkstationMessageDto): ChatAttachment[] {
  const rawMessage = typeof dto.message === 'string' ? parseMaybeJsonMessage(dto.message) : dto.message;
  const rawFiles = rawMessage && typeof rawMessage === 'object' && 'files' in rawMessage
    ? rawMessage.files
    : dto.files;
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .map(normalizeChatAttachment)
    .filter((item): item is ChatAttachment => Boolean(item));
}

function mapWorkstationMessage(dto: WorkstationMessageDto): WorkstationChatMessage {
  const isUser = dto.isCreatedByUser === true || dto.is_bot === false || dto.category === 'question';
  return {
    messageId: String(dto.messageId ?? dto.message_id ?? ''),
    conversationId: String(dto.conversationId ?? dto.chat_id ?? ''),
    role: isUser ? 'user' : 'bot',
    text: readWorkstationMessageText(dto),
    files: readWorkstationMessageFiles(dto),
    citations: dto.citations ?? [],
  };
}

export async function fetchWorkstationConversations(params: {
  page?: number;
  limit?: number;
} = {}): Promise<WorkstationConversation[]> {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 50));
  const data = await request<WorkstationConversationDto[]>(`/api/v1/workstation/chat/list?${query.toString()}`);
  return data.map(mapWorkstationConversation).filter((item) => item.conversationId);
}

export async function fetchAgentWorkflowConversations(params: {
  page?: number;
  limit?: number;
} = {}): Promise<AgentWorkflowConversation[]> {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 50));
  const data = await request<AgentWorkflowConversationDto[]>(
    `/api/v1/workstation/workflow/conversations?${query.toString()}`,
  );
  return data.map(mapAgentWorkflowConversation).filter((item) => item.conversationId && item.agentId && item.workflowId);
}

export async function fetchWorkstationMessages(conversationId: string): Promise<WorkstationChatMessage[]> {
  const data = await request<WorkstationMessageDto[]>(
    `/api/v1/workstation/messages/${encodeURIComponent(conversationId)}`,
  );
  return data.map(mapWorkstationMessage).filter((item) => item.text.trim() || item.files.length);
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
  chat_id?: string;
  message?: string | { content?: string; msg?: string; text?: string; conversationId?: string };
  citations?: Citation[];
  conversation?: { conversationId?: string };
  final?: boolean;
  responseMessage?: { text?: string; citations?: Citation[]; conversationId?: string };
}

function getStreamMessageText(payload: BishengStreamPayload): string {
  if (typeof payload.message === 'string') return payload.message;
  return payload.message?.content ?? payload.message?.msg ?? payload.message?.text ?? '';
}

function buildQaKnowledgeScopePayload(scope?: QaKnowledgeScope, fallbackSpaceIds: number[] = []) {
  if (!scope) {
    return {
      knowledge_space_ids: fallbackSpaceIds,
    };
  }
  if (scope.mode === 'knowledge_space') {
    return {
      knowledge_space_ids: [scope.knowledgeSpaceId],
      knowledge_scope: {
        mode: 'knowledge_space',
        knowledge_space_id: scope.knowledgeSpaceId,
        folder_refs: [],
        file_refs: [],
      },
    };
  }
  if (scope.mode === 'files') {
    const spaceIds = Array.from(new Set([
      ...scope.folderRefs.map((ref) => ref.knowledgeSpaceId),
      ...scope.fileRefs.map((ref) => ref.knowledgeSpaceId),
    ])).sort((a, b) => a - b);
    return {
      knowledge_space_ids: spaceIds,
      knowledge_scope: {
        mode: 'files',
        folder_refs: scope.folderRefs.map((ref) => ({
          knowledge_space_id: ref.knowledgeSpaceId,
          folder_id: ref.folderId,
        })),
        file_refs: scope.fileRefs.map((ref) => ({
          knowledge_space_id: ref.knowledgeSpaceId,
          file_id: ref.fileId,
        })),
      },
    };
  }
  return {
    knowledge_space_ids: [],
    knowledge_scope: {
      mode: 'none',
      folder_refs: [],
      file_refs: [],
    },
  };
}

async function consumeChatStream(
  response: Response,
  onUpdate: (text: string) => void,
  onCitations?: (citations: Citation[]) => void,
  onConversationId?: (conversationId: string) => void,
): Promise<void> {
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null) as { detail?: string; status_message?: string } | null;
    const message = normalizeUserFacingMessage(
      payload?.status_message || payload?.detail,
      '问答请求失败，请稍后重试。',
      response.status,
    );
    throw new ApiRequestError(message, response.status);
  }
  if (!response.body) {
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
      onUpdate(text);
    }
  };

  const emitCitations = (citations: Citation[] | undefined) => {
    if (citations && citations.length) {
      lastCitations = citations;
      onCitations?.(citations);
    }
  };

  const emitConversationId = (payload: BishengStreamPayload) => {
    const conversationId = payload.chat_id
      ?? payload.conversation?.conversationId
      ?? payload.responseMessage?.conversationId
      ?? (typeof payload.message === 'object' ? payload.message.conversationId : undefined);
    if (conversationId) {
      onConversationId?.(conversationId);
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
      emitConversationId(payload);
      if (payload.category === 'agent_answer') {
        const msg = getStreamMessageText(payload);
        if (payload.type === 'end') {
          if (msg) {
            finalText = msg;
            emit(msg);
          }
          emitCitations(payload.citations);
        } else if (msg) {
          emit(accumulated + msg);
        }
      } else if (payload.category === 'stream') {
        const content = getStreamMessageText(payload);
        if (payload.type === 'end') {
          if (content) {
            finalText = content;
            emit(content);
          }
          emitCitations(payload.citations);
        } else if (content) {
          emit(accumulated + content);
        }
      } else if (payload.final) {
        const text = payload.responseMessage?.text || finalText || accumulated;
        if (text) emit(text);
        emitCitations(payload.responseMessage?.citations ?? lastCitations);
      }
    }
  }
}

export async function streamChatCompletion(params: {
  scene: 'search' | 'qa';
  entryPoint?: 'home_qa' | 'qa_page';
  text: string;
  knowledgeSpaceIds: number[];
  knowledgeScope?: QaKnowledgeScope;
  spaceLevel?: string;
  searchResults?: FileItem[];
  files?: ChatAttachment[];
  conversationId?: string;
  model?: string;
  answerMode?: 'quick' | 'normal' | 'expert';
  onUpdate: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onConversationId?: (conversationId: string) => void;
}): Promise<void> {
  try {
    const response = await fetch('/api/v1/workstation/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientTimestamp: new Date().toISOString(),
        conversationId: params.conversationId,
        model: params.model ?? '',
        answer_mode: params.answerMode ?? 'normal',
        scene: params.scene,
        entry_point: params.entryPoint ?? '',
        space_level: params.spaceLevel,
        text: params.text,
        search_results: params.searchResults?.map(mapSearchResultForSummary) ?? [],
        use_knowledge_base: {
          personal_knowledge_enabled: false,
          organization_knowledge_ids: [],
          ...buildQaKnowledgeScopePayload(params.knowledgeScope, params.knowledgeSpaceIds),
        },
        files: params.files ?? [],
      }),
    });
    await consumeChatStream(response, params.onUpdate, params.onCitations, params.onConversationId);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new Error(normalizeUserFacingErrorMessage(error, '问答请求失败，请稍后重试。'));
  }
}

function createTempFileId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const fileId = createTempFileId();
  const form = new FormData();
  form.append('file', file);
  form.append('file_id', fileId);
  const data = await request<Record<string, unknown>>('/api/v1/workstation/files', {
    method: 'POST',
    body: form,
  });
  return normalizeChatAttachment(data) ?? {
    file_id: fileId,
    temp_file_id: fileId,
    filepath: '',
    filename: file.name,
    type: file.type,
    context: 'message_attachment',
    message: '',
  };
}

export async function streamDocumentFileChat(params: {
  spaceId: number;
  fileId: number;
  text: string;
  model?: string;
  onUpdate: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
}): Promise<void> {
  try {
    const response = await fetch(`/api/v1/knowledge/space/${params.spaceId}/files/${params.fileId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        query: params.text,
        model: params.model ?? '',
      }),
    });
    await consumeChatStream(response, params.onUpdate, params.onCitations);
  } catch (error) {
    if (error instanceof ApiRequestError) throw new Error('问答请求失败，请稍后重试。');
    throw new Error(normalizeUserFacingErrorMessage(error, '问答请求失败，请稍后重试。'));
  }
}
