import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getSystemAdministratorAccessState,
  isSystemAdministrator,
} from '../src/utils/adminAccess';

const appSource = readFileSync('src/App.tsx', 'utf8');
const headerSource = readFileSync('src/components/Header.tsx', 'utf8');
const migrationPageSource = readFileSync(
  'src/pages/KnowledgeMigrationsPage.tsx',
  'utf8',
);
const migrationPageStyles = readFileSync(
  'src/pages/KnowledgeMigrationsPage.module.css',
  'utf8',
);

test('migration access accepts only strict system administrator roles', () => {
  assert.equal(isSystemAdministrator(null), false);
  assert.equal(isSystemAdministrator({ account: 'admin', role: '内部员工' }), false);
  assert.equal(isSystemAdministrator({ role: '管理员' }), false);
  assert.equal(isSystemAdministrator({ role: '系统管理员' }), true);
  assert.equal(isSystemAdministrator({ role: ' admin ' }), true);
});

test('migration route distinguishes login forbidden and allowed', () => {
  assert.equal(getSystemAdministratorAccessState(null), 'login');
  assert.equal(getSystemAdministratorAccessState({ role: '管理员' }), 'forbidden');
  assert.equal(getSystemAdministratorAccessState({ role: '系统管理员' }), 'allowed');
});

test('header places migration records after my uploads and app registers guarded route', () => {
  const uploadsAt = headerSource.indexOf('我的上传');
  const migrationAt = headerSource.indexOf('迁移记录');

  assert.ok(uploadsAt >= 0);
  assert.ok(migrationAt > uploadsAt);
  assert.match(headerSource, /isSystemAdministrator\(user\)/);
  assert.match(appSource, /function KnowledgeMigrationsRoute/);
  assert.match(appSource, /path="\/knowledge-migrations"/);
});

test('migration fullscreen page keeps a vertical scroll container', () => {
  assert.match(
    migrationPageSource,
    /<PageShell hideFooter mainClassName=\{s\.pageMain\}>/,
  );
  assert.match(
    migrationPageStyles,
    /\.pageMain\s*\{[^}]*overflow-y:\s*auto;/s,
  );
});
