import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecommendationConfig } from '../src/api/adminConfig';
import { validateRecommendationPersonalization } from '../src/utils/recommendationPersonalization';

const validRecommendation: RecommendationConfig = {
  provider: 'tag_feed',
  home_strategy: 'tag+updated_at',
  detail_strategy: 'shared_tags+updated_at',
  home_total_count: 20,
  hot_half_life_days: 7,
  home_entry_source_weight: 0.3,
  stable_shuffle_score_gap: 5,
  stable_shuffle_cycle_days: 7,
  personalized_shadow_enabled: false,
  personalized_rollout_percent: 10,
};

test('personalized recommendation accepts documented defaults', () => {
  assert.equal(validateRecommendationPersonalization(validRecommendation, 6), '');
});

test('personalized recommendation enforces count relation and rollout boundaries', () => {
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, home_total_count: 5 }, 6),
    /不能大于推荐总数/,
  );
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, personalized_rollout_percent: 101 }, 6),
    /0～100/,
  );
});

test('personalized recommendation validates four algorithm parameters', () => {
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, hot_half_life_days: 0 }, 6),
    /1～90/,
  );
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, home_entry_source_weight: 1.1 }, 6),
    /0～1/,
  );
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, stable_shuffle_score_gap: -1 }, 6),
    /0～100/,
  );
  assert.match(
    validateRecommendationPersonalization({ ...validRecommendation, stable_shuffle_cycle_days: 31 }, 6),
    /1～30/,
  );
});
