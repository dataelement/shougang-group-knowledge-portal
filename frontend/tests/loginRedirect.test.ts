import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { redirectToLogin } from '../src/utils/loginRedirect';

const headerSource = readFileSync('src/components/Header.tsx', 'utf8');
const loginBannerSource = readFileSync('src/components/LoginBanner.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const loginPageSource = readFileSync('src/pages/LoginPage.tsx', 'utf8');
const loginRedirectSource = readFileSync('src/utils/loginRedirect.ts', 'utf8');

test('login redirect checks unified auth availability only when requested', () => {
  assert.match(loginRedirectSource, /fetchUnifiedAuthConfig/);
  assert.match(loginRedirectSource, /options\.preferUnifiedAuth/);
  assert.match(loginRedirectSource, /config\.enabled && config\.authMode === 'oauth'/);
  assert.match(loginRedirectSource, /buildLocalLoginPath/);
});

test('login redirect starts OAuth directly when unified auth is available', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const assignments: string[] = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { assign: (url: string) => assignments.push(url) } },
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status_code: 200,
        status_message: 'SUCCESS',
        data: {
          enabled: true,
          auth_mode: 'oauth',
          provider: 'custom',
          label: '统一身份认证',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    await redirectToLogin('/expert-qa/7', { preferUnifiedAuth: true });
    assert.deepEqual(assignments, [
      '/api/v1/auth/unified/start?redirect=%2Fexpert-qa%2F7',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('login redirect falls back for non-OAuth config and config lookup failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const assignments: string[] = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { assign: (url: string) => assignments.push(url) } },
  });

  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status_code: 200,
          status_message: 'SUCCESS',
          data: {
            enabled: true,
            auth_mode: 'rest',
            provider: 'custom',
            label: '统一身份认证',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    await redirectToLogin('/expert-qa', { preferUnifiedAuth: true });

    globalThis.fetch = async () => {
      throw new Error('network unavailable');
    };
    await redirectToLogin('/expert-qa/ask', { preferUnifiedAuth: true });
    assert.deepEqual(assignments, [
      '/login?redirect=%2Fexpert-qa',
      '/login?redirect=%2Fexpert-qa%2Fask',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('header login entry uses triggerLoginRedirect instead of hard-coded /login route', () => {
  assert.match(headerSource, /triggerLoginRedirect\(redirect\)/);
  assert.doesNotMatch(headerSource, /navigate\(`\/login\?redirect=/);
});

test('login banner uses triggerLoginRedirect instead of hard-coded /login route', () => {
  assert.match(loginBannerSource, /triggerLoginRedirect\(redirect\)/);
  assert.doesNotMatch(loginBannerSource, /navigate\(`\/login\?redirect=/);
});

test('admin route redirects anonymous users through login redirect helper', () => {
  assert.match(appSource, /UnifiedAuthLoginRedirect/);
  assert.match(readFileSync('src/components/UnifiedAuthLoginRedirect.tsx', 'utf8'), /redirectToLogin/);
});

test('manual /login route still renders password login page', () => {
  assert.match(appSource, /<Route path="\/login" element={<LoginPage \/>}/);
  assert.match(loginPageSource, /loginPortal/);
});

test('login page only auto-recovers server session when redirect intent is present', () => {
  assert.match(loginPageSource, /hasRedirectIntent/);
  assert.match(loginPageSource, /if \(!hasRedirectIntent\) return;/);
  assert.match(loginPageSource, /logged_out/);
  assert.match(loginPageSource, /shouldSuppressAuthRecovery/);
});

test('login page forwards tokenId urls to iam_start', () => {
  assert.match(loginPageSource, /buildIamStartPath/);
  assert.match(loginPageSource, /resolveUrlTokenId/);
});

test('login page skips session recovery when URL carries tokenId', () => {
  assert.match(loginPageSource, /resolveUrlTokenId\(location\.search/);
});

test('knowledge spaces page skips login redirect while logout navigation is in progress', () => {
  const knowledgeSpacesSource = readFileSync('src/pages/KnowledgeSpacesPage.tsx', 'utf8');
  assert.match(knowledgeSpacesSource, /isPortalLogoutInProgress/);
});
