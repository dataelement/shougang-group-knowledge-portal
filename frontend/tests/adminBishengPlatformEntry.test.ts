import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSafeExternalHttpUrl } from '../src/utils/adminIntegrations';

const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const adminConfigSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const portalConfigSchemaSource = readFileSync(
  '../backend/app/schemas/portal_config.py',
  'utf8',
);

assert.equal(getSafeExternalHttpUrl(' https://platform.example.com/admin '), 'https://platform.example.com/admin');
assert.equal(getSafeExternalHttpUrl('http://platform.example.com/admin'), 'http://platform.example.com/admin');
assert.equal(getSafeExternalHttpUrl('javascript:alert(1)'), '');
assert.equal(getSafeExternalHttpUrl('https://user:password@platform.example.com/admin'), '');
assert.equal(getSafeExternalHttpUrl('not-a-url'), '');

assert.match(adminConfigSource, /bisheng_platform_admin_url: string/);
assert.match(portalConfigSchemaSource, /bisheng_platform_admin_url: str = ""/);
assert.match(adminPageSource, />\s*BiSheng 管理后台\s*</);
assert.match(adminPageSource, /请先在集成配置中配置 BiSheng 管理后台 URL/);
assert.match(adminPageSource, /window\.open\(safeUrl, '_blank', 'noopener,noreferrer'\)/);
assert.match(
  adminPageSource,
  /value=\{draft\.bisheng_platform_admin_url\}[\s\S]*bisheng_platform_admin_url: event\.target\.value/,
);

console.log('adminBishengPlatformEntry.test.ts passed');
