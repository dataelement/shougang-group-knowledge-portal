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

test('search page refreshes aggregated tags only when space scope changes', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);
  const tagsCall = activeSource.indexOf('fetchAggregatedTags(');
  const effectStart = activeSource.lastIndexOf('useEffect(() =>', tagsCall);
  const depsStart = activeSource.indexOf('}, [', tagsCall);
  const depsEnd = activeSource.indexOf(']);', depsStart);
  const tagsEffect = activeSource.slice(effectStart, depsEnd);
  const deps = activeSource.slice(depsStart, depsEnd);

  assert.notEqual(tagsCall, -1);
  assert.notEqual(effectStart, -1);
  assert.equal(tagsEffect.includes('searchFiles({'), false);
  assert.equal(deps.includes('q'), false);
  assert.equal(deps.includes('sort'), false);
  assert.equal(deps.includes('fileExt'), false);
  assert.equal(deps.includes('tag'), false);
  assert.match(deps, /sids/);
  assert.match(deps, /spaceLevel/);
});
