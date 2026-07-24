import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getPortalAuthNoticeMessage,
  PORTAL_AUTH_NOTICE_PARAM,
  PORTAL_AUTH_NOTICE_USER_UNREGISTERED,
  stripPortalAuthNoticeFromSearch,
} from '../src/utils/portalAuthNotice';

const appSource = readFileSync('src/App.tsx', 'utf8');
const noticeHostSource = readFileSync('src/components/PortalAuthNoticeHost.tsx', 'utf8');

test('portal auth notice helper maps user_unregistered to Chinese copy', () => {
  assert.equal(
    getPortalAuthNoticeMessage(PORTAL_AUTH_NOTICE_USER_UNREGISTERED),
    '您未在本系统注册，请联系管理员',
  );
  assert.equal(getPortalAuthNoticeMessage('unknown'), '');
});

test('portal auth notice helper strips notice query param', () => {
  assert.equal(
    stripPortalAuthNoticeFromSearch(`?${PORTAL_AUTH_NOTICE_PARAM}=user_unregistered&redirect=%2Fadmin`),
    '?redirect=%2Fadmin',
  );
  assert.equal(
    stripPortalAuthNoticeFromSearch(`?${PORTAL_AUTH_NOTICE_PARAM}=user_unregistered`),
    '',
  );
});

test('app mounts portal auth notice host globally', () => {
  assert.match(appSource, /PortalAuthNoticeHost/);
});

test('portal auth notice host clears session and shows modal', () => {
  assert.match(noticeHostSource, /clearPortalUser/);
  assert.match(noticeHostSource, /logoutPortal/);
  assert.match(noticeHostSource, /您未在本系统注册，请联系管理员/);
  assert.match(noticeHostSource, /stripPortalAuthNoticeFromSearch/);
  assert.match(noticeHostSource, /handledRef\.current = null/);
});
