import {
  fetchPortalPdfDownload,
  type FileItem,
  type PortalDownloadEntryPoint,
  type PortalPdfDownloadResult,
} from '../api/content';

type DownloadFileIdentity = Pick<FileItem, 'id' | 'title'> & Partial<Pick<FileItem, 'ext'>>;

export interface WatermarkedFileDownloadParams {
  spaceId: number;
  fileId: number;
  entryPoint: PortalDownloadEntryPoint;
  shareToken?: string;
  title?: string;
  ext?: string;
}

export interface WatermarkedFileDownloadOptions {
  document?: Document;
  fetchDownload?: (params: {
    spaceId: number;
    fileId: number;
    entryPoint: PortalDownloadEntryPoint;
    shareToken?: string;
  }) => Promise<PortalPdfDownloadResult>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  scheduleRevoke?: (callback: () => void) => void;
}

export function buildDownloadFileName(file: DownloadFileIdentity): string {
  const rawTitle = file.title.trim() || `file-${file.id}`;
  const ext = (file.ext ?? '').trim().replace(/^\./, '');
  const stem = ext && rawTitle.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    ? rawTitle.slice(0, -(ext.length + 1))
    : rawTitle;
  const safeStem = stem
    .replace(/[\\/\p{Cc}<>:"|?*]/gu, '_')
    .replace(/^\.+|\.+$/g, '')
    .trim() || `file-${file.id}`;
  return `${safeStem}.pdf`;
}

export async function downloadWatermarkedFile(
  params: WatermarkedFileDownloadParams,
  options: WatermarkedFileDownloadOptions = {},
): Promise<void> {
  const fetchDownload = options.fetchDownload ?? fetchPortalPdfDownload;
  const result = await fetchDownload({
    spaceId: params.spaceId,
    fileId: params.fileId,
    entryPoint: params.entryPoint,
    shareToken: params.shareToken,
  });
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const createObjectURL = options.createObjectURL
    ?? (typeof URL !== 'undefined' ? URL.createObjectURL.bind(URL) : undefined);
  const revokeObjectURL = options.revokeObjectURL
    ?? (typeof URL !== 'undefined' ? URL.revokeObjectURL.bind(URL) : undefined);
  if (!doc?.body || !createObjectURL || !revokeObjectURL) {
    throw new Error('当前浏览器不支持文件下载');
  }

  const objectUrl = createObjectURL(result.blob);
  const anchor = doc.createElement('a');
  anchor.href = objectUrl;
  anchor.download = result.fileName || buildDownloadFileName({
    id: params.fileId,
    title: params.title ?? '',
    ext: params.ext,
  });
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    const scheduleRevoke = options.scheduleRevoke
      ?? ((callback: () => void) => setTimeout(callback, 0));
    scheduleRevoke(() => revokeObjectURL(objectUrl));
  }
}
