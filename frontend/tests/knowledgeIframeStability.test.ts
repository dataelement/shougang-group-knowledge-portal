import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pageSource = readFileSync('src/pages/KnowledgeSpacesPage.tsx', 'utf8');

test('knowledge iframe waits for auth and both configuration sources to settle', () => {
  assert.match(pageSource, /ensureAuthSynced\(\)/);
  assert.match(pageSource, /runtimeConfigSettled/);
  assert.match(pageSource, /portalConfigLoading/);
  assert.match(pageSource, /const iframeReady\s*=/);
  assert.match(pageSource, /iframeReady\s*\?\s*\(\s*<iframe/);
});

test('knowledge iframe auth failures trigger one parent login recovery', () => {
  assert.match(pageSource, /shougang-portal:auth-required/);
  assert.match(pageSource, /event\.source !== frameRef\.current\?\.contentWindow/);
  assert.match(pageSource, /loginRedirectedRef/);
});
