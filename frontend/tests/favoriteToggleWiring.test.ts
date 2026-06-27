import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('useFavoriteDocument hook performs two-state toggle with optimistic rollback', () => {
  const source = readSource('src/hooks/useFavoriteDocument.ts');

  assert.match(source, /favoriteDocument\(/);
  assert.match(source, /removeFavorite\(/);
  assert.match(source, /fetchFavoriteStatus\(/);
  // optimistic flip then rollback on error
  assert.match(source, /withFavoriteStatus\(prev, file\.spaceId, file\.id, !wasFav\)/);
  assert.match(source, /withFavoriteStatus\(prev, file\.spaceId, file\.id, wasFav\)/);
});

test('FileListItem renders a two-state favorite button', () => {
  const source = readSource('src/components/FileListItem.tsx');

  assert.match(source, /aria-pressed=\{favorited\}/);
  assert.match(source, /favorited \? '取消收藏' : '收藏文档'/);
  assert.match(source, /fill=\{favorited \? 'currentColor' : 'none'\}/);
  assert.match(source, /disabled=\{favoritePending\}/);
  assert.match(source, /favoritePending\?: boolean/);
});

test('ListPage wires the favorite toggle with login gating and removes the modal', () => {
  const source = readSource('src/pages/ListPage.tsx');
  const activeSource = stripComments(source);

  assert.match(source, /const canFavorite = Boolean\(user\)/);
  assert.match(source, /loadStatuses\(/);
  assert.match(source, /onFavorite=\{canFavorite \? handleToggleFavorite : undefined\}/);
  assert.equal(activeSource.includes('FavoriteDocumentModal'), false);
});

test('ListPage surfaces favorite toggle failures via setError', () => {
  const source = readSource('src/pages/ListPage.tsx');

  assert.match(source, /const handleToggleFavorite = useCallback\(async \(file: FileItem\) =>/);
  assert.match(source, /await toggleFavorite\(file\)/);
  assert.match(source, /catch \(err\) \{\s*setError\(/);
});

test('SearchPage wires the favorite toggle with login gating and removes the modal', () => {
  const source = readSource('src/pages/SearchPage.tsx');
  const activeSource = stripComments(source);

  assert.match(source, /const canFavorite = Boolean\(user\)/);
  assert.match(source, /loadStatuses\(/);
  assert.match(source, /onFavorite=\{canFavorite \? handleToggleFavorite : undefined\}/);
  assert.equal(activeSource.includes('FavoriteDocumentModal'), false);
});

test('SearchPage surfaces favorite toggle failures via setError', () => {
  const source = readSource('src/pages/SearchPage.tsx');

  assert.match(source, /const handleToggleFavorite = useCallback\(async \(file: FileItem\) =>/);
  assert.match(source, /await toggleFavorite\(file\)/);
  assert.match(source, /catch \(err\) \{\s*setError\(/);
});
