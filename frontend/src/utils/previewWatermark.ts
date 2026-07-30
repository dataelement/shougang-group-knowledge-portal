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
const WATERMARK_OPACITY = 0.31;
const WATERMARK_MIN_CELL_WIDTH = 240;
const WATERMARK_MIN_CELL_HEIGHT = 180;
const WATERMARK_HORIZONTAL_CLEARANCE = 48;
const WATERMARK_VERTICAL_CLEARANCE = 36;

export const PORTAL_PREVIEW_WATERMARK_FONT_FAMILY = [
  'WenQuanYi Zen Hei',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'sans-serif',
].map((font) => (font === 'sans-serif' ? font : `"${font}"`)).join(', ');

export interface PortalPreviewWatermarkLayout {
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
  anchorX: number;
  anchorY: number;
}

export interface PortalPreviewWatermarkPosition {
  x: number;
  y: number;
  rowIndex: number;
  columnIndex: number;
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

export function calculatePortalPreviewWatermarkLayout(
  lineWidths: readonly number[],
): PortalPreviewWatermarkLayout {
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
    anchorX: WATERMARK_HORIZONTAL_CLEARANCE / 2,
    anchorY: WATERMARK_VERTICAL_CLEARANCE / 2 + textWidth * Math.sin(angle),
  };
}

export function calculatePortalPreviewWatermarkPositions(
  surfaceWidth: number,
  surfaceHeight: number,
  layout: PortalPreviewWatermarkLayout,
): PortalPreviewWatermarkPosition[] {
  if (
    !Number.isFinite(surfaceWidth)
    || !Number.isFinite(surfaceHeight)
    || surfaceWidth <= 0
    || surfaceHeight <= 0
  ) {
    return [];
  }

  const positions: PortalPreviewWatermarkPosition[] = [];
  let rowIndex = 0;
  for (let rowTop = 0; rowTop < surfaceHeight; rowTop += layout.cellHeight) {
    const rowOffsetX = rowIndex % 2 === 0 ? 0 : layout.cellWidth / 2;
    let columnIndex = 0;
    for (
      let cellLeft = rowOffsetX;
      cellLeft + layout.anchorX < surfaceWidth;
      cellLeft += layout.cellWidth
    ) {
      positions.push({
        x: cellLeft + layout.anchorX,
        y: rowTop + layout.anchorY,
        rowIndex,
        columnIndex,
      });
      columnIndex += 1;
    }
    rowIndex += 1;
  }
  return positions;
}

export function formatPreviewWatermarkTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}/${values.get('month')}/${values.get('day')}`;
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
    `${identity}-${account}-${formatPreviewWatermarkTime(viewedAt)}`,
    '首钢股份内部资料，严禁外传，违者必究',
  ];
}
