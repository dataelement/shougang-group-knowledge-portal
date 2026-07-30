import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('home and result pages share the advanced search panel and disable ordinary search controls', () => {
  const homeSource = readSource('src/pages/HomePage.tsx');
  const searchSource = readSource('src/pages/SearchPage.tsx');

  assert.match(homeSource, /<AdvancedSearchPanel/);
  assert.match(searchSource, /<AdvancedSearchPanel/);
  assert.match(homeSource, /disabled=\{advancedSearchOpen && searchTab === 'global'\}/);
  assert.match(searchSource, /disabled=\{advancedSearchOpen\}/);
  assert.match(searchSource, /onSubmit=\{submitAdvancedSearch\}/);
  assert.match(searchSource, /advancedMode = params\.has\('search_field'\)/);
  assert.match(searchSource, /advancedSearchFiles\(\{/);
  assert.match(searchSource, /Boolean\(q\.trim\(\)\) && !advancedMode/);
  assert.match(searchSource, /resolveFileActionAccess\(\s*file,\s*'favorite'/);
  assert.match(searchSource, /resolveFileActionAccess\(\s*file,\s*'download'/);
  assert.match(searchSource, /onDownload=\{canDownload \? handleDownload : undefined\}/);
  assert.match(searchSource, /file\.contentAccess !== 'check_required'/);
});
