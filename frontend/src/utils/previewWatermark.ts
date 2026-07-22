export interface PortalPreviewWatermarkUser {
  account: string;
  name: string;
  departmentName?: string;
  externalId?: string;
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const WATERMARK_FONT_SIZE = 16;
const WATERMARK_LINE_HEIGHT = 20;
const WATERMARK_ROTATION = -35;
const WATERMARK_OPACITY = 0.11;
const WATERMARK_MIN_CELL_WIDTH = 384;
const WATERMARK_MIN_CELL_HEIGHT = 267;
const WATERMARK_HORIZONTAL_CLEARANCE = 64;
const WATERMARK_VERTICAL_CLEARANCE = 48;

export const PORTAL_PREVIEW_WATERMARK_FONT_FAMILY = [
  'WenQuanYi Zen Hei',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'sans-serif',
].map((font) => (font === 'sans-serif' ? font : `"${font}"`)).join(', ');

export interface PortalPreviewWatermarkPatternLayout {
  fontSize: number;
  lineHeight: number;
  rotation: number;
  opacity: number;
  textWidth: number;
  blockHeight: number;
  rotatedWidth: number;
  rotatedHeight: number;
  cellWidth: number;
  cellHeight: number;
  patternHeight: number;
  secondRowOffsetX: number;
  anchorX: number;
  anchorY: number;
}

function estimatePortalPreviewWatermarkLineWidth(line: string): number {
  return Array.from(line).reduce((width, character) => (
    width + ((character.codePointAt(0) ?? 0) <= 0xff ? WATERMARK_FONT_SIZE * 0.62 : WATERMARK_FONT_SIZE)
  ), 0);
}

export function measurePortalPreviewWatermarkLineWidths(lines: readonly string[]): number[] {
  const fallback = lines.map(estimatePortalPreviewWatermarkLineWidth);
  if (typeof document === 'undefined') return fallback;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return fallback;
  try {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return fallback;
    context.font = `${WATERMARK_FONT_SIZE}px ${PORTAL_PREVIEW_WATERMARK_FONT_FAMILY}`;
    return lines.map((line) => context.measureText(line).width);
  } catch {
    return fallback;
  }
}

export function calculatePortalPreviewWatermarkPatternLayout(
  lineWidths: readonly number[],
): PortalPreviewWatermarkPatternLayout {
  const textWidth = Math.max(0, ...lineWidths.filter(Number.isFinite));
  const blockHeight = WATERMARK_LINE_HEIGHT * 2;
  const angle = Math.abs(WATERMARK_ROTATION) * Math.PI / 180;
  const rotatedWidth = textWidth * Math.cos(angle) + blockHeight * Math.sin(angle);
  const rotatedHeight = textWidth * Math.sin(angle) + blockHeight * Math.cos(angle);
  const cellWidth = Math.max(
    WATERMARK_MIN_CELL_WIDTH,
    Math.ceil(rotatedWidth + WATERMARK_HORIZONTAL_CLEARANCE),
  );
  const cellHeight = Math.max(
    WATERMARK_MIN_CELL_HEIGHT,
    Math.ceil(rotatedHeight + WATERMARK_VERTICAL_CLEARANCE),
  );
  return {
    fontSize: WATERMARK_FONT_SIZE,
    lineHeight: WATERMARK_LINE_HEIGHT,
    rotation: WATERMARK_ROTATION,
    opacity: WATERMARK_OPACITY,
    textWidth,
    blockHeight,
    rotatedWidth,
    rotatedHeight,
    cellWidth,
    cellHeight,
    patternHeight: cellHeight * 2,
    secondRowOffsetX: cellWidth / 2,
    anchorX: WATERMARK_HORIZONTAL_CLEARANCE / 2,
    anchorY: WATERMARK_VERTICAL_CLEARANCE / 2 + textWidth * Math.sin(angle),
  };
}

export function formatPreviewWatermarkTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

export function buildPortalPreviewWatermarkLines(
  user: PortalPreviewWatermarkUser,
  viewedAt: Date,
): string[] {
  const name = user.name.trim() || user.account.trim() || '未知用户';
  const account = user.externalId?.trim() || user.account.trim() || name;
  const departmentName = user.departmentName?.trim() || '';
  const identity = departmentName ? `${departmentName}-${name}` : name;
  return [
    `${identity}--${account}-${formatPreviewWatermarkTime(viewedAt)}`,
    '首钢股份内部资料，严禁外传，违者必究',
  ];
}
