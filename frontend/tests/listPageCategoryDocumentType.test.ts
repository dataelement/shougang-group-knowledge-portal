import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');

test('category landing page locks document_type from route/category code in searchFiles', () => {
  assert.match(listPageSource, /const routeCategoryCode = normalizeDocumentTypeCode\(categoryCodeParam\)/);
  assert.match(listPageSource, /const lockedCategoryDocumentType = isCategoryList \? \(categoryCode \|\| routeCategoryCode\) : ''/);
  assert.match(listPageSource, /documentType: lockedCategoryDocumentType/);
  assert.match(listPageSource, /documentType: isCategoryList \? undefined : \(documentType \|\| undefined\)/);
});

test('category landing page syncs document_type into URL query params', () => {
  assert.match(listPageSource, /next\.set\('document_type', lockedCategoryDocumentType\)/);
  assert.match(listPageSource, /setParams\(next, \{ replace: true \}\)/);
});
