import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('home latest selected more link uses recommendation mode instead of tag query', () => {
  assert.ok(homePageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(homePageSource.includes('section.builtin_key === LATEST_SELECTED_RECOMMENDATION'));
  assert.ok(homePageSource.includes('/list?recommendation=${LATEST_SELECTED_RECOMMENDATION}&${titleParam}'));
  assert.equal(homePageSource.includes('LATEST_SELECTED_SECTION_TAG'), false);
  assert.equal(homePageSource.includes('to={`${sec.link}${sec.link.includes'), false);
});

test('list page recommendation mode does not send tag filter', () => {
  assert.ok(listPageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(listPageSource.includes('baseTag: !isLatestSelectedRecommendation && hasUserFilterTag ? tagParam || undefined : undefined'));
  assert.ok(listPageSource.includes('tag: isLatestSelectedRecommendation ? undefined : filterTag || tagParam || undefined'));
  assert.ok(
    listPageSource.includes(
      'recommendation: isLatestSelectedRecommendation ? LATEST_SELECTED_RECOMMENDATION : undefined',
    ),
  );
});

test('list page keeps entry tag separate from user tag filter', () => {
  assert.ok(listPageSource.includes("const filterTag = params.get('filter_tag') || ''"));
  assert.ok(listPageSource.includes("setFilter('filter_tag', e.target.value)"));
});

test('list page adds business domain filter to global recommendation and section lists', () => {
  assert.ok(listPageSource.includes("const businessDomainFilter = normalizeBusinessDomainCode(params.get('business_domain_code'))"));
  assert.ok(listPageSource.includes('businessDomainCode: showBusinessDomainFilter ? businessDomainFilter || undefined : undefined'));
  assert.ok(listPageSource.includes("setFilter('business_domain_code', e.target.value)"));
});

test('admin latest selected section does not expose editable tag binding', () => {
  assert.ok(adminPageSource.includes("section.builtin_key === LATEST_SELECTED_SECTION_KEY"));
  assert.ok(adminPageSource.includes("value={latestSelected ? '无' : draft.tag}"));
  assert.ok(adminPageSource.includes('disabled={latestSelected}'));
  assert.ok(adminPageSource.includes("知识推荐 · 最新精选使用文档预览数推荐，不按标签查询。"));
});

test('admin builtin section delete action uses disabled muted style', () => {
  assert.ok(adminPageSource.includes('className={builtin ? s.inlineMutedBtn : s.inlineDangerBtn}'));
  assert.ok(adminPageSource.includes('disabled={saving || builtin}'));
  assert.ok(adminPageSource.includes("title={builtin ? '系统内置分区不能删除' : '删除'}"));
});
