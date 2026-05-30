import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAdminLoginRedirect,
  getAdminAccessState,
  isPortalAdmin,
} from '../src/utils/adminAccess';

const appSource = readFileSync('src/App.tsx', 'utf8');
const headerSource = readFileSync('src/components/Header.tsx', 'utf8');

test('admin access allows only configured administrator roles', () => {
  const adminAccountUser = { account: 'admin', role: '内部员工' };
  const adminAccountUserWithSpaces = { account: ' Admin ', role: '内部员工' };

  assert.equal(isPortalAdmin(null), false);
  assert.equal(isPortalAdmin({ role: '设备管理部' }), false);
  assert.equal(isPortalAdmin({ role: '内部员工' }), false);
  assert.equal(isPortalAdmin({ role: 'admin' }), true);
  assert.equal(isPortalAdmin({ role: ' admin ' }), true);
  assert.equal(isPortalAdmin({ role: '管理员' }), true);
  assert.equal(isPortalAdmin({ role: '系统管理员' }), true);
  assert.equal(isPortalAdmin({ role: ' 管理员 ' }), true);
  assert.equal(isPortalAdmin(adminAccountUser), true);
  assert.equal(isPortalAdmin(adminAccountUserWithSpaces), true);
});

test('admin route access distinguishes anonymous, forbidden, and allowed users', () => {
  const adminAccountUser = { account: 'admin', role: '内部员工' };

  assert.equal(getAdminAccessState(null), 'login');
  assert.equal(getAdminAccessState({ role: '设备管理部' }), 'forbidden');
  assert.equal(getAdminAccessState(adminAccountUser), 'allowed');
  assert.equal(getAdminAccessState({ role: 'admin' }), 'allowed');
  assert.equal(getAdminAccessState({ role: '管理员' }), 'allowed');
});

test('admin login redirect preserves the requested admin URL', () => {
  assert.equal(
    buildAdminLoginRedirect('/admin', '?tab=site'),
    '/login?redirect=%2Fadmin%3Ftab%3Dsite',
  );
});

test('header and app use the shared admin access guard', () => {
  assert.match(headerSource, /isPortalAdmin\(user\)/);
  assert.match(appSource, /function AdminRoute/);
  assert.match(appSource, /getAdminAccessState\(user\)/);
  assert.match(appSource, /<Route path="\/admin" element={<AdminRoute \/>}/);
});
