import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('home latest selected more link uses recommendation mode instead of tag query', () => {
  assert.ok(homePageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(homePageSource.includes('section.builtin_key === LATEST_SELECTED_RECOMMENDATION'));
  assert.ok(homePageSource.includes('function getHomeSectionKey(section: SectionConfig): string'));
  assert.ok(homePageSource.includes('function getHomeStreamSectionKey(tag: string, recommendationMode?: RecommendationMode): string'));
  assert.ok(homePageSource.includes('const sectionKey = getHomeStreamSectionKey(tag, recommendationMode)'));
  assert.ok(homePageSource.includes('const sectionKey = getHomeSectionKey(sec)'));
  assert.ok(homePageSource.includes('sectionData[sectionKey]'));
  assert.equal(homePageSource.includes('sectionData[sec.tag]'), false);
  assert.ok(homePageSource.includes('const mode = recommendationMode ?? LATEST_SELECTED_RECOMMENDATION'));
  assert.ok(homePageSource.includes('/list?recommendation=${mode}&${titleParam}'));
  assert.equal(homePageSource.includes('LATEST_SELECTED_SECTION_TAG'), false);
  assert.equal(homePageSource.includes('to={`${sec.link}${sec.link.includes'), false);
});

test('typical case more link keeps the industry-intelligence list on public scope', () => {
  assert.ok(homePageSource.includes("const TYPICAL_CASE_SECTION_KEY = 'typical_case'"));
  assert.ok(homePageSource.includes("section.builtin_key === TYPICAL_CASE_SECTION_KEY"));
  assert.ok(homePageSource.includes("public_only=true"));
  assert.ok(listPageSource.includes("const publicOnly = params.get('public_only') === 'true'"));
  assert.ok(listPageSource.includes('publicOnly,'));
});

test('list page recommendation mode does not send tag filter', () => {
  assert.ok(listPageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(listPageSource.includes("const PERSONALIZED_RECOMMENDATION = 'personalized_v1'"));
  assert.ok(listPageSource.includes('baseTag: !isRecommendationList && hasUserFilterTag ? tagParam || undefined : undefined'));
  assert.ok(listPageSource.includes('tag: isRecommendationList ? undefined : filterTag || tagParam || undefined'));
  assert.ok(
    listPageSource.includes(
      'recommendation: isRecommendationList ? recommendationParam : undefined',
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

test('list page exposes updated time sorting without changing the recommendation default', () => {
  assert.ok(listPageSource.includes("const timeSort = normalizeTimeSort(params.get('sort'))"));
  assert.ok(
    listPageSource.includes(
      "timeSort || (isLatestSelectedRecommendation ? 'portal_read_count_desc' : 'updated_at_desc')",
    ),
  );
  assert.ok(listPageSource.includes('<option value="">时间排序</option>'));
  assert.ok(listPageSource.includes("setFilter('sort', e.target.value)"));
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
