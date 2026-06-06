import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDomainSearchPath,
  buildTagSearchPath,
  createDomainFilterSearchParams,
  createSubmittedSearchParams,
  getSearchDisplayKeyword,
  hasSearchContext,
} from '../src/utils/searchParams';

test('domain navigation uses prefill without creating a keyword query', () => {
  assert.equal(
    buildDomainSearchPath('生产'),
    '/search?domain=%E7%94%9F%E4%BA%A7&prefill=%E7%94%9F%E4%BA%A7',
  );
});

test('hot search navigation uses tag filtered search results', () => {
  assert.equal(
    buildTagSearchPath('废料'),
    '/search?tag=%E5%BA%9F%E6%96%99&prefill=%E5%BA%9F%E6%96%99',
  );
});

test('search display keyword falls back to prefill while real query stays empty', () => {
  const params = new URLSearchParams('domain=%E7%94%9F%E4%BA%A7&prefill=%E7%94%9F%E4%BA%A7&page=1');

  assert.equal(getSearchDisplayKeyword(params), '生产');
  assert.equal(params.get('q') || '', '');
  assert.equal(hasSearchContext(params), true);
});

test('submitting a search promotes draft text to q and clears prefill', () => {
  const params = new URLSearchParams('domain=%E7%94%9F%E4%BA%A7&prefill=%E7%94%9F%E4%BA%A7&page=3');
  const next = createSubmittedSearchParams(params, '轧机');

  assert.equal(next.get('q'), '轧机');
  assert.equal(next.get('domain'), '生产');
  assert.equal(next.get('prefill'), null);
  assert.equal(next.get('page'), null);
});

test('domain filter changes keep prefill aligned only before real keyword search', () => {
  const fromNavigation = new URLSearchParams('domain=%E7%94%9F%E4%BA%A7&prefill=%E7%94%9F%E4%BA%A7&page=2');
  const changed = createDomainFilterSearchParams(fromNavigation, '设备');

  assert.equal(changed.get('domain'), '设备');
  assert.equal(changed.get('prefill'), '设备');
  assert.equal(changed.get('page'), null);

  const cleared = createDomainFilterSearchParams(changed, '');
  assert.equal(cleared.get('domain'), null);
  assert.equal(cleared.get('prefill'), null);

  const afterKeywordSearch = new URLSearchParams('q=%E8%BD%A7%E6%9C%BA&domain=%E7%94%9F%E4%BA%A7&prefill=%E7%94%9F%E4%BA%A7');
  const keywordFiltered = createDomainFilterSearchParams(afterKeywordSearch, '设备');
  assert.equal(keywordFiltered.get('q'), '轧机');
  assert.equal(keywordFiltered.get('domain'), '设备');
  assert.equal(keywordFiltered.get('prefill'), null);
});
