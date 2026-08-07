/**
 * Single rich-text guide for points rules modal (admin + public).
 * Legacy multi-key copies (earn_intro / …) are superseded by `guide`.
 */

export const POINTS_GUIDE_COPY_KEY = 'guide';

/** Default sample content shown when `guide` is empty / missing. */
export const POINTS_GUIDE_SAMPLE_HTML = [
  '<p><strong>1. 积分获取：</strong>用户通过发布优质内容、参与互动等方式获取积分，每日设有上限，防止刷分行为。</p>',
  '<p><strong>2. 积分扣减：</strong>对于违反平台规范的行为，将扣除相应积分作为惩戒，严重违规将额外处理。</p>',
  '<p><strong>3. 管理员奖励：</strong>不同层级的管理员根据其管理职责，每月可获得固定积分奖励。</p>',
  '<p><strong>4. 积分用途：</strong>本平台积分会定期发送到协同办公平台，用于党群礼物兑换。</p>',
  '<p><strong>5. 申诉机制：</strong>如对积分变动有异议，可在7个工作日内向管理员提出申诉。</p>',
].join('');

/** Resolve editable guide HTML from admin/public copy list. */
export function resolvePointsGuideContent(
  copies: { copy_key: string; content: string }[],
): string {
  const guide = copies.find((c) => c.copy_key === POINTS_GUIDE_COPY_KEY);
  if (guide?.content?.trim()) return guide.content;
  return POINTS_GUIDE_SAMPLE_HTML;
}
