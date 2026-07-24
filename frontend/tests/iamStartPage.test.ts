import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const iamStartSource = readFileSync('src/pages/IamStartPage.tsx', 'utf8');
const loginPageSource = readFileSync('src/pages/LoginPage.tsx', 'utf8');
const restAuthTokenSource = readFileSync('src/utils/restAuthToken.ts', 'utf8');

test('rest auth token helper reads tokenId from search params', () => {
  assert.match(restAuthTokenSource, /readUrlTokenId/);
  assert.match(restAuthTokenSource, /resolveUrlTokenId/);
  assert.match(restAuthTokenSource, /DEFAULT_REST_TOKEN_PARAM = 'tokenId'/);
});

test('rest auth token helper builds iam_start path', () => {
  assert.match(restAuthTokenSource, /IAM_START_PATH = '\/iam_start'/);
  assert.match(restAuthTokenSource, /buildIamStartPath/);
});

test('app registers iam_start route', () => {
  assert.match(appSource, /path="\/iam_start"/);
  assert.match(appSource, /IamStartPage/);
});

test('iam start page exchanges tokenId and redirects on result', () => {
  assert.match(iamStartSource, /restExchange\(\{ token_id: tokenId/);
  assert.match(iamStartSource, /navigate\(POST_LOGIN_HOME/);
  assert.match(iamStartSource, /buildLoginRedirectPath/);
  assert.match(iamStartSource, /USER_UNREGISTERED_CODE/);
  assert.match(iamStartSource, /auth_error/);
});

test('login page forwards tokenId urls to iam_start', () => {
  assert.match(loginPageSource, /buildIamStartPath/);
  assert.match(loginPageSource, /resolveUrlTokenId/);
  assert.doesNotMatch(loginPageSource, /restExchange/);
});
