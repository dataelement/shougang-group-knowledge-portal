import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const contentSource = readFileSync('src/api/content.ts', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const listSource = readFileSync('src/pages/ListPage.tsx', 'utf8');

test('home SSE keeps the actual recommendation mode for the more link', () => {
  assert.match(contentSource, /recommendation_mode\?: RecommendationMode/);
  assert.match(contentSource, /payload\.recommendation_mode/);
  assert.match(homeSource, /sectionRecommendationModes/);
  assert.match(homeSource, /buildSectionMoreLink\(sec, recommendationMode\)/);
  assert.match(homeSource, /recommendationModePending = isLatestSelectedSection\(sec\) && !recommendationMode/);
  assert.match(homeSource, /aria-disabled="true"/);
});

test('personalized list loads configured Top N once and disables cursors', () => {
  assert.match(listSource, /PERSONALIZED_RECOMMENDATION = 'personalized_v1'/);
  assert.match(listSource, /configuredPersonalizedTotalCount/);
  assert.match(listSource, /cursor: isPersonalizedRecommendation \? undefined/);
  assert.match(listSource, /setHasMore\(isPersonalizedRecommendation \? false/);
  assert.match(listSource, /if \(isPersonalizedRecommendation \|\| !hasMore/);
});

test('recommendation previews preserve entry point and scene', () => {
  assert.match(homeSource, /entry_point: 'home_recommendation'/);
  assert.match(listSource, /entryPoint: recommendationParam \? 'recommendation_list' : 'knowledge_space'/);
  assert.match(listSource, /recommendationScene: previewRecommendationScene/);
});
