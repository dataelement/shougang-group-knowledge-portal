import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const contentSource = readFileSync('src/api/content.ts', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');

test('hot search API reads BiSheng-backed endpoint', () => {
  assert.match(contentSource, /fetchHotSearches\(\): Promise<PortalHotSearchItem\[]>/);
  assert.match(contentSource, /\/api\/v1\/knowledge\/hot-searches/);
});

test('home page hides hot search when list is empty', () => {
  assert.match(homeSource, /fetchHotSearches\(\)/);
  assert.match(homeSource, /showHotSearch = searchTab === 'global' && hotSearches\.length > 0/);
  assert.doesNotMatch(homeSource, /qa\.hot_questions/);
  assert.doesNotMatch(homeSource, /暂无热门问题/);
});
