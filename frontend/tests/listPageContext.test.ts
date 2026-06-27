import assert from 'node:assert/strict';
import test from 'node:test';
import type { PortalConfig } from '../src/api/adminConfig';
import { resolveListContext } from '../src/utils/listPageContext';

const config = {
  spaces: [
    { id: 12, name: '设备知识库', file_count: 0, tag_count: 0, enabled: true },
    { id: 18, name: '安全知识库', file_count: 0, tag_count: 0, enabled: true },
  ],
  domains: [
    {
      name: '设备',
      space_ids: [12, 18, 12],
      color: '#111',
      bg: '#eee',
      icon: 'Factory',
      background_image: '',
      enabled: true,
      code: 'PM',
    },
  ],
  sections: [
    { title: '精选', tag: '最新精选', link: '/list?tag=最新精选', icon: 'Star', color: '#2563eb', bg: '#eff6ff', enabled: true },
  ],
} as unknown as PortalConfig;

test('domain list context keeps all bound space ids', () => {
  const context = resolveListContext(config, '设备');

  assert.equal(context.mode, 'domain');
  assert.equal(context.pageTitle, '设备');
  assert.equal(context.spaceId, undefined);
  assert.deepEqual(context.spaceIds, [12, 18]);
});

test('space list context keeps the single space route behavior', () => {
  const context = resolveListContext(config, undefined, '12');

  assert.equal(context.mode, 'space');
  assert.equal(context.spaceId, 12);
  assert.deepEqual(context.spaceIds, [12]);
  assert.equal(context.pageTitle, '设备知识库');
});

test('tag list context keeps configured section title', () => {
  const context = resolveListContext(config, undefined, undefined, '最新精选');

  assert.equal(context.mode, 'global');
  assert.deepEqual(context.spaceIds, []);
  assert.equal(context.pageTitle, '精选');
});
