import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildUnifiedAuthStartUrl,
  getUnifiedAuthErrorMessage,
  normalizePortalRedirect,
} from '../src/api/auth';

const loginSource = readFileSync('src/pages/LoginPage.tsx', 'utf8');
const authApiSource = readFileSync('src/api/auth.ts', 'utf8');

test('unified auth helpers normalize unsafe redirects before start URL build', () => {
  assert.equal(normalizePortalRedirect('/admin?tab=users'), '/admin?tab=users');
  assert.equal(normalizePortalRedirect('https://evil.example.com'), '/');
  assert.equal(normalizePortalRedirect('//evil.example.com'), '/');
  assert.equal(normalizePortalRedirect('/ok\nSet-Cookie:bad=1'), '/');
  assert.equal(
    buildUnifiedAuthStartUrl('/admin?tab=users'),
    '/api/v1/auth/unified/start?redirect=%2Fadmin%3Ftab%3Dusers',
  );
  assert.equal(buildUnifiedAuthStartUrl('https://evil.example.com'), '/api/v1/auth/unified/start?redirect=%2F');
});

test('unified auth error helper exposes safe Chinese messages only', () => {
  assert.equal(getUnifiedAuthErrorMessage('invalid_state'), '登录请求已失效，请重新认证。');
  assert.equal(getUnifiedAuthErrorMessage('permission_denied'), '账号已认证但暂未开通知库权限，请联系管理员。');
  assert.equal(getUnifiedAuthErrorMessage('unexpected'), '统一认证登录失败，请使用账号密码登录。');
  assert.equal(getUnifiedAuthErrorMessage(''), '');
});

test('login page keeps password form and wires unified auth button to backend start route', () => {
  assert.match(loginSource, /fetchUnifiedAuthConfig/);
  assert.match(loginSource, /buildUnifiedAuthStartUrl/);
  assert.match(loginSource, /window\.location\.assign/);
  assert.match(loginSource, /getUnifiedAuthErrorMessage/);
  assert.match(loginSource, /loginPortal/);
  assert.match(loginSource, /统一身份认证暂不可用/);
});

test('frontend unified auth config client never references backend secrets', () => {
  assert.match(authApiSource, /\/api\/v1\/auth\/unified\/config/);
  assert.doesNotMatch(authApiSource, /client_secret/);
  assert.doesNotMatch(authApiSource, /hmac/i);
});
