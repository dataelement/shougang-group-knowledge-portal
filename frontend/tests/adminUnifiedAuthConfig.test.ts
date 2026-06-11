import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminApiSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('admin config api exposes unified auth runtime config helpers', () => {
  assert.match(adminApiSource, /interface UnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /fetchUnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /updateUnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /\/api\/v1\/admin\/config\/unified-auth/);
});

test('admin page contains unified auth config navigation and editor wiring', () => {
  assert.match(adminPageSource, /统一认证/);
  assert.match(adminPageSource, /UnifiedAuthConfigTable/);
  assert.match(adminPageSource, /UnifiedAuthEditorDialog/);
  assert.match(adminPageSource, /fetchUnifiedAuthRuntimeConfig/);
  assert.match(adminPageSource, /updateUnifiedAuthRuntimeConfig/);
  assert.match(adminPageSource, /login_sync_hmac_secret/);
  assert.match(adminPageSource, /client_id/);
  assert.match(adminPageSource, /redirect_uri/);
  assert.match(adminPageSource, /response_type=code/);
  assert.match(adminPageSource, /state 由后端动态生成/);
});
