import { ApiRequestError } from './content';

export interface NotificationSummary {
  /** Approval tasks pending the current user's action (待办). */
  todo: number;
  /** Total unread messages (消息) — matches the notifications dialog "全部" badge. */
  messages: number;
  /** Sum of the above; drives the aggregate red dot on the avatar. */
  total: number;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
  detail?: string;
}

export async function fetchNotificationSummary(): Promise<NotificationSummary> {
  const response = await fetch('/api/v1/portal/notifications/summary', {
    credentials: 'include',
  });
  const payload = (await response.json()) as ApiEnvelope<NotificationSummary>;
  if (!response.ok) {
    throw new ApiRequestError(payload?.status_message || payload?.detail || '请求失败', response.status);
  }
  return payload.data;
}
