import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');

test('category landing page puts the secondary category filter first', () => {
  const categoryFilterIndex = listPageSource.indexOf('{isCategoryList ? documentTypeFilter : null}');
  const knowledgeTypeFilterIndex = listPageSource.indexOf('value={spaceLevel}');

  assert.notEqual(categoryFilterIndex, -1);
  assert.notEqual(knowledgeTypeFilterIndex, -1);
  assert.ok(categoryFilterIndex < knowledgeTypeFilterIndex);
  assert.ok(listPageSource.includes('{!isCategoryList ? documentTypeFilter : null}'));
});

test('category landing page labels the business domain filter correctly', () => {
  assert.ok(listPageSource.includes('<option value="">业务域</option>'));
  assert.ok(!listPageSource.includes("'作用域'"));
});
