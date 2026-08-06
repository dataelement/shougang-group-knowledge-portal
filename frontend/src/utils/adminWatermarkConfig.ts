import type { WatermarkConfig } from '../api/adminConfig';
import { DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT } from './previewWatermark';

export { DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT };
export const PORTAL_WATERMARK_HORIZONTAL_TEXT_MAX_LENGTH = 80;

export interface WatermarkDraft {
  horizontalText: string;
}

export function createWatermarkDraft(current?: WatermarkConfig): WatermarkDraft {
  return {
    horizontalText: current?.horizontal_text?.trim() ?? '',
  };
}

export function resolvePortalWatermarkHorizontalText(configured?: string | null): string {
  const text = (configured ?? '').trim();
  return text || DEFAULT_PORTAL_WATERMARK_HORIZONTAL_TEXT;
}

export function validateWatermarkDraft(
  draft: WatermarkDraft,
): { watermark?: WatermarkConfig; error?: string } {
  const horizontalText = draft.horizontalText.trim();
  if (draft.horizontalText.includes('\n') || draft.horizontalText.includes('\r')) {
    return { error: '水印文案不能包含换行' };
  }
  if (horizontalText.length > PORTAL_WATERMARK_HORIZONTAL_TEXT_MAX_LENGTH) {
    return { error: `水印文案不能超过 ${PORTAL_WATERMARK_HORIZONTAL_TEXT_MAX_LENGTH} 个字符` };
  }
  return {
    watermark: {
      horizontal_text: horizontalText,
    },
  };
}
