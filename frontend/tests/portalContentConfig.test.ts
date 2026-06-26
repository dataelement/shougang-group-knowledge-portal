import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchSpaceFiles,
  fetchHomeContent,
  fetchPortalContentConfig,
  invalidatePortalContentConfigCache,
  searchFiles,
} from '../src/api/content';

const portalConfigPayload = {
  site: {},
  integrations: {},
  spaces: [],
  domains: [],
  sections: [],
  qa: { knowledge_space_ids: [], hot_questions: [] },
  apps: [],
  banners: [],
  recommendation: {},
  display: {},
};

test('portal content config shares concurrent requests', async () => {
  invalidatePortalContentConfigCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/knowledge/config');
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: portalConfigPayload,
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      fetchPortalContentConfig(),
      fetchPortalContentConfig(),
    ]);

    assert.equal(calls, 1);
    assert.equal(first, second);
  } finally {
    invalidatePortalContentConfigCache();
    globalThis.fetch = originalFetch;
  }
});

test('portal content config handles empty error responses without native json parse failure', async () => {
  invalidatePortalContentConfigCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 502 })) as typeof fetch;

  try {
    await assert.rejects(
      fetchPortalContentConfig(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, '服务连接异常，请稍后重试。');
        assert.equal((err as { status?: number }).status, 502);
        return true;
      },
    );
  } finally {
    invalidatePortalContentConfigCache();
    globalThis.fetch = originalFetch;
  }
});

test('home content maps section file DTOs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/knowledge/home');
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: {
        sections: {
          最新精选: [
            {
              id: 1580,
              space_id: 12,
              title: '热轧1580产线精轧机振动纹治理实践',
              summary: '振动纹治理实践摘要',
              source: '轧线技术案例库',
              updated_at: '2026-04-13T10:30:00',
              tags: ['最新精选'],
              file_ext: 'pdf',
              file_size: '949.33KB',
              file_encoding: 'GF-ZD-SC-202604-01201',
            },
          ],
        },
        tags: ['最新精选'],
      },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await fetchHomeContent();

    assert.equal(result.sections['最新精选'][0].spaceId, 12);
    assert.equal(result.sections['最新精选'][0].title, '热轧1580产线精轧机振动纹治理实践');
    assert.deepEqual(result.tags, ['最新精选']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('file search sends document type query parameter', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(
      String(input),
      '/api/v1/knowledge/files?space_level=department&file_ext=pdf&document_type=RPT&sort=updated_at_desc&page=1&page_size=10&space_ids=12',
    );
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: { data: [], total: 0, page: 1, page_size: 10 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await searchFiles({
      spaceIds: [12],
      spaceLevel: 'department',
      fileExt: 'pdf',
      documentType: 'RPT',
      sort: 'updated_at_desc',
      page: 1,
      pageSize: 10,
    });

    assert.equal(result.total, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('space file list sends document type query parameter', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/knowledge/space/12/files?document_type=STD&page=2&page_size=10');
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: { data: [], total: 0, page: 2, page_size: 10 },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await fetchSpaceFiles({
      spaceId: 12,
      documentType: 'STD',
      page: 2,
      pageSize: 10,
    });

    assert.equal(result.page, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
