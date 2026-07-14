import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const source = stripComments(readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8'));

test('keyword mode requests one fixed result set and renders it in configured batches', () => {
  assert.match(source, /searchKeywordFiles\(\{ q: q\.trim\(\), sort: keywordSort \}\)/);
  assert.doesNotMatch(source, /fetchCompleteSearchResults/);
  assert.match(source, /filteredFiles\.slice\(0, visibleLimit\)/);
  assert.match(source, /current \+ pageLimit/);
  assert.match(source, /function matchesLocalSearchFilters/);
  assert.match(source, /searchResults:\s*rawFiles\.slice\(0,\s*10\)/);
});

test('browse mode sends all filters to the dedicated cursor endpoint', () => {
  const callStart = source.indexOf('return browseSearchFiles({');
  const callEnd = source.indexOf('});', callStart);
  const call = source.slice(callStart, callEnd);

  assert.notEqual(callStart, -1);
  assert.match(call, /tag:/);
  assert.match(call, /spaceIds:/);
  assert.match(call, /spaceLevel:/);
  assert.match(call, /fileExt:/);
  assert.match(call, /documentType:/);
  assert.match(call, /fileSubcategoryCode:/);
  assert.match(call, /businessDomainCode:/);
  assert.match(call, /sort:\s*browseSort/);
  assert.match(call, /cursor/);
  assert.doesNotMatch(call, /limit:/);
});

test('browse mode uses cursor lazy loading, stable deduplication, stale request guards and retry', () => {
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /`\$\{file\.spaceId\}:\$\{file\.id\}`/);
  assert.match(source, /requestSeq\.current !== currentRequest/);
  assert.match(source, /setLoadMoreError/);
  assert.match(source, />重试<\/button>/);
  assert.match(source, /已加载/);
});

test('the two modes expose different summary, sort and filter option semantics', () => {
  assert.match(source, /keywordMode && \(\(\) =>/);
  assert.match(source, /keywordMode \? SEARCH_SORT_OPTIONS : TIME_SORT_OPTIONS/);
  assert.match(source, /if \(!keywordMode\) return documentTypeGroups/);
  assert.match(source, /if \(!keywordMode\) return configuredBusinessDomainOptions/);
  assert.match(source, /fetchAggregatedTags/);
  assert.match(source, /setAvailableTags/);
  assert.match(source, /fetchKnowledgeSpaces/);
});

test('search page normalizes invalid empty-mode sort and page size', () => {
  assert.match(source, /normalizeTimeSort\(params\.get\('sort'\)\) \|\| 'updated_at_desc'/);
  assert.match(source, /configuredPageSize >= 1 && configuredPageSize <= 100/);
  assert.match(source, /DEFAULT_SEARCH_PAGE_SIZE = 10/);
  assert.match(source, /setFilter\('sort', browseSort, false\)/);
});

test('home search submits both empty and keyword input', () => {
  const homeSource = stripComments(readFileSync(resolve(process.cwd(), 'src/pages/HomePage.tsx'), 'utf8'));
  assert.match(homeSource, /navigate\(keyword \? `\/search\?q=\$\{encodeURIComponent\(keyword\)\}` : '\/search'\)/);
});
