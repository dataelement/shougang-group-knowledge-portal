import type { FileItem } from '../api/content';

export type FileListItemAction = 'download' | 'favorite' | 'qa' | 'share';

const META_TAGS = new Set(['最新精选', '典型案例']);

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF 文档',
  doc: 'Word 文档',
  docx: 'Word 文档',
  xls: '表格文档',
  xlsx: '表格文档',
  csv: '表格文档',
  ppt: '演示文档',
  pptx: '演示文档',
  md: 'Markdown 文档',
  markdown: 'Markdown 文档',
  txt: '文本文件',
  html: '网页文档',
  htm: '网页文档',
};

export interface FileListItemViewOptions {
  visibleTagCount?: number;
  canAsk?: boolean;
  canFavorite?: boolean;
  canDownload?: boolean;
  canShare?: boolean;
}

export interface TagGroup {
  label: string;
  tags: string[];
  hiddenCount: number;
  hiddenTags: string[];
}

export interface FileListItemView {
  documentTypeLabel: string;
  dateLabel: string;
  sourcePath: string;
  summaryText: string;
  tagGroups: TagGroup[];
  visibleTags: string[];
  hiddenTagCount: number;
  confidenceLabel: string;
  actions: FileListItemAction[];
}

function formatCardDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const pad = (part: number) => String(part).padStart(2, '0');
  return [
    `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(' ');
}

export function getDocumentTypeLabel(ext: string): string {
  const normalized = ext.trim().toLowerCase().replace(/^\./, '');
  if (!normalized) return '文档';
  return DOCUMENT_TYPE_LABELS[normalized] ?? `${normalized.toUpperCase()} 文档`;
}

export function buildFileListItemView(
  file: FileItem,
  options: FileListItemViewOptions = {},
): FileListItemView {
  const documentTypeLabel = getDocumentTypeLabel(file.ext);

  const systemTags: string[] = [];
  const aiTags: string[] = [];
  const manualTags: string[] = [];
  const visibleTagCount = options.visibleTagCount ?? 3;
  const displayTags = file.tags.filter((tag) => tag && !META_TAGS.has(tag));
  const tagInfos = file.tag_infos ?? displayTags.map((tag) => ({ tag_name: tag, resource_type: 'manual_tag' }));

  for (const tag of tagInfos) {
    if (!tag || !tag.tag_name || META_TAGS.has(tag.tag_name)) continue;
    if (tag.resource_type === 'system_tag') {
      systemTags.push(tag.tag_name);
    } else if (tag.resource_type === 'ai_auto_tag') {
      aiTags.push(tag.tag_name);
    } else if (tag.resource_type === 'manual_tag') {
      manualTags.push(tag.tag_name);
    }
  }

  const MAX_TAGS_PER_GROUP = 2;
  const makeGroup = (label: string, allTags: string[]): TagGroup | null => {
    if (allTags.length === 0) return null;
    return {
      label,
      tags: allTags.slice(0, MAX_TAGS_PER_GROUP),
      hiddenCount: Math.max(0, allTags.length - MAX_TAGS_PER_GROUP),
      hiddenTags: allTags.slice(MAX_TAGS_PER_GROUP),
    };
  };
  const tagGroups: TagGroup[] = [
    makeGroup('系统标签', systemTags),
    makeGroup('AI标签', aiTags),
    makeGroup('手动标签', manualTags),
  ].filter((g): g is TagGroup => g !== null);

  const summaryText = file.summary.trim();
  const sourcePath = file.sourcePath?.trim();
  const folderPath = file.folderPath?.trim();

  // Display directory path only (no filename). folderPath is already directory-only;
  // fall back to stripping the last segment from sourcePath, then to the space name.
  const displayPath = folderPath
    || (sourcePath ? sourcePath.split('/').slice(0, -1).join('/') || sourcePath : '')
    || file.source
    || '';

  return {
    documentTypeLabel,
    dateLabel: formatCardDate(file.date),
    sourcePath: displayPath,
    summaryText,
    tagGroups,
    visibleTags: displayTags.slice(0, visibleTagCount),
    hiddenTagCount: Math.max(0, displayTags.length - visibleTagCount),
    confidenceLabel: '',
    actions: [
      ...(options.canFavorite ? ['favorite' as const] : []),
      ...(options.canDownload ? ['download' as const] : []),
      ...(options.canShare ? ['share' as const] : []),
      ...(options.canAsk ? ['qa' as const] : []),
    ],
  };
}
