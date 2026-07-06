import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const listPageSource = readFileSync('src/pages/ListPage.tsx', 'utf8');

test('home latest selected more link uses recommendation mode instead of tag query', () => {
  assert.ok(homePageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(homePageSource.includes('section.builtin_key === LATEST_SELECTED_RECOMMENDATION'));
  assert.ok(homePageSource.includes('/list?recommendation=${LATEST_SELECTED_RECOMMENDATION}&${titleParam}'));
  assert.equal(homePageSource.includes('LATEST_SELECTED_SECTION_TAG'), false);
  assert.equal(homePageSource.includes('to={`${sec.link}${sec.link.includes'), false);
});

test('list page recommendation mode does not send tag filter', () => {
  assert.ok(listPageSource.includes("const LATEST_SELECTED_RECOMMENDATION = 'latest_selected'"));
  assert.ok(listPageSource.includes('tag: isLatestSelectedRecommendation ? undefined : tagParam || undefined'));
  assert.ok(
    listPageSource.includes(
      'recommendation: isLatestSelectedRecommendation ? LATEST_SELECTED_RECOMMENDATION : undefined',
    ),
  );
});
