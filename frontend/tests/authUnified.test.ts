import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildPortalLogoutStartUrl,
  buildUnifiedAuthStartUrl,
  fetchPortalMe,
  getUnifiedAuthErrorMessage,
  loginPortal,
  MULTI_LOGIN_CONFLICT_CODE,
  normalizePortalRedirect,
} from '../src/api/auth';
import { ApiRequestError } from '../src/api/content';

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
  assert.equal(buildPortalLogoutStartUrl(), '/api/v1/auth/unified/logout/start');
});

test('unified auth error helper exposes safe Chinese messages only', () => {
  assert.equal(getUnifiedAuthErrorMessage('invalid_state'), '登录请求已失效，请重新认证。');
  assert.equal(getUnifiedAuthErrorMessage('invalid_account'), '账号无效，请联系管理员开通账号。');
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
  assert.match(authApiSource, /\/api\/v1\/auth\/unified\/logout\/start/);
  assert.match(authApiSource, /response\.text\(\)/);
  assert.doesNotMatch(authApiSource, /response\.json\(\)/);
  assert.doesNotMatch(authApiSource, /client_secret/);
  assert.doesNotMatch(authApiSource, /hmac/i);
});

test('auth client handles empty error responses without native json parse failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      fetchPortalMe(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, '登录状态已失效，请重新登录。');
        assert.equal((err as { status?: number }).status, 401);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('password login maps upstream English auth failures to Chinese copy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    status_code: 401,
    status_message: 'Invalid username or password',
    data: {},
  }), { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      loginPortal({ account: 'demo', password: 'bad-password', remember: true }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, '账号或密码错误，请检查后重试。');
        assert.equal((err as { status?: number }).status, 401);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('password login preserves multi-login business conflict when response is HTTP 200', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    status_code: MULTI_LOGIN_CONFLICT_CODE,
    status_message: '该用户已在其它设备登录，是否继续登录？',
    data: { code: MULTI_LOGIN_CONFLICT_CODE },
  }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(
      loginPortal({ account: 'demo', password: 'secret', remember: true }),
      (err: unknown) => {
        assert.ok(err instanceof ApiRequestError);
        assert.equal(err.message, '该用户已在其它设备登录，是否继续登录？');
        assert.equal(err.code, MULTI_LOGIN_CONFLICT_CODE);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('login page renders multi-login confirmation dialog and force-login action', () => {
  assert.match(loginSource, /setMultiLoginMode\('password'\)/);
  assert.match(loginSource, /setFormError\(''\)/);
  assert.match(loginSource, /aria-modal="true"/);
  assert.match(loginSource, /登录确认/);
  assert.match(loginSource, /继续登录后，另一设备的登录状态将失效/);
  assert.match(loginSource, /performPasswordLogin\(true\)/);
});
