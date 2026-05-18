import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileItem, FilePreviewManifest } from '../src/api/content';
import {
  closeFileDownloadWindow,
  openFileDownloadUrl,
  openFileDownloadWindow,
  resolveFileDownloadUrl,
} from '../src/utils/fileDownload';

const baseFile: FileItem = {
  id: 1580,
  spaceId: 12,
  title: 'PostgreSQL 数据库迁移指南',
  summary: '',
  source: '团队知识库',
  date: '2024-12-08T09:30:00',
  tags: [],
  ext: 'pdf',
  sizeLabel: '',
  fileEncoding: '',
};

test('resolves list card download url from file preview manifest', async () => {
  const calls: Array<[number, number]> = [];
  const preview: FilePreviewManifest = {
    downloadUrl: 'https://example.com/original.pdf',
    mode: 'pdf',
    reason: '',
    sourceKind: 'original_url',
    supportsChunksFallback: true,
    viewerUrl: '',
  };

  const url = await resolveFileDownloadUrl(baseFile, async (spaceId, fileId) => {
    calls.push([spaceId, fileId]);
    return preview;
  });

  assert.equal(url, 'https://example.com/original.pdf');
  assert.deepEqual(calls, [[12, 1580]]);
});

test('returns empty url when preview has no downloadable source', async () => {
  const url = await resolveFileDownloadUrl(baseFile, async () => null);

  assert.equal(url, '');
});

test('opens a pending download window synchronously for later navigation', () => {
  const fakeWindow = {
    location: { href: '' },
    opener: {},
    close() {},
  } as unknown as Window;

  const pendingWindow = openFileDownloadWindow((url, target) => {
    assert.equal(url, 'about:blank');
    assert.equal(target, '_blank');
    return fakeWindow;
  });

  assert.equal(pendingWindow, fakeWindow);
  assert.equal(fakeWindow.opener, null);
});

test('navigates the pending download window after the async url is available', () => {
  const fakeWindow = {
    location: { href: 'about:blank' },
    close() {},
  } as unknown as Window;

  openFileDownloadUrl('https://example.com/original.pdf', fakeWindow);

  assert.equal(fakeWindow.location.href, 'https://example.com/original.pdf');
});

test('falls back to the current window when pending download window is blocked', () => {
  let assignedUrl = '';

  openFileDownloadUrl('https://example.com/original.pdf', null, (url) => {
    assignedUrl = url;
  });

  assert.equal(assignedUrl, 'https://example.com/original.pdf');
});

test('closes the pending download window when no download url is available', () => {
  let closed = false;
  const fakeWindow = {
    location: { href: 'about:blank' },
    close() {
      closed = true;
    },
  } as unknown as Window;

  closeFileDownloadWindow(fakeWindow);

  assert.equal(closed, true);
});
