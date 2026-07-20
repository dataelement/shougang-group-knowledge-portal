import assert from 'node:assert/strict';
import test from 'node:test';
import { browseSearchFiles, searchFiles, searchKeywordFiles } from '../src/api/content';

test('keyword search uses the dedicated endpoint without pagination parameters', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/knowledge/files/search?q=%E6%8C%AF%E5%8A%A8%E7%BA%B9&sort=relevance');
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: { data: [], has_more: false, next_cursor: null },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await searchKeywordFiles({ q: '振动纹', sort: 'relevance' });
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('empty search browse uses the dedicated endpoint and forwards filters and cursor', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(
      String(input),
      '/api/v1/knowledge/files/browse?tag=%E7%83%AD%E8%BD%A7&space_level=public&file_ext=pdf&document_type=RPT&file_subcategory_code=RPT-A&business_domain_code=PM&sort=updated_at_desc&cursor=next-1&space_ids=12',
    );
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: { data: [], has_more: true, next_cursor: 'next-2' },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await browseSearchFiles({
      tag: '热轧',
      spaceIds: [12],
      spaceLevel: 'public',
      fileExt: 'pdf',
      documentType: 'RPT',
      fileSubcategoryCode: 'RPT-A',
      businessDomainCode: 'PM',
      sort: 'updated_at_desc',
      cursor: 'next-1',
    });
    assert.equal(result.hasMore, true);
    assert.equal(result.nextCursor, 'next-2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public section list forwards the public-only scope', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(
      String(input),
      '/api/v1/knowledge/files?tag=%E8%A1%8C%E4%B8%9A%E6%83%85%E6%8A%A5&public_only=true&sort=updated_at_desc&limit=20',
    );
    return new Response(JSON.stringify({
      status_code: 200,
      status_message: 'OK',
      data: { data: [], has_more: false, next_cursor: null },
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await searchFiles({
      tag: '行业情报',
      publicOnly: true,
      sort: 'updated_at_desc',
      limit: 20,
    });
    assert.equal(result.hasMore, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
