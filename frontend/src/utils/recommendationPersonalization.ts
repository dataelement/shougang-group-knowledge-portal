import type { RecommendationConfig } from '../api/adminConfig';

export function validateRecommendationPersonalization(
  recommendation: RecommendationConfig,
  sectionPageSize: number,
): string {
  if (!Number.isInteger(recommendation.home_total_count)
    || recommendation.home_total_count < 1
    || recommendation.home_total_count > 50) {
    return '推荐总数必须是 1～50 的整数。';
  }
  if (sectionPageSize < 1 || sectionPageSize > recommendation.home_total_count) {
    return '首页展示数量不能大于推荐总数。';
  }
  if (!Number.isInteger(recommendation.hot_half_life_days)
    || recommendation.hot_half_life_days < 1
    || recommendation.hot_half_life_days > 90) {
    return '热度半衰期必须是 1～90 天的整数。';
  }
  if (!Number.isFinite(recommendation.home_entry_source_weight)
    || recommendation.home_entry_source_weight < 0
    || recommendation.home_entry_source_weight > 1) {
    return '首页推荐来源权重必须在 0～1 之间。';
  }
  if (!Number.isFinite(recommendation.stable_shuffle_score_gap)
    || recommendation.stable_shuffle_score_gap < 0
    || recommendation.stable_shuffle_score_gap > 100) {
    return '稳定打散分差阈值必须在 0～100 之间。';
  }
  if (!Number.isInteger(recommendation.stable_shuffle_cycle_days)
    || recommendation.stable_shuffle_cycle_days < 1
    || recommendation.stable_shuffle_cycle_days > 30) {
    return '稳定打散周期必须是 1～30 天的整数。';
  }
  if (!Number.isInteger(recommendation.personalized_rollout_percent)
    || recommendation.personalized_rollout_percent < 0
    || recommendation.personalized_rollout_percent > 100) {
    return '灰度比例必须是 0～100 的整数。';
  }
  return '';
}
