import type { FileItem, FilePreviewManifest, FilePreviewMode, FilePreviewSourceKind } from '../api/content';

export interface ResolvedFilePreview {
  downloadUrl: string;
  mode: FilePreviewMode;
  prefersChunks: boolean;
  reason: string;
  sourceKind: FilePreviewSourceKind;
  supportsChunksFallback: boolean;
  viewerUrl: string;
}

export function resolveFilePreview(preview: FilePreviewManifest | null): ResolvedFilePreview {
  if (!preview) {
    return {
      downloadUrl: '',
      mode: 'chunks',
      prefersChunks: true,
      reason: '文档预览信息不可用，已回退到正文分段内容。',
      sourceKind: 'none',
      supportsChunksFallback: true,
      viewerUrl: '',
    };
  }

  return {
    downloadUrl: preview.downloadUrl,
    mode: preview.mode,
    prefersChunks: preview.mode === 'chunks',
    reason: preview.reason,
    sourceKind: preview.sourceKind,
    supportsChunksFallback: preview.supportsChunksFallback,
    viewerUrl: preview.viewerUrl,
  };
}

export function resolvePreviewModalFrameUrl(file: FileItem, _preview?: FilePreviewManifest | null): string {
  void _preview;
  return `/space/${file.spaceId}/file/${file.id}?embed=1`;
}
