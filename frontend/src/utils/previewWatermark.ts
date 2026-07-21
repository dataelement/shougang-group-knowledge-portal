export interface PortalPreviewWatermarkUser {
  account: string;
  name: string;
  externalId?: string;
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

export function formatPreviewWatermarkTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')} ${values.get('hour')}:${values.get('minute')}:${values.get('second')}`;
}

export function buildPortalPreviewWatermarkLines(
  user: PortalPreviewWatermarkUser,
  viewedAt: Date,
): string[] {
  const account = user.account.trim();
  const name = user.name.trim() || account || '未知用户';
  const employeeId = user.externalId?.trim() || account || '—';
  return [
    `姓名：${name}`,
    `工号/账号：${employeeId}`,
    `北京时间：${formatPreviewWatermarkTime(viewedAt)}`,
    '首钢集团内部资料',
  ];
}
