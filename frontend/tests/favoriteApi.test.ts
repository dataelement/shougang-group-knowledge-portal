import assert from 'node:assert/strict';
import test from 'node:test';
import {
  favoriteKey, favoriteDocument, removeFavorite, fetchFavoriteStatus, fetchFavoriteFiles,
} from '../src/api/content';

function mockFetch(payload: unknown, capture?: (path: string, init?: RequestInit) => void) {
  return (async (input: unknown, init?: RequestInit) => {
    capture?.(String(input), init);
    return new Response(JSON.stringify({ status_code: 200, status_message: 'ok', data: payload }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('favoriteKey builds stable key', () => {
  assert.equal(favoriteKey(1, 2), '1:2');
});

test('favoriteDocument posts source ids and maps response', async () => {
  const orig = globalThis.fetch;
  let path = ''; let body = '';
  globalThis.fetch = mockFetch(
    { favorite_file_id: 9, space_id: 200, source_space_id: 1, source_file_id: 2, title: 'doc' },
    (p, init) => { path = p; body = String(init?.body); });
  try {
    const out = await favoriteDocument({ sourceSpaceId: 1, sourceFileId: 2 });
    assert.equal(path, '/api/v1/knowledge/favorites');
    assert.deepEqual(JSON.parse(body), { source_space_id: 1, source_file_id: 2 });
    assert.equal(out.favoriteFileId, 9);
    assert.equal(out.spaceId, 200);
  } finally { globalThis.fetch = orig; }
});

test('removeFavorite maps removed flag', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch({ removed: true });
  try {
    const out = await removeFavorite({ sourceSpaceId: 1, sourceFileId: 2 });
    assert.equal(out.removed, true);
  } finally { globalThis.fetch = orig; }
});

test('fetchFavoriteStatus returns key->bool map', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch({ data: [{ space_id: 1, file_id: 2, favorited: true }] });
  try {
    const map = await fetchFavoriteStatus([{ spaceId: 1, fileId: 2 }]);
    assert.equal(map.get('1:2'), true);
  } finally { globalThis.fetch = orig; }
});

test('fetchFavoriteStatus returns empty map for empty input without calling fetch', async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
  try {
    const map = await fetchFavoriteStatus([]);
    assert.equal(map.size, 0);
    assert.equal(called, false);
  } finally { globalThis.fetch = orig; }
});

test('fetchFavoriteFiles maps items', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = mockFetch({ data: [{ favorite_file_id: 9, source_space_id: 1, source_file_id: 2,
    title: 'doc', file_name: 'doc.pdf', status: 'invalid', updated_at: '' }], total: 1, page: 1, page_size: 20 });
  try {
    const out = await fetchFavoriteFiles({ page: 1, pageSize: 20 });
    assert.equal(out.total, 1);
    assert.equal(out.data[0].status, 'invalid');
  } finally { globalThis.fetch = orig; }
});
