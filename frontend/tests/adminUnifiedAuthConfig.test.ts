import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminApiSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const restAuthSectionSource = readFileSync('src/pages/admin/RestAuthAdminSection.tsx', 'utf8');

test('admin config api still exposes unified auth runtime helpers for backend compatibility', () => {
  assert.match(adminApiSource, /interface UnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /fetchUnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /updateUnifiedAuthRuntimeConfig/);
  assert.match(adminApiSource, /\/api\/v1\/admin\/config\/unified-auth/);
});

test('admin unified auth page only exposes REST configuration UI', () => {
  assert.match(adminPageSource, /统一认证/);
  assert.match(adminPageSource, /RestAuthAdminSection/);
  assert.match(adminPageSource, /fetchRestAuthRuntimeConfig/);
  assert.doesNotMatch(adminPageSource, /UnifiedAuthConfigTable/);
  assert.doesNotMatch(adminPageSource, /UnifiedAuthEditorDialog/);
  assert.doesNotMatch(adminPageSource, /fetchUnifiedAuthRuntimeConfig/);
  assert.doesNotMatch(adminPageSource, /OAuth 配置/);
  assert.match(restAuthSectionSource, /统一认证 REST 配置/);
  assert.match(restAuthSectionSource, /rest_base_url/);
});
