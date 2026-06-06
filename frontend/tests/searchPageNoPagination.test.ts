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
  const callEnd = activeSource.indexOf('}),', callStart);
  const searchFilesCall = activeSource.slice(callStart, callEnd);

  assert.equal(activeSource.includes("import Pagination from '../components/Pagination'"), false);
  assert.equal(activeSource.includes('<Pagination'), false);
  assert.equal(searchFilesCall.includes('page,'), false);
  assert.equal(searchFilesCall.includes('pageSize'), false);
  assert.equal(activeSource.includes('当前显示'), false);
});

test('search page passes search results into AI summary instead of triggering independent retrieval', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);
  const streamCallStart = activeSource.indexOf('streamChatCompletion({');
  const streamCallEnd = activeSource.indexOf('}).finally', streamCallStart);
  const streamCall = activeSource.slice(streamCallStart, streamCallEnd);

  assert.notEqual(streamCallStart, -1);
  assert.match(streamCall, /searchResults:\s*result\.data\.slice\(0,\s*10\)/);
});

test('search page does not render AI summary source file list', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('<ol className={s.citations}>'), false);
  assert.equal(activeSource.includes('referenced.map'), false);
});

test('search page derives filter options from current search results', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('fetchAggregatedTags'), false);
  assert.match(activeSource, /const resultSpaceLevelOptions = useMemo/);
  assert.match(activeSource, /const resultSpaceOptions = useMemo/);
  assert.match(activeSource, /const resultFileExtOptions = useMemo/);
  assert.match(activeSource, /const resultTagOptions = useMemo/);
  assert.match(activeSource, /spaceById\.get\(file\.spaceId\)\?\.spaceLevel/);
  assert.match(activeSource, /addSpaceId\(file\.spaceId\)/);
  assert.match(activeSource, /normalizeFileExt\(file\.ext\)/);
  assert.match(activeSource, /for \(const item of file\.tags\)/);
  assert.match(activeSource, /addStringOption\(levelSet, spaceLevel\)/);
  assert.match(activeSource, /addSpaceId\(selectedSpaceId\)/);
  assert.match(activeSource, /addStringOption\(extSet, normalizeFileExt\(fileExt\)\)/);
  assert.match(activeSource, /addStringOption\(tagSet, tag\)/);
  assert.match(activeSource, /resultSpaceLevelOptions\.map/);
  assert.match(activeSource, /resultSpaceOptions\.map/);
  assert.match(activeSource, /resultFileExtOptions\.map/);
  assert.match(activeSource, /resultTagOptions\.map/);
});
