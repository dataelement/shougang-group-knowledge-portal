import assert from 'node:assert/strict';
import test from 'node:test';
import { favoriteKey } from '../src/api/content';
import {
  mergeFavoriteStatuses,
  withFavoriteStatus,
  readFavoriteStatus,
  type FavoriteStatusMap,
} from '../src/utils/favoriteStatus';

test('mergeFavoriteStatuses overlays incoming entries without mutating prev', () => {
  const prev: FavoriteStatusMap = new Map([
    [favoriteKey(1, 10), true],
    [favoriteKey(1, 11), false],
  ]);
  const incoming: FavoriteStatusMap = new Map([
    [favoriteKey(1, 11), true],
    [favoriteKey(2, 20), true],
  ]);

  const merged = mergeFavoriteStatuses(prev, incoming);

  assert.equal(merged.get(favoriteKey(1, 10)), true);
  assert.equal(merged.get(favoriteKey(1, 11)), true);
  assert.equal(merged.get(favoriteKey(2, 20)), true);
  // prev untouched
  assert.equal(prev.get(favoriteKey(1, 11)), false);
  assert.equal(prev.has(favoriteKey(2, 20)), false);
});

test('withFavoriteStatus sets one key on a copy, leaving the original map unchanged', () => {
  const prev: FavoriteStatusMap = new Map([[favoriteKey(3, 30), false]]);

  const next = withFavoriteStatus(prev, 3, 30, true);

  assert.equal(next.get(favoriteKey(3, 30)), true);
  assert.equal(prev.get(favoriteKey(3, 30)), false);
  assert.notEqual(next, prev);
});

test('readFavoriteStatus returns the stored boolean and defaults to false when missing', () => {
  const map: FavoriteStatusMap = new Map([
    [favoriteKey(4, 40), true],
    [favoriteKey(4, 41), false],
  ]);

  assert.equal(readFavoriteStatus(map, 4, 40), true);
  assert.equal(readFavoriteStatus(map, 4, 41), false);
  assert.equal(readFavoriteStatus(map, 4, 999), false);
});
