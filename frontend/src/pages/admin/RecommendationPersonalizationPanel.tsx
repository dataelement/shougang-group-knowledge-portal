import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { RecommendationConfig } from '../../api/adminConfig';
import { validateRecommendationPersonalization } from '../../utils/recommendationPersonalization';
import s from '../AdminPage.module.css';

type NumericRecommendationKey =
  | 'home_total_count'
  | 'hot_half_life_days'
  | 'home_entry_source_weight'
  | 'stable_shuffle_score_gap'
  | 'stable_shuffle_cycle_days'
  | 'personalized_rollout_percent';

function numericValue(value: string): number {
  if (!value.trim()) return Number.NaN;
  return Number(value);
}

export default function RecommendationPersonalizationPanel({
  recommendation,
  sectionPageSize,
  saving,
  onSave,
}: {
  recommendation: RecommendationConfig;
  sectionPageSize: number;
  saving: boolean;
  onSave: (next: RecommendationConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(recommendation);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setDraft(recommendation);
  }, [recommendation]);

  const updateNumber = (key: NumericRecommendationKey, value: string) => {
    setDraft((current) => ({ ...current, [key]: numericValue(value) }));
    setError('');
    setSuccess('');
  };

  const handleSave = async () => {
    const validationError = validateRecommendationPersonalization(draft, sectionPageSize);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setSuccess('');
    try {
      await onSave(draft);
      setSuccess('个性化推荐配置已保存。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '个性化推荐配置保存失败。');
    }
  };

  return (
    <section aria-labelledby="recommendation-personalization-title">
      <div className={s.titleBar}>
        <div>
          <h2 id="recommendation-personalization-title" className={s.pageTitle}>推荐策略配置</h2>
          <p className={s.panelDescription}>
            配置首页 Top N、热度与稳定打散参数。影子模式只计算指标，不改变用户当前看到的推荐结果。
          </p>
        </div>
        <button type="button" className={s.addBtn} onClick={() => void handleSave()} disabled={saving}>
          <Save size={16} />
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>

      {error ? <div className={s.errorBox} role="alert">{error}</div> : null}
      {success ? <div className={s.successBox} role="status">{success}</div> : null}

      <div className={s.configSection}>
        <h3 className={s.configSectionTitle}>推荐数量与策略</h3>
        <div className={s.configGrid}>
          <label className={s.configField}>
            <span className={s.fieldLabel}>首页推荐总数</span>
            <input
              className={s.formInput}
              type="number"
              min={1}
              max={50}
              step={1}
              value={Number.isFinite(draft.home_total_count) ? draft.home_total_count : ''}
              onChange={(event) => updateNumber('home_total_count', event.target.value)}
              disabled={saving}
            />
            <span className={s.fieldHint}>范围 1～50，且不能小于首页展示数量 {sectionPageSize}。</span>
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>推荐 Provider</span>
            <input
              className={s.formInput}
              value={draft.provider}
              onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value }))}
              disabled={saving}
            />
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>首页旧策略</span>
            <input
              className={s.formInput}
              value={draft.home_strategy}
              onChange={(event) => setDraft((current) => ({ ...current, home_strategy: event.target.value }))}
              disabled={saving}
            />
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>详情页策略</span>
            <input
              className={s.formInput}
              value={draft.detail_strategy}
              onChange={(event) => setDraft((current) => ({ ...current, detail_strategy: event.target.value }))}
              disabled={saving}
            />
          </label>
        </div>
      </div>

      <div className={s.configSection}>
        <h3 className={s.configSectionTitle}>算法参数</h3>
        <div className={s.configGrid}>
          <label className={s.configField}>
            <span className={s.fieldLabel}>热度半衰期（天）</span>
            <input
              className={s.formInput}
              type="number"
              min={1}
              max={90}
              step={1}
              value={Number.isFinite(draft.hot_half_life_days) ? draft.hot_half_life_days : ''}
              onChange={(event) => updateNumber('hot_half_life_days', event.target.value)}
              disabled={saving}
            />
            <span className={s.fieldHint}>范围 1～90 天。</span>
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>首页推荐来源权重</span>
            <input
              className={s.formInput}
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={Number.isFinite(draft.home_entry_source_weight) ? draft.home_entry_source_weight : ''}
              onChange={(event) => updateNumber('home_entry_source_weight', event.target.value)}
              disabled={saving}
            />
            <span className={s.fieldHint}>范围 0～1，自然入口固定为 1。</span>
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>稳定打散分差阈值</span>
            <input
              className={s.formInput}
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(draft.stable_shuffle_score_gap) ? draft.stable_shuffle_score_gap : ''}
              onChange={(event) => updateNumber('stable_shuffle_score_gap', event.target.value)}
              disabled={saving}
            />
            <span className={s.fieldHint}>范围 0～100；0 表示只在同分候选内打散。</span>
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>稳定打散周期（天）</span>
            <input
              className={s.formInput}
              type="number"
              min={1}
              max={30}
              step={1}
              value={Number.isFinite(draft.stable_shuffle_cycle_days) ? draft.stable_shuffle_cycle_days : ''}
              onChange={(event) => updateNumber('stable_shuffle_cycle_days', event.target.value)}
              disabled={saving}
            />
            <span className={s.fieldHint}>范围 1～30 天。</span>
          </label>
        </div>
      </div>

      <div className={s.configSection}>
        <h3 className={s.configSectionTitle}>灰度与影子模式</h3>
        <div className={s.rolloutRow}>
          <label className={s.switchField}>
            <input
              type="checkbox"
              checked={draft.personalized_shadow_enabled}
              onChange={(event) => setDraft((current) => ({
                ...current,
                personalized_shadow_enabled: event.target.checked,
              }))}
              disabled={saving}
            />
            <span>
              <strong>开启影子模式</strong>
              <small>登录用户继续看到旧推荐，后台仅计算并记录个性化指标。</small>
            </span>
          </label>
          <label className={s.configField}>
            <span className={s.fieldLabel}>个性化灰度比例（%）</span>
            <input
              className={s.formInput}
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(draft.personalized_rollout_percent) ? draft.personalized_rollout_percent : ''}
              onChange={(event) => updateNumber('personalized_rollout_percent', event.target.value)}
              disabled={saving || draft.personalized_shadow_enabled}
            />
            <span className={s.fieldHint}>范围 0～100；调为 0 可立即回退旧推荐。</span>
          </label>
        </div>
      </div>
    </section>
  );
}
