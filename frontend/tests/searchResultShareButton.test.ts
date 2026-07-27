import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('search result cards do not mount legacy share creation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('onShare={openShare}'), false);
  assert.equal(activeSource.includes('ShareDocumentModal'), false);
  assert.equal(activeSource.includes('useShareDocument'), false);
});

test('list result cards do not mount legacy share creation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/ListPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(activeSource.includes('onShare={openShare}'), false);
  assert.equal(activeSource.includes('ShareDocumentModal'), false);
  assert.equal(activeSource.includes('useShareDocument'), false);
});
