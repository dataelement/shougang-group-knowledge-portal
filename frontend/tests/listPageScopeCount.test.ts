import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');

test('domain/category list pages reuse homepage scope count APIs', () => {
  assert.match(listPageSource, /fetchDomainFileCounts\(\)/);
  assert.match(listPageSource, /fetchCategoryFileCounts\(\)/);
  assert.match(listPageSource, /scopeDocumentCountLoading \? '加载中…'/);
  assert.match(listPageSource, /hasListScopeFilters\(params, businessDomainFilter\)/);
  assert.match(listPageSource, /displayedDocumentCountLabel/);
});
