import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');
const listPageStyles = readFileSync('src/pages/ListPage.module.css', 'utf8');

test('list page reads keyword from URL q param', () => {
  assert.match(listPageSource, /const keyword = \(params\.get\('q'\) \|\| ''\)\.trim\(\)/);
});

test('list page passes keyword to searchFiles and highlights results', () => {
  assert.match(listPageSource, /q: keyword \|\| undefined/);
  assert.match(listPageSource, /highlightQuery=\{keyword \|\| undefined\}/);
});

test('list page submits keyword search via createSubmittedSearchParams', () => {
  assert.match(listPageSource, /createSubmittedSearchParams\(params, draft\)/);
  assert.match(listPageSource, /recordPortalSearchEvent\(submitted, 'search_page'\)/);
});

test('list page defaults to relevance sort when keyword is present', () => {
  assert.match(
    listPageSource,
    /timeSort \|\| \(keyword \? 'relevance' : \(isLatestSelectedRecommendation \? 'portal_read_count_desc' : 'updated_at_desc'\)\)/,
  );
});

test('list page renders scoped search bar and clear action', () => {
  assert.match(listPageSource, /className=\{s\.listSearchBar\}/);
  assert.match(listPageSource, /clearKeyword/);
  assert.match(listPageSource, /在「\$\{pageTitle\}」内搜索/);
  assert.match(listPageStyles, /\.listSearchBar/);
  assert.match(listPageStyles, /\.listSearchBtn/);
});
