import { ApiRequestError } from './content';
import { normalizeUserFacingErrorMessage, normalizeUserFacingMessage } from '../utils/userFacingErrors';

export interface PortalUser {
  account: string;
  name: string;
  initial?: string;
  role?: string;
  departmentName?: string;
  externalId?: string;
  loginAt?: number;
  authSource?: string;
  /** Org department admin from BiSheng department settings (not portal site admin). */
  isDepartmentAdmin?: boolean;
}

export interface PortalUnifiedAuthConfig {
  enabled: boolean;
  authMode?: 'oauth' | 'rest' | 'none';
  provider: string;
  label: string;
  restTokenIdParam?: string;
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
  department_name?: string;
  external_id?: string;
  login_at?: number;
  is_department_admin?: boolean;
}

interface PortalAuthDataDto {
  user: PortalUserDto;
  auth_source?: string;
}

interface PortalUnifiedAuthConfigDto {
  enabled: boolean;
  auth_mode?: string;
  provider: string;
  label: string;
  rest_token_id_param?: string;
  unavailable_reason?: string;
}

export const AUTH_SOURCE_STORAGE_KEY = 'sg_portal_auth_source';
export const USER_UNREGISTERED_CODE = 'user_unregistered';

export const MULTI_LOGIN_CONFLICT_CODE = 10612;

function mapPortalUser(dto: PortalUserDto, authSource = ''): PortalUser {
  return {
    account: dto.account,
    name: dto.name,
    initial: dto.initial,
    role: dto.role,
    departmentName: dto.department_name,
    externalId: dto.external_id,
    loginAt: dto.login_at,
    isDepartmentAdmin: Boolean(dto.is_department_admin),
    authSource: authSource || undefined,
  };
}

function mapUnifiedAuthConfig(dto: PortalUnifiedAuthConfigDto): PortalUnifiedAuthConfig {
  const authMode = dto.auth_mode === 'rest' || dto.auth_mode === 'oauth' || dto.auth_mode === 'none'
    ? dto.auth_mode
    : (dto.enabled ? 'oauth' : 'none');
  return {
    enabled: dto.enabled,
    authMode,
    provider: dto.provider,
    label: dto.label,
    restTokenIdParam: dto.rest_token_id_param || 'tokenId',
    unavailableReason: dto.unavailable_reason,
  };
}

export function savePortalAuthSource(authSource: string) {
  try {
    if (authSource) {
      window.sessionStorage.setItem(AUTH_SOURCE_STORAGE_KEY, authSource);
    } else {
      window.sessionStorage.removeItem(AUTH_SOURCE_STORAGE_KEY);
    }
  } catch {
    // ignore session storage errors
  }
}

export function loadPortalAuthSource(): string {
  try {
    return window.sessionStorage.getItem(AUTH_SOURCE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function clearPortalAuthSource() {
  savePortalAuthSource('');
}

function persistAuthResult(user: PortalUser, authSource = '') {
  if (authSource) {
    savePortalAuthSource(authSource);
    return { ...user, authSource };
  }
  return user;
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
    const dataCode = typeof payload?.data === 'object' && payload?.data !== null
      ? String((payload.data as { code?: string }).code || '')
      : '';
    throw new ApiRequestError(message, response.status, payload?.status_code, {
      reason: dataCode || undefined,
    });
  }
  if (!payload) {
    throw new Error('响应内容为空');
  }
  if (payload.status_code !== 200) {
    const message = normalizeUserFacingMessage(
      payload.status_message || payload.detail,
      '请求失败，请稍后重试。',
      response.status,
    );
    throw new ApiRequestError(message, response.status, payload.status_code);
  }
  return payload.data;
}

export async function loginPortal(params: {
  account: string;
  password: string;
  remember: boolean;
  forceLogin?: boolean;
}): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account: params.account,
      password: params.password,
      remember: params.remember,
      force_login: Boolean(params.forceLogin),
    }),
  });
  return persistAuthResult(mapPortalUser(data.user), data.auth_source || '');
}

export async function restExchange(params: {
  token_id: string;
  redirect: string;
  remember?: boolean;
}): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/rest/exchange', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token_id: params.token_id,
      redirect: params.redirect,
      remember: params.remember ?? true,
    }),
  });
  return persistAuthResult(mapPortalUser(data.user), data.auth_source || 'rest_auth');
}

export async function restLogin(params: {
  account: string;
  password: string;
  remember: boolean;
  redirect: string;
  forceLogin?: boolean;
  captchaKey?: string;
  captcha?: string;
}): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/rest/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account: params.account,
      password: params.password,
      remember: params.remember,
      redirect: params.redirect,
      force_login: Boolean(params.forceLogin),
      captcha_key: params.captchaKey || '',
      captcha: params.captcha || '',
    }),
  });
  return persistAuthResult(mapPortalUser(data.user), data.auth_source || 'rest_auth');
}

export async function confirmUnifiedAuthLogin(): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/unified/confirm', { method: 'POST' });
  return persistAuthResult(mapPortalUser(data.user), data.auth_source || 'unified_auth');
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
  return `/api/v1/auth/unified/logout/start?redirect=${encodeURIComponent(normalizePortalRedirect('/login?logged_out=1'))}`;
}

const UNIFIED_AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_callback: '统一认证回调参数缺失，请重新发起登录。',
  invalid_state: '登录请求已失效，请重新认证。',
  oauth_token_failed: '统一认证登录失败，请重试或使用账号密码登录。',
  oauth_userinfo_failed: '未能获取统一认证用户信息，请重试或使用账号密码登录。',
  identity_missing: '统一认证返回的用户标识不足，请联系管理员。',
  invalid_account: '账号无效，请联系管理员开通账号。',
  user_unregistered: '您未在本系统注册，请联系管理员。',
  permission_denied: '账号已认证但暂未开通知库权限，请联系管理员。',
  oauth_unavailable: '统一认证暂不可用，请使用账号密码登录。',
  multi_login_conflict: '该用户已在其它设备登录，是否继续登录？',
  token_expired: '统一认证已过期，请重新登录。',
};

export function getUnifiedAuthErrorMessage(code: string | null | undefined): string {
  if (!code) return '';
  return UNIFIED_AUTH_ERROR_MESSAGES[code] || '统一认证登录失败，请使用账号密码登录。';
}

export async function fetchPortalMe(): Promise<PortalUser> {
  const data = await requestPortalApi<PortalAuthDataDto>('/api/v1/auth/me');
  return persistAuthResult(mapPortalUser(data.user), data.auth_source || '');
}

export async function logoutPortal(): Promise<void> {
  await requestPortalApi<{ ok: boolean }>('/api/v1/auth/logout', { method: 'POST' });
  clearPortalAuthSource();
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
