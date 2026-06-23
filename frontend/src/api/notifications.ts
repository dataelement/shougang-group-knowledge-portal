import { ApiRequestError } from './content';
import { normalizeUserFacingMessage } from '../utils/userFacingErrors';

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
  try {
    const response = await fetch('/api/v1/portal/notifications/summary', {
      credentials: 'include',
    });
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<NotificationSummary> | null;
    if (!response.ok) {
      const message = normalizeUserFacingMessage(
        payload?.status_message || payload?.detail,
        '请求失败，请稍后重试。',
        response.status,
      );
      throw new ApiRequestError(message, response.status);
    }
    if (!payload) {
      throw new Error('响应不是有效 JSON');
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new Error(normalizeUserFacingMessage(error instanceof Error ? error.message : '', '请求失败，请稍后重试。'));
  }
}
