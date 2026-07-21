export interface PortalPreviewWatermarkUser {
  account: string;
  name: string;
  departmentName?: string;
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

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
  const departmentName = user.departmentName?.trim() || '';
  return [
    departmentName ? `${departmentName}-${name}` : name,
    formatPreviewWatermarkTime(viewedAt),
    '首钢集团内部资料',
  ];
}
