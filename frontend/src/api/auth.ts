import { ApiRequestError } from './content';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

export interface PortalUser {
  account: string;
  name: string;
  initial?: string;
  role?: string;
  externalId?: string;
  loginAt?: number;
}

export interface PortalUnifiedAuthConfig {
  enabled: boolean;
  provider: string;
  label: string;
  unavailableReason?: string;
}

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
  detail?: string;
}

interface PortalUserDto {
  account: string;
  name: string;
  initial?: string;
  role?: string;
  external_id?: string;
  login_at?: number;
}

interface PortalAuthDataDto {
  user: PortalUserDto;
}

interface PortalUnifiedAuthConfigDto {
  enabled: boolean;
  provider: string;
  label: string;
  unavailable_reason?: string;
}

function mapPortalUser(dto: PortalUserDto): PortalUser {
  return {
    account: dto.account,
    name: dto.name,
    initial: dto.initial,
    role: dto.role,
    externalId: dto.external_id,
    loginAt: dto.login_at,
  };
}

function mapUnifiedAuthConfig(dto: PortalUnifiedAuthConfigDto): PortalUnifiedAuthConfig {
  return {
    enabled: dto.enabled,
    provider: dto.provider,
    label: dto.label,
    unavailableReason: dto.unavailable_reason,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      if (!response.ok) {
        throw new ApiRequestError(normalizeUserFacingMessage('', '请求失败，请稍后重试。', response.status), response.status);
      }
      throw new Error('响应不是有效 JSON');
    }
  }
  if (!response.ok) {
    const message = normalizeUserFacingMessage(
      payload?.status_message || payload?.detail,
      '请求失败，请稍后重试。',
      response.status,
    );
    throw new ApiRequestError(message, response.status);
  }
  if (!payload) {
    throw new Error('响应内容为空');
  }
  return payload.data;
}

export async function loginPortal(params: {
  account: string;
  password: string;
  remember: boolean;
}): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  return mapPortalUser(data.user);
}

export async function fetchUnifiedAuthConfig(): Promise<PortalUnifiedAuthConfig> {
  const data = await requestPortalApi<PortalUnifiedAuthConfigDto>('/api/v1/auth/unified/config');
  return mapUnifiedAuthConfig(data);
}

export function normalizePortalRedirect(target: string | null | undefined): string {
  const value = (target || '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (/[\u0000-\u001f]/.test(value)) return '/';
  return value;
}

export function buildUnifiedAuthStartUrl(redirect: string | null | undefined): string {
  return `/api/v1/auth/unified/start?redirect=${encodeURIComponent(normalizePortalRedirect(redirect))}`;
}

export function buildPortalLogoutStartUrl(): string {
  return '/api/v1/auth/unified/logout/start';
}

const UNIFIED_AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_callback: '统一认证回调参数缺失，请重新发起登录。',
  invalid_state: '登录请求已失效，请重新认证。',
  oauth_token_failed: '统一认证登录失败，请重试或使用账号密码登录。',
  oauth_userinfo_failed: '未能获取统一认证用户信息，请重试或使用账号密码登录。',
  identity_missing: '统一认证返回的用户标识不足，请联系管理员。',
  invalid_account: '账号无效，请联系管理员开通账号。',
  permission_denied: '账号已认证但暂未开通知库权限，请联系管理员。',
  oauth_unavailable: '统一认证暂不可用，请使用账号密码登录。',
};

export function getUnifiedAuthErrorMessage(code: string | null | undefined): string {
  if (!code) return '';
  return UNIFIED_AUTH_ERROR_MESSAGES[code] || '统一认证登录失败，请使用账号密码登录。';
}

export async function fetchPortalMe(): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/me');
  return mapPortalUser(data.user);
}

export async function logoutPortal(): Promise<void> {
  await requestPortalApi<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' });
}

async function requestPortalApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(path, { credentials: 'include', ...init });
    return await parseResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new Error(normalizeUserFacingErrorMessage(error, '请求失败，请稍后重试。'));
  }
}
