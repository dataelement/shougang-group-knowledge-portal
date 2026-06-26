import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileItem, FilePreviewManifest } from '../src/api/content';
import {
  buildDownloadFileName,
  openFileDownloadUrl,
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
  tag_infos: [],
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

test('builds download filename from document title and extension', () => {
  assert.equal(buildDownloadFileName(baseFile), 'PostgreSQL 数据库迁移指南.pdf');
  assert.equal(buildDownloadFileName({ ...baseFile, title: '工艺说明.docx', ext: 'docx' }), '工艺说明.docx');
  assert.equal(buildDownloadFileName({ ...baseFile, title: '   ', ext: '' }), 'file-1580');
});

test('triggers browser download with a hidden link and document filename', () => {
  let clicked = false;
  let removed = false;
  const appended: unknown[] = [];
  const fakeAnchor = {
    href: '',
    download: '',
    rel: '',
    style: { display: '' },
    click() {
      clicked = true;
    },
    remove() {
      removed = true;
    },
  } as unknown as HTMLAnchorElement;
  const fakeDocument = {
    body: {
      appendChild(node: unknown) {
        appended.push(node);
        return node;
      },
    },
    createElement(tagName: string) {
      assert.equal(tagName, 'a');
      return fakeAnchor;
    },
  } as unknown as Document;

  openFileDownloadUrl('https://example.com/original.pdf', 'PostgreSQL 数据库迁移指南.pdf', {
    document: fakeDocument,
  });

  assert.equal(fakeAnchor.href, 'https://example.com/original.pdf');
  assert.equal(fakeAnchor.download, 'PostgreSQL 数据库迁移指南.pdf');
  assert.equal(fakeAnchor.rel, 'noopener');
  assert.equal(fakeAnchor.style.display, 'none');
  assert.deepEqual(appended, [fakeAnchor]);
  assert.equal(clicked, true);
  assert.equal(removed, true);
});

test('falls back to the current window when document is unavailable', () => {
  let assignedUrl = '';

  openFileDownloadUrl('https://example.com/original.pdf', 'original.pdf', {
    assignCurrentLocation(url) {
      assignedUrl = url;
    },
  });

  assert.equal(assignedUrl, 'https://example.com/original.pdf');
});
