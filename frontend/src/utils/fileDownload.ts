import { fetchFilePreview, type FileItem, type FilePreviewManifest } from '../api/content';

export type FilePreviewFetcher = (spaceId: number, fileId: number) => Promise<FilePreviewManifest | null>;
export type OpenDownloadWindow = (url: string, target: string) => Window | null;

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

export function openFileDownloadWindow(openWindow?: OpenDownloadWindow): Window | null {
  const opener = openWindow ?? (typeof window !== 'undefined' ? window.open.bind(window) : undefined);
  if (!opener) return null;

  const pendingWindow = opener('about:blank', '_blank');
  if (pendingWindow) pendingWindow.opener = null;
  return pendingWindow;
}

export function closeFileDownloadWindow(downloadWindow: Window | null): void {
  downloadWindow?.close();
}

export function openFileDownloadUrl(
  downloadUrl: string,
  downloadWindow: Window | null,
  assignCurrentLocation?: (url: string) => void,
): void {
  if (downloadWindow) {
    downloadWindow.location.href = downloadUrl;
    return;
  }

  const assign = assignCurrentLocation ?? (typeof window !== 'undefined' ? window.location.assign.bind(window.location) : undefined);
  assign?.(downloadUrl);
}
