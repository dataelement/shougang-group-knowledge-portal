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

export interface FileListItemView {
  documentTypeLabel: string;
  dateLabel: string;
  sourcePath: string;
  summaryText: string;
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
  const visibleTagCount = Math.max(0, options.visibleTagCount ?? 2);
  const documentTypeLabel = getDocumentTypeLabel(file.ext);
  const displayTags = file.tags.filter((tag) => tag && !META_TAGS.has(tag));
  const visibleTags = displayTags.slice(0, visibleTagCount);
  const summaryText = file.summary.trim();
  const folderPath = file.folderPath?.trim();

  return {
    documentTypeLabel,
    dateLabel: formatCardDate(file.date),
    // Source folder breadcrumb: the resolved path (e.g. 测试02/C011/C0001), which
    // is just the space name when the file sits directly under the space; falls
    // back to the space name when no source path could be resolved. The document
    // type is shown separately, so it is not appended here.
    sourcePath: folderPath || file.source || '',
    summaryText,
    visibleTags,
    hiddenTagCount: Math.max(displayTags.length - visibleTags.length, 0),
    confidenceLabel: '',
    actions: [
      ...(options.canFavorite ? ['favorite' as const] : []),
      ...(options.canDownload ? ['download' as const] : []),
      ...(options.canShare ? ['share' as const] : []),
      ...(options.canAsk ? ['qa' as const] : []),
    ],
  };
}
