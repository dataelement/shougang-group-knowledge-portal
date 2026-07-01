import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_HOME_BANNERS, getEnabledApps, getEnabledDomains, getEnabledSections, getPrimarySpaceId, resolveHomeBanners, toRuntimeDisplayConfig } from '../src/utils/portalConfig';

test('toRuntimeDisplayConfig maps API display config fields to runtime keys', () => {
  const runtime = toRuntimeDisplayConfig({
    home: {
      section_page_size: 7,
      hot_tags_count: 9,
      qa_hot_count: 5,
      domain_count: 4,
      spaces_count: 3,
      apps_count: 2,
    },
    list: {
      page_size: 11,
      visible_tag_count: 6,
    },
    search: {
      page_size: 12,
      visible_tag_count: 7,
    },
    detail: {
      related_files_count: 8,
      visible_tag_count: 4,
    },
  });

  assert.deepEqual(runtime, {
    home: {
      sectionPageSize: 7,
      hotTagsCount: 9,
      qaHotCount: 5,
      domainCount: 4,
      spacesCount: 3,
      appsCount: 2,
    },
    list: {
      pageSize: 11,
      visibleTagCount: 6,
    },
    search: {
      pageSize: 12,
      visibleTagCount: 7,
    },
    detail: {
      relatedFilesCount: 8,
      visibleTagCount: 4,
    },
  });
});

test('enabled helpers filter disabled records and unbound domains', () => {
  const domains = getEnabledDomains([
    { name: '设备', space_ids: [12], color: '#111', bg: '#eee', icon: 'Factory', background_image: '', enabled: true, code: '' },
    { name: '冷轧', space_ids: [18], color: '#111', bg: '#eee', icon: 'Snowflake', background_image: '', enabled: true, code: '' },
    { name: '安全', space_ids: [12], color: '#111', bg: '#eee', icon: 'Shield', background_image: '', enabled: false, code: '' },
    { name: '未绑定', space_ids: [], color: '#111', bg: '#eee', icon: 'Factory', background_image: '', enabled: true, code: '' },
  ]);
  const sections = getEnabledSections([
    { title: '精选', tag: '最新精选', link: '/list?tag=最新精选', icon: 'Star', color: '#2563eb', bg: '#eff6ff', enabled: true },
    { title: '案例', tag: '典型案例', link: '/list?tag=典型案例', icon: 'AlertTriangle', color: '#dc2626', bg: '#fee2e2', enabled: false },
  ]);
  const apps = getEnabledApps([
    { id: 1, name: '检索', icon: 'Search', desc: 'desc', color: '#111', bg: '#eee', url: '/search', enabled: true },
    { id: 2, name: '报告', icon: 'FileText', desc: 'desc', color: '#111', bg: '#eee', url: '/report', enabled: false },
  ]);

  assert.deepEqual(domains.map((domain) => domain.name), ['设备', '冷轧']);
  assert.deepEqual(sections.map((section) => section.tag), ['最新精选']);
  assert.deepEqual(apps.map((app) => app.id), [1]);
});

test('getPrimarySpaceId returns the first valid space id', () => {
  assert.equal(getPrimarySpaceId([]), undefined);
  assert.equal(getPrimarySpaceId([25, 30]), 25);
});

test('resolveHomeBanners returns fallback when banners list is missing or empty', () => {
  assert.deepEqual(resolveHomeBanners(undefined), FALLBACK_HOME_BANNERS);
  assert.deepEqual(resolveHomeBanners([]), FALLBACK_HOME_BANNERS);
});

test('resolveHomeBanners falls back when no banner has both enabled and image_url', () => {
  const banners = resolveHomeBanners([
    { id: 1, label: '', title: '禁用', desc: '', image_url: '/x.jpg', link_url: '', enabled: false },
    { id: 2, label: '', title: '缺图', desc: '', image_url: '', link_url: '', enabled: true },
  ]);
  assert.deepEqual(banners, FALLBACK_HOME_BANNERS);
});

test('resolveHomeBanners maps snake_case BannerSlide to runtime camelCase', () => {
  const banners = resolveHomeBanners([
    {
      id: 7,
      label: '春季活动',
      title: '主标题',
      desc: '副标题',
      image_url: '/uploads/banners/abc.jpg',
      link_url: 'https://intranet.example.com/spring',
      enabled: true,
    },
  ]);

  assert.equal(banners.length, 1);
  assert.deepEqual(banners[0], {
    label: '春季活动',
    title: '主标题',
    desc: '副标题',
    imageUrl: '/uploads/banners/abc.jpg',
    linkUrl: 'https://intranet.example.com/spring',
  });
});

test('resolveHomeBanners filters out disabled or imageless entries while keeping order', () => {
  const banners = resolveHomeBanners([
    { id: 1, label: 'A', title: '一', desc: '', image_url: '/a.jpg', link_url: '', enabled: true },
    { id: 2, label: 'B', title: '二', desc: '', image_url: '/b.jpg', link_url: '', enabled: false },
    { id: 3, label: 'C', title: '三', desc: '', image_url: '', link_url: '', enabled: true },
    { id: 4, label: 'D', title: '四', desc: '', image_url: '/d.jpg', link_url: '', enabled: true },
  ]);
  assert.deepEqual(banners.map((b) => b.title), ['一', '四']);
});
