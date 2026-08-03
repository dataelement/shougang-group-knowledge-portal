import assert from 'node:assert/strict';
import test from 'node:test';

import type { PortalUser } from '../src/api/auth';
import { arePortalUsersEquivalent } from '../src/utils/portalUser';

const baseUser: PortalUser = {
  account: 'zhangsan',
  name: '张三',
  initial: 'Z',
  role: 'user',
  departmentName: '技术中心',
  externalId: 'user-001',
  loginAt: 100,
  authSource: 'unified_auth',
  isDepartmentAdmin: false,
};

test('portal users remain equivalent when only the transient login time changes', () => {
  assert.equal(arePortalUsersEquivalent(baseUser, { ...baseUser, loginAt: 200 }), true);
});

test('portal users are different when identity or permission fields change', () => {
  const changedUsers: PortalUser[] = [
    { ...baseUser, account: 'lisi' },
    { ...baseUser, role: 'admin' },
    { ...baseUser, authSource: 'password' },
    { ...baseUser, isDepartmentAdmin: true },
  ];

  for (const changedUser of changedUsers) {
    assert.equal(arePortalUsersEquivalent(baseUser, changedUser), false);
  }
});
