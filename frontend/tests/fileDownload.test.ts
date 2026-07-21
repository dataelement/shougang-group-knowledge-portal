import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApiRequestError,
  fetchPortalPdfDownload,
} from '../src/api/content';
import {
  buildDownloadFileName,
  downloadWatermarkedFile,
} from '../src/utils/fileDownload';

test('requests the unified PDF endpoint with credentials and download context', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const result = await fetchPortalPdfDownload(
    {
      spaceId: 12,
      fileId: 1580,
      entryPoint: 'share',
      shareToken: 'token/with spaces',
    },
    async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(new Blob(['%PDF-body'], { type: 'application/pdf' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': "attachment; filename*=UTF-8''%E9%A6%96%E9%92%A2%E6%96%87%E6%A1%A3.pdf",
        },
      });
    },
  );

  assert.deepEqual(calls, [{
    input: '/api/v1/knowledge/space/12/files/1580/download?entry_point=share&share_token=token%2Fwith+spaces',
    init: { method: 'GET', credentials: 'include' },
  }]);
  assert.equal(result.blob.type, 'application/pdf');
  assert.equal(result.fileName, '首钢文档.pdf');
});

test('parses ASCII content disposition and always builds PDF fallback names', async () => {
  const result = await fetchPortalPdfDownload(
    { spaceId: 12, fileId: 1580, entryPoint: 'detail' },
    async () => new Response(new Blob(['%PDF'], { type: 'application/pdf' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="manual.pdf"',
      },
    }),
  );

  assert.equal(result.fileName, 'manual.pdf');
  assert.equal(buildDownloadFileName({ id: 1, title: '工艺说明.docx', ext: 'docx' }), '工艺说明.pdf');
  assert.equal(buildDownloadFileName({ id: 2, title: '多版本.v2.xlsx', ext: 'xlsx' }), '多版本.v2.pdf');
  assert.equal(buildDownloadFileName({ id: 3, title: '   ', ext: '' }), 'file-3.pdf');
  assert.equal(
    buildDownloadFileName({ id: 4, title: `bad${String.fromCharCode(0)}name`, ext: '' }),
    'bad_name.pdf',
  );
});

test('surfaces JSON and non-JSON download errors without creating a Blob download', async () => {
  await assert.rejects(
    fetchPortalPdfDownload(
      { spaceId: 12, fileId: 1580, entryPoint: 'detail' },
      async () => new Response(JSON.stringify({ detail: 'PDF 产物暂不可用' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    (error: unknown) => error instanceof ApiRequestError
      && error.status === 409
      && error.message === 'PDF 产物暂不可用',
  );

  await assert.rejects(
    fetchPortalPdfDownload(
      { spaceId: 12, fileId: 1580, entryPoint: 'detail' },
      async () => new Response('gateway html', { status: 504 }),
    ),
    (error: unknown) => error instanceof ApiRequestError
      && error.status === 504
      && !error.message.includes('gateway html'),
  );
});

test('rejects a successful non-PDF response', async () => {
  await assert.rejects(
    fetchPortalPdfDownload(
      { spaceId: 12, fileId: 1580, entryPoint: 'detail' },
      async () => new Response('not pdf', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    ),
    /未返回有效的 PDF 文件/,
  );
});

test('saves the Blob with a hidden anchor and revokes the object URL', async () => {
  let clicked = false;
  let removed = false;
  const appended: unknown[] = [];
  const revoked: string[] = [];
  const fakeAnchor = {
    href: '',
    download: '',
    rel: '',
    style: { display: '' },
    click() { clicked = true; },
    remove() { removed = true; },
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

  await downloadWatermarkedFile(
    { spaceId: 12, fileId: 1580, entryPoint: 'search', title: 'fallback.docx', ext: 'docx' },
    {
      document: fakeDocument,
      fetchDownload: async () => ({
        blob: new Blob(['%PDF'], { type: 'application/pdf' }),
        fileName: '',
      }),
      createObjectURL: () => 'blob:watermarked-pdf',
      revokeObjectURL: (url) => revoked.push(url),
      scheduleRevoke: (callback) => callback(),
    },
  );

  assert.equal(fakeAnchor.href, 'blob:watermarked-pdf');
  assert.equal(fakeAnchor.download, 'fallback.pdf');
  assert.equal(fakeAnchor.rel, 'noopener');
  assert.equal(fakeAnchor.style.display, 'none');
  assert.deepEqual(appended, [fakeAnchor]);
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.deepEqual(revoked, ['blob:watermarked-pdf']);
});
