import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminConfigSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('admin config api exposes import and export helpers', () => {
  assert.match(adminConfigSource, /exportAdminConfig/);
  assert.match(adminConfigSource, /importAdminConfig/);
  assert.match(adminConfigSource, /\/api\/v1\/admin\/config\/export/);
  assert.match(adminConfigSource, /\/api\/v1\/admin\/config\/import/);
  assert.match(adminConfigSource, /FormData/);
  assert.match(adminConfigSource, /response\.blob\(\)/);
});

test('admin page exposes config import export controls with overwrite confirmation', () => {
  assert.match(adminPageSource, /导出配置/);
  assert.match(adminPageSource, /导入配置/);
  assert.match(adminPageSource, /确认导入配置/);
  assert.match(adminPageSource, /全量覆盖/);
  assert.match(adminPageSource, /api_token/);
  assert.match(adminPageSource, /重新输入密码/);
});
