import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('search page does not render pagination or request paged search results', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);
  const callStart = activeSource.indexOf('searchFiles({');
  const callEnd = activeSource.indexOf('});', callStart);
  const searchFilesCall = activeSource.slice(callStart, callEnd);

  assert.equal(activeSource.includes("import Pagination from '../components/Pagination'"), false);
  assert.equal(activeSource.includes('<Pagination'), false);
  assert.equal(searchFilesCall.includes('page,'), false);
  assert.equal(searchFilesCall.includes('pageSize:'), false);
  assert.equal(activeSource.includes('当前显示'), false);
});

test('search page loads complete initial search results through cursor aggregation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.match(activeSource, /const SEARCH_FULL_RESULT_PAGE_SIZE = 100/);
  assert.match(activeSource, /async function fetchCompleteSearchResults/);
  assert.match(activeSource, /cursor,\s*limit:\s*SEARCH_FULL_RESULT_PAGE_SIZE/);
  assert.match(activeSource, /allFiles\.push\(\.\.\.result\.data\)/);
  assert.match(activeSource, /cursor = result\.hasMore \? result\.nextCursor : null/);
  assert.match(activeSource, /while \(cursor\)/);
});

test('search page keeps result filters local instead of passing them to search API', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);
  const fetchCallStart = activeSource.indexOf('const data = await fetchCompleteSearchResults({');
  const fetchCallEnd = activeSource.indexOf('});', fetchCallStart);
  const fetchCall = activeSource.slice(fetchCallStart, fetchCallEnd);

  assert.notEqual(fetchCallStart, -1);
  assert.match(fetchCall, /q:\s*q \|\| undefined/);
  assert.match(fetchCall, /sort,/);
  assert.doesNotMatch(fetchCall, /tag:/);
  assert.doesNotMatch(fetchCall, /spaceIds:/);
  assert.doesNotMatch(fetchCall, /spaceLevel:/);
  assert.doesNotMatch(fetchCall, /fileExt:/);
  assert.doesNotMatch(fetchCall, /documentType:/);
  assert.doesNotMatch(fetchCall, /fileSubcategoryCode:/);
  assert.doesNotMatch(fetchCall, /businessDomainCode:/);
  assert.match(activeSource, /function matchesLocalSearchFilters/);
  assert.match(activeSource, /setFiles\(filteredFiles\)/);
  assert.match(activeSource, /setTotal\(filteredFiles\.length\)/);
});

test('search page uses relevance as the default sort option', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.match(activeSource, /const sort = normalizeSearchSort\(params\.get\('sort'\)\)/);
  assert.equal(activeSource.includes('normalizeUpdatedAtSort'), false);
  assert.equal(activeSource.includes('SEARCH_SORT_OPTIONS.map'), true);
});

test('search page passes original search results into AI summary instead of filtered results', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);
  const streamCallStart = activeSource.indexOf('streamChatCompletion({');
  const streamCallEnd = activeSource.indexOf('}).finally', streamCallStart);
  const streamCall = activeSource.slice(streamCallStart, streamCallEnd);

  assert.notEqual(streamCallStart, -1);
  assert.match(streamCall, /searchResults:\s*rawFiles\.slice\(0,\s*10\)/);
  assert.doesNotMatch(streamCall, /filteredFiles/);
});

test('search page does not render AI summary source file list', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('<ol className={s.citations}>'), false);
  assert.equal(activeSource.includes('referenced.map'), false);
});

test('search page derives filter options from complete search results', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('fetchAggregatedTags'), false);
  assert.match(activeSource, /const resultSpaceLevelOptions = useMemo/);
  assert.match(activeSource, /const resultSpaceOptions = useMemo/);
  assert.match(activeSource, /const resultFileExtOptions = useMemo/);
  assert.match(activeSource, /const resultTagOptions = useMemo/);
  assert.match(activeSource, /const businessDomainOptions = useMemo/);
  assert.match(activeSource, /getFileSpaceLevel\(file, spaceById\)/);
  assert.match(activeSource, /getBusinessDomainCodeFromFileEncoding\(file\.fileEncoding\)/);
  assert.match(activeSource, /addSpaceId\(file\.spaceId\)/);
  assert.match(activeSource, /normalizeFileExt\(file\.ext\)/);
  assert.match(activeSource, /for \(const item of file\.tags\)/);
  assert.match(activeSource, /for \(const file of rawFiles\)/);
  assert.match(activeSource, /addStringOption\(levelSet, spaceLevel\)/);
  assert.match(activeSource, /addSpaceId\(selectedSpaceId\)/);
  assert.match(activeSource, /addStringOption\(extSet, normalizeFileExt\(fileExt\)\)/);
  assert.match(activeSource, /addStringOption\(tagSet, tag\)/);
  assert.match(activeSource, /resultSpaceLevelOptions\.map/);
  assert.match(activeSource, /resultSpaceOptions\.map/);
  assert.match(activeSource, /resultFileExtOptions\.map/);
  assert.match(activeSource, /businessDomainOptions\.map/);
  assert.match(activeSource, /resultTagOptions\.map/);
});
