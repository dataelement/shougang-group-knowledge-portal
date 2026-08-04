import assert from 'node:assert/strict';
import test from 'node:test';

import { formatScopeCount } from '../src/utils/formatScopeCount.ts';

test('formatScopeCount keeps small values as-is', () => {
  assert.equal(formatScopeCount(0), '0');
  assert.equal(formatScopeCount(999), '999');
});

test('formatScopeCount formats 千 tier', () => {
  assert.equal(formatScopeCount(1000), '1千');
  assert.equal(formatScopeCount(1500), '1.5千');
  assert.equal(formatScopeCount(9000), '9千');
  assert.equal(formatScopeCount(9999), '10.0千');
});

test('formatScopeCount formats 万 tier', () => {
  assert.equal(formatScopeCount(10000), '1万');
  assert.equal(formatScopeCount(15000), '1.5万');
  assert.equal(formatScopeCount(100000), '10万');
});
