import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const loginSource = readFileSync('src/pages/LoginPage.tsx', 'utf8');
const bootstrapApiSource = readFileSync('src/api/bootstrap.ts', 'utf8');

test('app exposes a dedicated bisheng bootstrap route', () => {
  assert.match(appSource, /BootstrapBishengPage/);
  assert.match(appSource, /<Route path="\/bootstrap\/bisheng" element={<BootstrapBishengPage \/>}/);
});

test('login page offers bootstrap entry only after backend status requires it', () => {
  assert.match(loginSource, /fetchBishengBootstrapStatus/);
  assert.match(loginSource, /bootstrapRequired/);
  assert.match(loginSource, /\/bootstrap\/bisheng/);
});

test('bootstrap api client uses unauthenticated status and save endpoints', () => {
  assert.match(bootstrapApiSource, /\/api\/v1\/bootstrap\/bisheng\/status/);
  assert.match(bootstrapApiSource, /\/api\/v1\/bootstrap\/bisheng/);
  assert.doesNotMatch(bootstrapApiSource, /\/api\/v1\/admin\/config\/bisheng/);
});
