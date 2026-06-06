import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const headerSource = readFileSync('src/components/Header.tsx', 'utf8');

test('header user menu exposes my uploads only on knowledge spaces page', () => {
  assert.match(headerSource, /我的上传/);
  assert.match(headerSource, /location\.pathname\s*===\s*['"]\/knowledge-spaces['"]/);
});

test('header my uploads action posts to visible knowledge iframe', () => {
  assert.match(headerSource, /bisheng-knowledge-frame/);
  assert.match(headerSource, /postPortalApprovalMessageToFrame\([^;]+['"]my_uploads['"]\)/s);
});
