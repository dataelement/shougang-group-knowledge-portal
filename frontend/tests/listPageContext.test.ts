import assert from 'node:assert/strict';
import test from 'node:test';
import type { PortalConfig } from '../src/api/adminConfig';
import { hasListScopeFilters, resolveListContext } from '../src/utils/listPageContext';

const config = {
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
  assert.equal(context.businessDomainCode, 'PM');
});

test('space list context keeps the single space route behavior', () => {
  const context = resolveListContext(config, undefined, '12', undefined, '设备知识库');

  assert.equal(context.mode, 'space');
  assert.equal(context.spaceId, 12);
  assert.deepEqual(context.spaceIds, [12]);
  assert.equal(context.pageTitle, '设备知识库');
});

test('space list context falls back to generic title without URL title', () => {
  const context = resolveListContext(config, undefined, '12');

  assert.equal(context.mode, 'space');
  assert.equal(context.pageTitle, '知识库');
});

test('tag list context keeps configured section title', () => {
  const context = resolveListContext(config, undefined, undefined, '最新精选');

  assert.equal(context.mode, 'global');
  assert.deepEqual(context.spaceIds, []);
  assert.equal(context.pageTitle, '精选');
});

test('hasListScopeFilters ignores default domain/category scope params', () => {
  assert.equal(hasListScopeFilters(new URLSearchParams()), false);
});

test('hasListScopeFilters detects user narrowing filters', () => {
  assert.equal(hasListScopeFilters(new URLSearchParams('q=设备')), true);
  assert.equal(hasListScopeFilters(new URLSearchParams('space_id=12')), true);
  assert.equal(hasListScopeFilters(new URLSearchParams('document_type=STD')), true);
  assert.equal(hasListScopeFilters(new URLSearchParams(), 'HR'), true);
});

test('category route falls back to category mode when card is missing but code is present', () => {
  const context = resolveListContext(
    {
      ...config,
      category_cards: [],
      document_types: [{ code: 'PRO', label: '流程与程序', children: [] }],
    } as unknown as PortalConfig,
    undefined,
    undefined,
    undefined,
    undefined,
    'PRO',
  );

  assert.equal(context.mode, 'category');
  assert.equal(context.categoryCode, 'PRO');
  assert.deepEqual(context.spaceIds, []);
  assert.equal(context.pageTitle, '流程与程序');
});
