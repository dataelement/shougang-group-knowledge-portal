import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const contentSource = readFileSync('src/api/content.ts', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');

test('hot search API reads BiSheng-backed endpoint', () => {
  assert.match(contentSource, /fetchHotSearches\(\): Promise<PortalHotSearchItem\[]>/);
  assert.match(contentSource, /\/api\/v1\/knowledge\/hot-searches/);
});

test('home page falls back to qa.hot_questions when auto hot search is empty', () => {
  assert.match(homeSource, /fetchHotSearches\(\)/);
  assert.match(homeSource, /config\?\.qa\.hot_questions/);
  assert.match(homeSource, /hotSearches\.length > 0 \? hotSearches\.map/);
  assert.match(homeSource, /showHotSearch = searchTab === 'global' && displayHotQueries\.length > 0/);
});
