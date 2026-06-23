import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeUserFacingErrorMessage,
  normalizeUserFacingMessage,
} from '../src/utils/userFacingErrors';

test('user-facing error normalizer maps technical English messages to Chinese copy', () => {
  assert.equal(
    normalizeUserFacingMessage('Failed to fetch'),
    '网络请求失败，请检查网络连接后重试。',
  );
  assert.equal(
    normalizeUserFacingMessage('Invalid username or password', '登录失败，请重试。', 401),
    '账号或密码错误，请检查后重试。',
  );
  assert.equal(
    normalizeUserFacingMessage('PREVIEW_CONTENT_NOT_FOUND', '预览失败', 404),
    '未找到可预览内容。',
  );
  assert.equal(
    normalizeUserFacingMessage('BiSheng 登录失败：HTTP 500', '登录失败，请重试。', 500),
    'BiSheng 登录失败，请稍后重试。',
  );
});

test('user-facing error normalizer keeps existing Chinese business messages', () => {
  assert.equal(
    normalizeUserFacingErrorMessage(new Error('当前账号没有分享该文档的权限')),
    '当前账号没有分享该文档的权限',
  );
});
