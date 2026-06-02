import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('search result cards keep the share action commented out', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/SearchPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(source.includes('onShare={openShare}'), true);
  assert.equal(activeSource.includes('onShare={openShare}'), false);
});

test('list result cards keep the share action commented out', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/ListPage.tsx'), 'utf8');
  const activeSource = stripComments(source);

  assert.equal(source.includes('onShare={openShare}'), true);
  assert.equal(activeSource.includes('onShare={openShare}'), false);
});
