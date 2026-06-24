import { fetchFilePreview, type FileItem, type FilePreviewManifest } from '../api/content';

export type FilePreviewFetcher = (spaceId: number, fileId: number) => Promise<FilePreviewManifest | null>;
export interface FileDownloadOptions {
  document?: Document;
  assignCurrentLocation?: (url: string) => void;
}

export async function resolveFileDownloadUrl(
  file: FileItem,
  fetchPreview: FilePreviewFetcher = fetchFilePreview,
): Promise<string> {
  const preview = await fetchPreview(file.spaceId, file.id);
  return preview?.downloadUrl?.trim() ?? '';
}

export function buildDownloadFileName(file: FileItem): string {
  const title = file.title.trim() || `file-${file.id}`;
  const ext = file.ext.trim().replace(/^\./, '');
  if (!ext || title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) return title;
  return `${title}.${ext}`;
}

export function openFileDownloadUrl(
  downloadUrl: string,
  fileName: string,
  options: FileDownloadOptions = {},
): void {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  if (doc?.body) {
    const anchor = doc.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const assign = options.assignCurrentLocation
    ?? (typeof window !== 'undefined' ? window.location.assign.bind(window.location) : undefined);
  assign?.(downloadUrl);
}
