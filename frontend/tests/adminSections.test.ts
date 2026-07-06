import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSectionLink, createSectionDraft, validateSectionDraft } from '../src/utils/adminSections';

test('createSectionDraft maps existing section config to editor state', () => {
  assert.deepEqual(
    createSectionDraft({
      title: '知识推荐 · 最新精选',
      tag: '最新精选',
      link: '/list?tag=最新精选',
      icon: 'Star',
      builtin_key: 'latest_selected',
      color: '#2563eb',
      bg: '#eff6ff',
      enabled: true,
    }),
    {
      title: '知识推荐 · 最新精选',
      tag: '最新精选',
      icon: 'Star',
      builtinKey: 'latest_selected',
      color: '#2563eb',
      bg: '#eff6ff',
    },
  );
});

test('validateSectionDraft keeps builtin latest selected recommendation mode', () => {
  assert.deepEqual(
    validateSectionDraft({
      title: '知识推荐 · 最新精选',
      tag: '知识推荐',
      icon: 'Star',
      builtinKey: 'latest_selected',
      color: '#2563eb',
      bg: '#eff6ff',
    }),
    {
      section: {
        title: '知识推荐 · 最新精选',
        tag: '知识推荐',
        link: '/list?recommendation=latest_selected',
        icon: 'Star',
        builtin_key: 'latest_selected',
        color: '#2563eb',
        bg: '#eff6ff',
        enabled: true,
      },
    },
  );
});

test('validateSectionDraft accepts valid section input', () => {
  assert.deepEqual(
    validateSectionDraft({
      title: '典型案例 · 事故分析',
      tag: '典型案例',
      icon: 'AlertTriangle',
      color: '#dc2626',
      bg: '#fee2e2',
    }),
    {
      section: {
        title: '典型案例 · 事故分析',
        tag: '典型案例',
        link: '/list?tag=%E5%85%B8%E5%9E%8B%E6%A1%88%E4%BE%8B',
        icon: 'AlertTriangle',
        color: '#dc2626',
        bg: '#fee2e2',
        enabled: true,
      },
    },
  );
});

test('validateSectionDraft rejects blank required fields', () => {
  assert.equal(
    validateSectionDraft({
      title: '',
      tag: '最新精选',
      icon: 'Star',
      color: '#2563eb',
      bg: '#eff6ff',
    }).error,
    '请输入分区标题',
  );
});

test('buildSectionLink derives a site list route from the tag', () => {
  assert.equal(
    buildSectionLink('最新精选'),
    '/list?tag=%E6%9C%80%E6%96%B0%E7%B2%BE%E9%80%89',
  );
});

test('buildSectionLink derives latest selected route from builtin key', () => {
  assert.equal(
    buildSectionLink('知识推荐', 'latest_selected'),
    '/list?recommendation=latest_selected',
  );
});
