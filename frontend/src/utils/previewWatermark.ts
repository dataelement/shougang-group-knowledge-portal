export interface PortalPreviewWatermarkUser {
  account: string;
  name: string;
  departmentName?: string;
  externalId?: string;
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const WATERMARK_HORIZONTAL_STEP = 240;
const WATERMARK_VERTICAL_STEP = 160;

export interface PortalPreviewWatermarkGrid {
  columns: number;
  rows: number;
  tileCount: number;
}

export function calculatePortalPreviewWatermarkGrid(
  width: number,
  height: number,
): PortalPreviewWatermarkGrid {
  const safeWidth = Number.isFinite(width) ? Math.max(width, 0) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(height, 0) : 0;
  const columns = Math.max(2, Math.ceil(safeWidth / WATERMARK_HORIZONTAL_STEP) + 1);
  const rows = Math.max(2, Math.ceil(safeHeight / WATERMARK_VERTICAL_STEP) + 1);
  return { columns, rows, tileCount: columns * rows };
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
