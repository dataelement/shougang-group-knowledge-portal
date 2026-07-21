import type { AgentItemConfig, PortalConfig } from './adminConfig';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';
import { formatFileSize } from '../utils/fileSize';

export interface FileTag {
  tag_name: string;
  resource_type: string;
}

export interface FileItem {
  id: number;
  spaceId: number;
  spaceLevel?: string;
  title: string;
  summary: string;
  source: string;
  date: string;
  tags: string[];
  tag_infos?: FileTag[];
  ext: string;
  sizeLabel: string;
  fileEncoding: string;
  fileSubcategoryCode?: string;
  /** 可读来源目录路径 "<source space>/<folder>/<folder>"，无法解析时为空。 */
  folderPath?: string;
  /** 可读文档来源路径 "<source space>><folder>/<file>"，根目录文件仅使用知识空间名称。 */
  sourcePath?: string;
  /** 当前用户是否有该文件的下载权限，无权限时列表不展示下载按钮。 */
  canDownload?: boolean;
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

export interface QaKnowledgeFolderStats {
  folderId: number;
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
  | { mode: 'knowledge_space'; knowledgeSpaceIds: number[] }
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
  isFavorite: boolean;
}

export interface FavoriteDocumentResult {
  favoriteFileId: number;
  spaceId: number;
  sourceSpaceId: number;
  sourceFileId: number;
  title: string;
}

export interface FavoriteFile {
  favoriteFileId: number;
  sourceSpaceId: number;
  sourceFileId: number;
  title: string;
  fileName: string;
  status: 'valid' | 'invalid';
  updatedAt: string;
}

export interface HomeStats {
  totalDocuments: number;
  readCount: number;
  favoriteCount: number;
  qaCount: number;
}

export interface PortalHotSearchItem {
  rank: number;
  query: string;
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

export type PortalDownloadEntryPoint =
  | 'search'
  | 'knowledge_list'
  | 'detail'
  | 'home_recommendation'
  | 'favorite'
  | 'share'
  | 'expert_qa'
  | 'qa_citation'
  | 'other';

export interface PortalPdfDownloadResult {
  blob: Blob;
  fileName: string;
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
  code?: number;
  kind: ChatErrorKind;
  title: string;
  reason: string;
  retryable: boolean;

  constructor(
    message: string,
    status: number,
    code?: number,
    details: Partial<Pick<ApiRequestError, 'kind' | 'title' | 'reason' | 'retryable'>> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.kind = details.kind ?? 'system';
    this.title = details.title ?? '问答服务异常';
    this.reason = details.reason ?? message;
    this.retryable = details.retryable === true;
  }
}

interface KnowledgeFileItemDto {
  id: number;
  space_id: number;
  space_level?: string;
  title: string;
  summary: string;
  source: string;
  updated_at: string;
  tags?: Array<string | FileTag>;
  tag_infos?: FileTag[];
  file_ext?: string;
  file_size?: string;
  file_encoding?: string;
  file_subcategory_code?: string;
  folder_path?: string;
  source_path?: string;
  can_download?: boolean;
}

function normalizeFileTagInfos(
  tags: Array<string | FileTag> | undefined = [],
  tagInfos: FileTag[] = [],
): FileTag[] {
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
  for (const tag of tags ?? []) {
    if (typeof tag === 'string') {
      append(tag);
    } else {
      append(tag.tag_name, tag.resource_type);
    }
  }

  return normalized;
}

function normalizeFileTagNames(
  tags: Array<string | FileTag> | undefined = [],
  tagInfos: FileTag[] = [],
): string[] {
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

interface CursorKnowledgeFileDataDto {
  data: KnowledgeFileItemDto[];
  has_more: boolean;
  next_cursor?: string | null;
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
  page_size: number;
  has_more: boolean;
  next_cursor: string | null;
}

interface QaKnowledgeFolderStatsDataDto {
  stats: Array<{
    folder_id: number;
    resolved_file_count: number;
  }>;
}

interface PersonalKnowledgeSpaceDto {
  id: number;
  name: string;
  description?: string;
  file_count?: number;
  file_num?: number;
  updated_at?: string;
  update_time?: string;
  is_favorite?: boolean;
}

interface PersonalKnowledgeSpaceListDataDto {
  data: PersonalKnowledgeSpaceDto[];
  total: number;
}

interface FavoriteDocumentDataDto {
  favorite_file_id?: number;
  space_id?: number;
  source_space_id?: number;
  source_file_id?: number;
  title?: string;
}

interface FavoriteStatusItemDto {
  space_id: number;
  file_id: number;
  favorited?: boolean;
}

interface FavoriteStatusDataDto {
  data: FavoriteStatusItemDto[];
}

interface FavoriteFileDto {
  favorite_file_id?: number;
  source_space_id?: number;
  source_file_id?: number;
  title?: string;
  file_name?: string;
  status?: string;
  updated_at?: string;
}

interface FavoriteFilesDataDto {
  data: FavoriteFileDto[];
  total: number;
  page: number;
  page_size: number;
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

export type RecommendationMode = 'latest_selected' | 'personalized_v1';

export type FilePreviewEntryPoint =
  | 'home_recommendation'
  | 'recommendation_list'
  | 'search'
  | 'knowledge_space'
  | 'direct'
  | 'favorite'
  | 'other';

export interface FilePreviewContext {
  entryPoint: FilePreviewEntryPoint;
  recommendationScene?: RecommendationMode | null;
}

type HomeStreamEvent =
  | {
    type: 'section';
    tag: string;
    items: KnowledgeFileItemDto[];
    recommendation_mode?: RecommendationMode;
  }
  | { type: 'done' };

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

interface AgentFavoriteWorkflowsDto {
  workflow_ids?: string[];
  workflowIds?: string[];
}

interface AgentWorkflowItemDto {
  id?: string;
  type?: 'workflow' | 'url';
  workflow_id?: string;
  url?: string;
  name?: string;
  desc?: string;
  category_id?: string;
  tags?: string[];
  icon?: string;
  icon_image_url?: string;
  color?: string;
  bg?: string;
  enabled?: boolean;
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
    spaceLevel: dto.space_level ?? '',
    title: dto.title,
    summary: dto.summary,
    source: dto.source,
    date: dto.updated_at,
    tags: normalizeFileTagNames(dto.tags, tagInfos),
    tag_infos: tagInfos,
    ext: dto.file_ext ?? '',
    sizeLabel: formatFileSize(dto.file_size),
    fileEncoding: dto.file_encoding ?? '',
    fileSubcategoryCode: dto.file_subcategory_code ?? '',
    folderPath: dto.folder_path ?? '',
    sourcePath: dto.source_path ?? '',
    canDownload: dto.can_download ?? false,
  };
}

function mapSearchResultForSummary(item: FileItem) {
  return {
    id: item.id,
    space_id: item.spaceId,
    space_level: item.spaceLevel,
    title: item.title,
    summary: item.summary,
    source: item.source,
    updated_at: item.date,
    tags: item.tags,
    tag_infos: item.tag_infos ?? [],
    file_ext: item.ext,
    file_size: item.sizeLabel,
    file_encoding: item.fileEncoding,
    file_subcategory_code: item.fileSubcategoryCode,
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
    isFavorite: Boolean(dto.is_favorite),
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
    throw new ApiRequestError(message, response.status, payload?.status_code);
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

export async function fetchPortalContentConfig(options: { force?: boolean } = {}): Promise<PortalConfig> {
  if (options.force) {
    portalContentConfigPromise = null;
  }
  if (!portalContentConfigPromise) {
    portalContentConfigPromise = request<PortalConfig>('/api/v1/knowledge/config').catch((error) => {
      portalContentConfigPromise = null;
      throw error;
    });
  }
  return portalContentConfigPromise;
}

export async function fetchAggregatedTags(
  spaceIds?: number[],
  spaceLevel?: string,
  businessDomainCode?: string,
  publicOnly = false,
): Promise<string[]> {
  const params = new URLSearchParams();
  spaceIds?.forEach((id) => params.append('space_ids', String(id)));
  if (spaceLevel) params.set('space_level', spaceLevel);
  if (businessDomainCode) params.set('business_domain_code', businessDomainCode);
  if (publicOnly) params.set('public_only', 'true');
  const query = params.toString();
  return request<string[]>(`/api/v1/knowledge/tags${query ? `?${query}` : ''}`);
}

export async function streamHomeContent(params: {
  onSection: (tag: string, items: FileItem[], recommendationMode?: RecommendationMode) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch('/api/v1/knowledge/home', {
    credentials: 'include',
    signal: params.signal,
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null) as BishengStreamPayload | null;
    const message = normalizeUserFacingMessage(
      payload?.status_message || payload?.detail,
      '首页数据加载失败，请稍后重试。',
      response.status,
    );
    throw new ApiRequestError(message, response.status, payload?.status_code);
  }
  if (!response.body) {
    throw new Error('首页数据加载失败');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
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
      let payload: HomeStreamEvent;
      try {
        payload = JSON.parse(raw) as HomeStreamEvent;
      } catch {
        continue;
      }
      if (payload.type === 'section') {
        params.onSection(
          payload.tag,
          (payload.items ?? []).map(mapKnowledgeFileItem),
          payload.recommendation_mode,
        );
      } else if (payload.type === 'done') {
        params.onDone?.();
      }
    }
  }
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

export async function fetchHotSearches(): Promise<PortalHotSearchItem[]> {
  const data = await request<{ hot_searches?: PortalHotSearchItem[] }>('/api/v1/knowledge/hot-searches');
  return (data.hot_searches ?? [])
    .filter((item) => item.query?.trim())
    .sort((left, right) => left.rank - right.rank)
    .slice(0, 5);
}

export async function fetchSpaceTags(spaceId: number): Promise<string[]> {
  return request<string[]>(`/api/v1/knowledge/space/${spaceId}/tags`);
}

export async function searchFiles(params: {
  q?: string;
  tag?: string;
  baseTag?: string;
  spaceIds?: number[];
  spaceLevel?: string;
  fileExt?: string;
  documentType?: string;
  fileSubcategoryCode?: string;
  sort?: string;
  cursor?: string | null;
  limit?: number;
  businessDomainCode?: string;
  recommendation?: string;
  publicOnly?: boolean;
}): Promise<{ data: FileItem[]; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.tag) query.set('tag', params.tag);
  if (params.baseTag) query.set('base_tag', params.baseTag);
  if (params.spaceLevel) query.set('space_level', params.spaceLevel);
  if (params.fileExt) query.set('file_ext', params.fileExt);
  if (params.documentType) query.set('document_type', params.documentType);
  if (params.fileSubcategoryCode) query.set('file_subcategory_code', params.fileSubcategoryCode);
  if (params.businessDomainCode) query.set('business_domain_code', params.businessDomainCode);
  if (params.recommendation) query.set('recommendation', params.recommendation);
  if (params.publicOnly) query.set('public_only', 'true');
  if (params.sort) query.set('sort', params.sort);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  params.spaceIds?.forEach((id) => query.append('space_ids', String(id)));

  const data = await request<CursorKnowledgeFileDataDto>(`/api/v1/knowledge/files?${query.toString()}`);
  return {
    data: data.data.map(mapKnowledgeFileItem),
    hasMore: Boolean(data.has_more),
    nextCursor: data.next_cursor || null,
  };
}

export async function searchKeywordFiles(params: {
  q: string;
  sort?: string;
}): Promise<{ data: FileItem[]; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams({ q: params.q });
  if (params.sort) query.set('sort', params.sort);
  const data = await request<CursorKnowledgeFileDataDto>(
    `/api/v1/knowledge/files/search?${query.toString()}`,
  );
  return {
    data: data.data.map(mapKnowledgeFileItem),
    hasMore: Boolean(data.has_more),
    nextCursor: data.next_cursor || null,
  };
}

export async function browseSearchFiles(params: {
  tag?: string;
  spaceIds?: number[];
  spaceLevel?: string;
  fileExt?: string;
  documentType?: string;
  fileSubcategoryCode?: string;
  businessDomainCode?: string;
  publicOnly?: boolean;
  sort?: string;
  cursor?: string | null;
}): Promise<{ data: FileItem[]; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (params.tag) query.set('tag', params.tag);
  if (params.spaceLevel) query.set('space_level', params.spaceLevel);
  if (params.fileExt) query.set('file_ext', params.fileExt);
  if (params.documentType) query.set('document_type', params.documentType);
  if (params.fileSubcategoryCode) query.set('file_subcategory_code', params.fileSubcategoryCode);
  if (params.businessDomainCode) query.set('business_domain_code', params.businessDomainCode);
  if (params.publicOnly) query.set('public_only', 'true');
  if (params.sort) query.set('sort', params.sort);
  if (params.cursor) query.set('cursor', params.cursor);
  params.spaceIds?.forEach((id) => query.append('space_ids', String(id)));
  const suffix = query.toString();
  const data = await request<CursorKnowledgeFileDataDto>(
    `/api/v1/knowledge/files/browse${suffix ? `?${suffix}` : ''}`,
  );
  return {
    data: data.data.map(mapKnowledgeFileItem),
    hasMore: Boolean(data.has_more),
    nextCursor: data.next_cursor || null,
  };
}

export async function fetchSpaceFiles(params: {
  spaceId: number;
  tag?: string;
  fileExt?: string;
  documentType?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: FileItem[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.tag) query.set('tag', params.tag);
  if (params.fileExt) query.set('file_ext', params.fileExt);
  if (params.documentType) query.set('file_subcategory_code', params.documentType);
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

export async function fetchKnowledgeSpaces(
  options: { publicOnly?: boolean } = {},
): Promise<{ data: KnowledgeSpace[]; total: number }> {
  const suffix = options.publicOnly ? '?public_only=true' : '';
  const data = await request<KnowledgeSpaceListDataDto>(`/api/v1/knowledge/spaces${suffix}`);
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
  cursor?: string,
): Promise<{ data: QaKnowledgeTreeNode[]; pageSize: number; hasMore: boolean; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (parentId) query.set('parent_id', String(parentId));
  if (cursor) query.set('cursor', cursor);
  const suffix = query.toString();
  const data = await request<QaKnowledgeTreeNodeDataDto>(
    `/api/v1/knowledge/qa/tree/spaces/${spaceId}/children${suffix ? `?${suffix}` : ''}`,
  );
  return {
    data: data.data.map(mapQaKnowledgeTreeNode),
    pageSize: data.page_size,
    hasMore: Boolean(data.has_more),
    nextCursor: data.next_cursor ?? null,
  };
}

export async function fetchQaKnowledgeFolderStats(
  spaceId: number,
  folderIds: number[],
): Promise<QaKnowledgeFolderStats[]> {
  const data = await request<QaKnowledgeFolderStatsDataDto>(
    `/api/v1/knowledge/qa/tree/spaces/${spaceId}/folder-stats`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_ids: [...new Set(folderIds)] }),
    },
  );
  return data.stats.map((item) => ({
    folderId: item.folder_id,
    resolvedFileCount: item.resolved_file_count,
  }));
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

export function favoriteKey(spaceId: number, fileId: number): string {
  return `${spaceId}:${fileId}`;
}

export async function favoriteDocument(params: {
  sourceSpaceId: number;
  sourceFileId: number;
}): Promise<FavoriteDocumentResult> {
  const data = await request<FavoriteDocumentDataDto>('/api/v1/knowledge/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_space_id: params.sourceSpaceId,
      source_file_id: params.sourceFileId,
    }),
  });
  return {
    favoriteFileId: data.favorite_file_id ?? 0,
    spaceId: data.space_id ?? 0,
    sourceSpaceId: data.source_space_id ?? 0,
    sourceFileId: data.source_file_id ?? 0,
    title: data.title ?? '',
  };
}

export async function removeFavorite(params: {
  sourceSpaceId: number;
  sourceFileId: number;
}): Promise<{ removed: boolean }> {
  const data = await request<{ removed?: boolean }>('/api/v1/knowledge/favorites/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_space_id: params.sourceSpaceId,
      source_file_id: params.sourceFileId,
    }),
  });
  return { removed: Boolean(data.removed) };
}

export async function fetchFavoriteStatus(
  items: { spaceId: number; fileId: number }[],
): Promise<Map<string, boolean>> {
  if (items.length === 0) return new Map();
  const data = await request<FavoriteStatusDataDto>('/api/v1/knowledge/favorites/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((it) => ({ space_id: it.spaceId, file_id: it.fileId })),
    }),
  });
  const map = new Map<string, boolean>();
  for (const it of data.data) {
    map.set(favoriteKey(it.space_id, it.file_id), Boolean(it.favorited));
  }
  return map;
}

function mapFavoriteFile(dto: FavoriteFileDto): FavoriteFile {
  return {
    favoriteFileId: dto.favorite_file_id ?? 0,
    sourceSpaceId: dto.source_space_id ?? 0,
    sourceFileId: dto.source_file_id ?? 0,
    title: dto.title ?? '',
    fileName: dto.file_name ?? '',
    status: dto.status === 'invalid' ? 'invalid' : 'valid',
    updatedAt: dto.updated_at ?? '',
  };
}

export async function fetchFavoriteFiles(params?: {
  page?: number;
  pageSize?: number;
}): Promise<{ data: FavoriteFile[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  query.set('page', String(params?.page ?? 1));
  query.set('page_size', String(params?.pageSize ?? 20));
  const data = await request<FavoriteFilesDataDto>(
    `/api/v1/knowledge/favorites/files?${query.toString()}`,
  );
  return {
    data: data.data.map(mapFavoriteFile),
    total: data.total,
    page: data.page,
    pageSize: data.page_size,
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

function normalizePdfDownloadFileName(value: string): string {
  const basename = value.split(/[\\/]/).pop()?.trim() ?? '';
  const safeName = basename
    .replace(/[\p{Cc}<>:"|?*]/gu, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (!safeName) return '';
  if (/\.pdf$/i.test(safeName)) return safeName;
  return safeName.replace(/\.[^.]+$/, '') + '.pdf';
}

function parseDownloadResponseFileName(contentDisposition: string | null): string {
  if (!contentDisposition) return '';
  const encoded = contentDisposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]
    ?.trim()
    .replace(/^"|"$/g, '');
  if (encoded) {
    try {
      return normalizePdfDownloadFileName(decodeURIComponent(encoded));
    } catch {
      // 继续尝试 ASCII filename。
    }
  }
  const ascii = contentDisposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return normalizePdfDownloadFileName((ascii?.[1] ?? ascii?.[2] ?? '').trim());
}

export async function fetchPortalPdfDownload(
  params: {
    spaceId: number;
    fileId: number;
    entryPoint: PortalDownloadEntryPoint;
    shareToken?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PortalPdfDownloadResult> {
  const query = new URLSearchParams({ entry_point: params.entryPoint });
  if (params.shareToken) query.set('share_token', params.shareToken);
  const path = `/api/v1/knowledge/space/${params.spaceId}/files/${params.fileId}/download?${query.toString()}`;
  let response: Response;
  try {
    response = await fetchImpl(path, { method: 'GET', credentials: 'include' });
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '下载请求失败，请稍后重试。'));
  }
  if (!response.ok) {
    const text = await response.text();
    let message = '';
    try {
      const payload = JSON.parse(text) as Partial<ApiEnvelope<unknown>> & { message?: string };
      message = payload.status_message || payload.detail || payload.message || '';
    } catch {
      // 非 JSON 错误体不得直接展示，按 HTTP 状态返回稳定文案。
    }
    const fallbackByStatus: Record<number, string> = {
      409: 'PDF 生成失败，请稍后重试。',
      429: '下载任务繁忙，请稍后重试。',
      500: 'PDF 生成失败，请稍后重试。',
      503: '下载服务暂不可用，请稍后重试。',
      504: 'PDF 生成超时，请稍后重试。',
    };
    const normalizedMessage = message
      ? normalizeUserFacingMessage(message, '下载失败，请稍后重试。', response.status)
      : fallbackByStatus[response.status] ?? '下载失败，请稍后重试。';
    throw new ApiRequestError(
      normalizedMessage,
      response.status,
    );
  }
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/pdf') {
    throw new ApiRequestError('下载服务未返回有效的 PDF 文件，请稍后重试。', 502);
  }
  return {
    blob: await response.blob(),
    fileName: parseDownloadResponseFileName(response.headers.get('content-disposition')),
  };
}

export async function fetchFilePreview(
  spaceId: number,
  fileId: number,
  shareToken?: string,
  context?: FilePreviewContext | 'home_result_preview' | 'search_result_preview',
): Promise<FilePreviewManifest | null> {
  const path = appendShareToken(
    '/api/v1/knowledge/space/' + spaceId + '/files/' + fileId + '/preview',
    shareToken,
  );
  const normalizedContext: FilePreviewContext | undefined = typeof context === 'string'
    ? {
      entryPoint: context === 'search_result_preview' ? 'search' : 'home_recommendation',
      recommendationScene: context === 'home_result_preview' ? 'latest_selected' : null,
    }
    : context;
  const query = new URLSearchParams();
  if (normalizedContext?.entryPoint) query.set('entry_point', normalizedContext.entryPoint);
  if (normalizedContext?.recommendationScene) {
    query.set('recommendation_scene', normalizedContext.recommendationScene);
  }
  const previewPath = query.size > 0
    ? path + (path.includes('?') ? '&' : '?') + query.toString()
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

function normalizeWorkflowIds(dto: AgentFavoriteWorkflowsDto): string[] {
  const rawIds = Array.isArray(dto.workflow_ids) ? dto.workflow_ids : dto.workflowIds;
  const seen = new Set<string>();
  const workflowIds: string[] = [];
  for (const rawId of rawIds ?? []) {
    const workflowId = String(rawId || '').trim();
    if (!workflowId || seen.has(workflowId)) continue;
    seen.add(workflowId);
    workflowIds.push(workflowId);
  }
  return workflowIds;
}

function mapAgentWorkflowItem(dto: AgentWorkflowItemDto): AgentItemConfig {
  return {
    id: String(dto.id ?? ''),
    type: dto.type === 'url' ? 'url' : 'workflow',
    workflow_id: String(dto.workflow_id ?? ''),
    url: String(dto.url ?? ''),
    name: String(dto.name ?? ''),
    desc: String(dto.desc ?? ''),
    category_id: String(dto.category_id ?? ''),
    tags: Array.isArray(dto.tags) ? dto.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    icon: String(dto.icon ?? 'Bot'),
    icon_image_url: String(dto.icon_image_url ?? ''),
    color: String(dto.color ?? '#2563eb'),
    bg: String(dto.bg ?? '#dbeafe'),
    enabled: dto.enabled !== false,
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

export async function renameWorkstationConversation(conversationId: string, name: string): Promise<void> {
  await request('/api/v1/workstation/chat/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, name }),
  });
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

export async function fetchAgentWorkflows(): Promise<AgentItemConfig[]> {
  const data = await request<AgentWorkflowItemDto[]>('/api/v1/workstation/workflow/agents');
  return data.map(mapAgentWorkflowItem).filter((item) => (
    Boolean(item.id)
    && (item.type === 'url' ? Boolean(item.url) : Boolean(item.workflow_id))
  ));
}

export async function fetchAgentFavoriteWorkflowIds(): Promise<string[]> {
  const data = await request<AgentFavoriteWorkflowsDto>('/api/v1/workstation/workflow/favorites');
  return normalizeWorkflowIds(data);
}

export async function favoriteAgentWorkflow(workflowId: string): Promise<void> {
  await request('/api/v1/workstation/workflow/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: workflowId }),
  });
}

export async function removeAgentWorkflowFavorite(workflowId: string): Promise<void> {
  await request('/api/v1/workstation/workflow/favorites', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: workflowId }),
  });
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
  status_code?: number;
  status_message?: string;
  detail?: string;
  data?: unknown;
  chat_id?: string;
  message?: string | { content?: string; msg?: string; text?: string; conversationId?: string };
  citations?: Citation[];
  conversation?: { conversationId?: string };
  final?: boolean;
  responseMessage?: { text?: string; citations?: Citation[]; conversationId?: string };
  kind?: ChatErrorKind;
  title?: string;
  reason?: string;
  retryable?: boolean;
  attempt?: number;
  max_attempts?: number;
  retry_after_ms?: number;
}

export type ChatErrorKind = 'model' | 'retrieval' | 'document' | 'rate_limit' | 'network' | 'auth' | 'config' | 'system';

export interface ChatRetryProgress {
  attempt: number;
  maxAttempts: number;
  retryAfterMs: number;
  message: string;
}

const CHAT_ERROR_COPY: Record<ChatErrorKind, { title: string; reason: string }> = {
  model: { title: '模型调用失败', reason: '模型服务暂时不可用，请稍后重试。' },
  retrieval: { title: '知识检索失败', reason: '暂时无法检索相关知识，请稍后重试。' },
  document: { title: '文档暂不可用', reason: '文档可能尚未就绪或已失效，请稍后再试。' },
  rate_limit: { title: '请求过于频繁', reason: '服务当前繁忙，请稍后重试。' },
  network: { title: '网络连接失败', reason: '连接问答服务超时或中断，请稍后重试。' },
  auth: { title: '认证或权限失败', reason: '当前账号无权执行此操作，请检查登录状态或权限。' },
  config: { title: '问答配置异常', reason: '问答模型或服务尚未正确配置，请联系管理员。' },
  system: { title: '问答服务异常', reason: '问答服务暂时不可用，请稍后重试。' },
};

function getStreamMessageText(payload: BishengStreamPayload): string {
  if (typeof payload.message === 'string') return payload.message;
  return payload.message?.content ?? payload.message?.msg ?? payload.message?.text ?? '';
}

function normalizeChatStreamErrorMessage(message: unknown, status?: number): string {
  const raw = typeof message === 'string' ? message.trim() : '';
  const containsTechnicalDetail = raw.length > 200
    || /(?:traceback|exception|stack|provider|database|token|secret|api[_ -]?key|https?:\/\/|\/users\/|\/home\/)/i.test(raw);
  return normalizeUserFacingMessage(
    containsTechnicalDetail ? undefined : raw,
    '问答请求失败，请稍后重试。',
    status,
  );
}

function buildChatStreamError(payload: BishengStreamPayload, status = 500): ApiRequestError {
  const kind = payload.kind && payload.kind in CHAT_ERROR_COPY
    ? payload.kind
    : payload.status_code === 429
      ? 'rate_limit'
      : payload.status_code === 401 || payload.status_code === 403
        ? 'auth'
        : 'system';
  const fallback = CHAT_ERROR_COPY[kind];
  const hasStructuredDetails = Boolean(payload.kind || payload.title || payload.reason);
  if (!hasStructuredDetails) {
    const legacyMessage = normalizeChatStreamErrorMessage(
      payload.status_message || payload.detail,
      status,
    );
    return new ApiRequestError(
      legacyMessage,
      status,
      payload.status_code,
      { kind, title: legacyMessage, reason: legacyMessage, retryable: false },
    );
  }
  const title = payload.title
    ? normalizeChatStreamErrorMessage(payload.title, status)
    : fallback.title;
  const reasonSource = payload.reason || payload.status_message || payload.detail;
  const normalizedReason = reasonSource
    ? normalizeChatStreamErrorMessage(reasonSource, status)
    : fallback.reason;
  const reason = normalizedReason === title ? fallback.reason : normalizedReason;
  return new ApiRequestError(
    `${title}\n${reason}`,
    status,
    payload.status_code,
    { kind, title, reason, retryable: payload.retryable === true },
  );
}

function buildChatRetryProgress(payload: BishengStreamPayload): ChatRetryProgress {
  const maxAttempts = Math.max(1, Math.min(2, Number(payload.max_attempts) || 2));
  const attempt = Math.max(1, Math.min(maxAttempts, Number(payload.attempt) || 1));
  return {
    attempt,
    maxAttempts,
    retryAfterMs: Math.max(0, Math.min(30_000, Number(payload.retry_after_ms) || 0)),
    message: `正在重试（${attempt}/${maxAttempts}）`,
  };
}

function buildQaKnowledgeScopePayload(scope?: QaKnowledgeScope, fallbackSpaceIds: number[] = []) {
  if (!scope) {
    return {
      knowledge_space_ids: fallbackSpaceIds,
    };
  }
  if (scope.mode === 'knowledge_space') {
    // 整库(可多选):仅带 knowledge_space_ids,后端按「无 scope 即对这些库做 RAG」处理,
    // 无需 knowledge_scope,也就不受单库限制。
    return {
      knowledge_space_ids: scope.knowledgeSpaceIds,
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
  onRetry?: (progress: ChatRetryProgress) => void,
): Promise<void> {
  if (!response.ok) {
    const payload = await response.clone().json().catch(() => null) as { detail?: string; status_code?: number; status_message?: string } | null;
    throw buildChatStreamError(payload ?? {}, response.status);
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
  let sawAnswer = false;

  const emit = (text: string) => {
    if (text && text !== accumulated) {
      accumulated = text;
      sawAnswer = true;
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

  const consumeEvent = (event: string) => {
    const lines = event.split('\n');
    const eventName = lines
      .find((line) => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).replace(/^ /, ''));
    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    let payload: BishengStreamPayload;
    try {
      payload = JSON.parse(raw) as BishengStreamPayload;
    } catch {
      return;
    }
    if (eventName === 'retry') {
      onRetry?.(buildChatRetryProgress(payload));
      return;
    }
    if (eventName === 'error' || (payload.status_code !== undefined && payload.status_code !== 200)) {
      const status = payload.status_code && payload.status_code >= 400 && payload.status_code <= 599
        ? payload.status_code
        : undefined;
      throw buildChatStreamError(payload, status ?? 500);
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
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      consumeEvent(event);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  if (!sawAnswer) {
    throw new ApiRequestError('问答请求失败，请稍后重试。', 502);
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
  onRetry?: (progress: ChatRetryProgress) => void;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    const response = await fetch('/api/v1/workstation/chat/completions', {
      method: 'POST',
      signal: params.signal,
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
    await consumeChatStream(response, params.onUpdate, params.onCitations, params.onConversationId, params.onRetry);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
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
  onRetry?: (progress: ChatRetryProgress) => void;
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
    await consumeChatStream(response, params.onUpdate, params.onCitations, undefined, params.onRetry);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new Error(normalizeUserFacingErrorMessage(error, '问答请求失败，请稍后重试。'));
  }
}

export async function recordPortalSearchEvent(
  query: string,
  entryPoint: 'search_page' | 'home_hot_keyword',
): Promise<void> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;
  const response = await fetch('/api/v1/knowledge/telemetry/search', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: normalizedQuery,
      entry_point: entryPoint,
    }),
  });
  if (!response.ok) {
    throw new ApiRequestError('搜索行为记录失败', response.status);
  }
}
