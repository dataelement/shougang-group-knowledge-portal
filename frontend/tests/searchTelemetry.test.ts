import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const contentSource = readFileSync('src/api/content.ts', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const searchSource = readFileSync('src/pages/SearchPage.tsx', 'utf8');

test('search telemetry API accepts only explicit entry points', () => {
  assert.match(contentSource, /entryPoint: 'search_page' \| 'home_hot_keyword'/);
  assert.match(contentSource, /\/api\/v1\/knowledge\/telemetry\/search/);
});

test('home search and hot keyword clicks report once at their handlers', () => {
  assert.match(homeSource, /recordPortalSearchEvent\(keyword, 'search_page'\)/);
  assert.match(homeSource, /recordPortalSearchEvent\(item\.query, 'home_hot_keyword'\)/);
});

test('search page reports only from submitSearch and tags preview as search', () => {
  const submitSearch = searchSource.slice(
    searchSource.indexOf('const submitSearch'),
    searchSource.indexOf('return (', searchSource.indexOf('const submitSearch')),
  );
  assert.match(submitSearch, /recordPortalSearchEvent\(submittedQuery, 'search_page'\)/);
  assert.match(searchSource, /context=\{\{ entryPoint: 'search', recommendationScene: null \}\}/);
  assert.doesNotMatch(searchSource, /setFilter\([^)]*recordPortalSearchEvent/);
});
