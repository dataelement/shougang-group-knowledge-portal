import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveFilePreview, resolvePreviewModalFrameUrl } from '../src/utils/filePreview';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('resolveFilePreview keeps backend-selected pdf manifest', () => {
  const resolved = resolveFilePreview({
    downloadUrl: 'https://example.com/original.pdf',
    mode: 'pdf',
    reason: '',
    sourceKind: 'preview_url',
    supportsChunksFallback: true,
    viewerUrl: '/api/v1/knowledge/space/12/files/1580/preview/content?source_kind=preview_url',
  });

  assert.equal(resolved.mode, 'pdf');
  assert.equal(resolved.viewerUrl, '/api/v1/knowledge/space/12/files/1580/preview/content?source_kind=preview_url');
  assert.equal(resolved.prefersChunks, false);
});

test('resolveFilePreview preserves spreadsheet and download metadata', () => {
  const resolved = resolveFilePreview({
    downloadUrl: 'https://example.com/original.xlsx',
    mode: 'spreadsheet',
    reason: '',
    sourceKind: 'original_url',
    supportsChunksFallback: true,
    viewerUrl: '/api/v1/knowledge/space/12/files/1590/preview/content?source_kind=original_url',
  });

  assert.equal(resolved.mode, 'spreadsheet');
  assert.equal(resolved.downloadUrl, 'https://example.com/original.xlsx');
  assert.equal(resolved.sourceKind, 'original_url');
});

test('resolveFilePreview marks chunk manifests as chunk-first', () => {
  const resolved = resolveFilePreview({
    downloadUrl: '',
    mode: 'chunks',
    reason: '当前文件暂未生成可直接预览的资源，已回退到正文分段内容。',
    sourceKind: 'none',
    supportsChunksFallback: true,
    viewerUrl: '',
  });

  assert.equal(resolved.mode, 'chunks');
  assert.equal(resolved.prefersChunks, true);
  assert.equal(resolved.reason, '当前文件暂未生成可直接预览的资源，已回退到正文分段内容。');
});

test('resolveFilePreview preserves unsupported mode and reason', () => {
  const resolved = resolveFilePreview({
    downloadUrl: 'https://example.com/original.pptx',
    mode: 'unsupported',
    reason: '当前文件类型暂不支持在线预览，请下载原文件查看。',
    sourceKind: 'none',
    supportsChunksFallback: false,
    viewerUrl: '',
  });

  assert.equal(resolved.mode, 'unsupported');
  assert.equal(resolved.downloadUrl, 'https://example.com/original.pptx');
  assert.equal(resolved.supportsChunksFallback, false);
});

test('resolveFilePreview falls back to chunks when preview manifest is missing', () => {
  const resolved = resolveFilePreview(null);

  assert.equal(resolved.mode, 'chunks');
  assert.equal(resolved.prefersChunks, true);
  assert.equal(resolved.viewerUrl, '');
});

test('resolvePreviewModalFrameUrl uses embedded detail page instead of direct asset viewer url', () => {
  const url = resolvePreviewModalFrameUrl(
    {
      id: 1580,
      spaceId: 12,
      title: '安全操作手册',
      summary: '',
      source: '团队知识库',
      date: '2026-05-31T12:00:00',
      tags: [],
      ext: 'pdf',
      sizeLabel: '',
      fileEncoding: '',
    },
    {
      downloadUrl: '/bisheng/original/1580.pdf?X-Amz-Signature=abc',
      mode: 'pdf',
      reason: '',
      sourceKind: 'original_url',
      supportsChunksFallback: true,
      viewerUrl: '/bisheng/original/1580.pdf?X-Amz-Signature=abc',
    },
  );

  assert.equal(url, '/space/12/file/1580?embed=1');
});

test('embedded preview detail page does not refetch preview when display config changes', () => {
  const source = readSource('src/pages/DetailPage.tsx');

  assert.match(source, /const relatedFilesCount = embed \|\| shareToken \? 0 : displayConfig\.detail\.relatedFilesCount;/);
  assert.match(source, /relatedFilesCount === 0\s*\?\s*Promise\.resolve\(\[\]\)/);
  assert.match(source, /\}, \[embed, fileId, relatedFilesCount, shareToken, spaceId\]\);/);
  assert.doesNotMatch(source, /\}, \[displayConfig\.detail\.relatedFilesCount, embed, fileId, shareToken, spaceId\]\);/);
});
