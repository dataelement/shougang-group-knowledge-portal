import type { BishengRuntimeConfig } from './adminConfig';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
}

export interface BishengBootstrapStatus {
  required: boolean;
  connected: boolean;
  message: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new Error(response.ok ? '响应内容为空' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(response.ok ? '响应不是有效 JSON' : normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status));
  }
  if (!response.ok) {
    throw new Error(normalizeUserFacingMessage(payload?.status_message, '请求失败，请稍后重试。', response.status));
  }
  return payload.data;
}

export async function fetchBishengBootstrapStatus() {
  return requestBootstrapApi<BishengBootstrapStatus>('/api/v1/bootstrap/bisheng/status');
}

export async function bootstrapBishengRuntimeConfig(payload: {
  base_url: string;
  username: string;
  password: string;
  timeout_seconds: number;
}) {
  return requestBootstrapApi<BishengRuntimeConfig>('/api/v1/bootstrap/bisheng', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...payload,
      asset_base_url: '',
    }),
  });
}

async function requestBootstrapApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, init);
    return await parseResponse<T>(response);
  } catch (error) {
    throw new Error(normalizeUserFacingErrorMessage(error, '请求失败，请稍后重试。'));
  }
}
