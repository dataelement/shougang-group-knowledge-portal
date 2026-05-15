import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShareLoginRedirect, isShareLoginRequiredError } from '../src/utils/shareDocumentAccess';
import { ApiRequestError } from '../src/api/content';

test('share login redirect preserves the current share token path', () => {
  assert.equal(
    buildShareLoginRedirect('token/with spaces'),
    '/login?redirect=%2Fshare%2Fdocument%2Ftoken%252Fwith%2520spaces',
  );
});

test('share login required error is detected from access response status', () => {
  assert.equal(isShareLoginRequiredError(new ApiRequestError('仅本部门分享需要登录后访问', 401)), true);
  assert.equal(isShareLoginRequiredError(new ApiRequestError('分享访问未验证或已过期', 403)), false);
  assert.equal(isShareLoginRequiredError(new Error('仅本部门分享需要登录后访问')), false);
});
