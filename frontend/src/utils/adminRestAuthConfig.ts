import {
  updateRestAuthRuntimeConfig,
  type RestAuthRuntimeConfig,
} from '../api/adminConfig';

export interface RestAuthDraft {
  enabled: boolean;
  rest_base_url: string;
  rest_app_id: string;
  authenticate_url: string;
  token_valid_url: string;
  user_attributes_url: string;
  rest_token_id_param: string;
  http_timeout_seconds: string;
  token_check_interval_seconds: string;
  verify_tls: boolean;
  login_sync_hmac_secret: string;
  login_sync_signature_header: string;
  bisheng_lookup_required: boolean;
}

/** 留空则后端按 Base URL 拼接；支持 `/idp/...`、`idp/...`、无协议的 host/path。 */
export function normalizeOptionalRestUrl(value: string, baseUrl: string): string {
  const text = value.trim();
  if (!text) return '';
  if (/\{[^}]+\}/.test(text)) return '';
  if (/^https?:\/\//i.test(text)) return text;

  const base = baseUrl.trim().replace(/\/+$/, '');
  if (text.startsWith('/')) {
    return base ? `${base}${text}` : text;
  }
  if (base && /^idp\//i.test(text)) {
    return `${base}/${text.replace(/^\/+/, '')}`;
  }
  if (/^[\w.-]+\//.test(text) || /^[\w.-]+\.[a-z]{2,}/i.test(text)) {
    return `https://${text.replace(/^\/+/, '')}`;
  }
  if (base && /^getIDP/i.test(text)) {
    return `${base}/idp/restful/${text}`;
  }
  return text;
}

function sanitizeOptionalRestUrlField(value: string | undefined, baseUrl: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const normalized = normalizeOptionalRestUrl(raw, baseUrl);
  return /^https?:\/\//i.test(normalized) ? normalized : raw;
}

export function createRestAuthDraft(current?: RestAuthRuntimeConfig): RestAuthDraft {
  const restBaseUrl = current?.rest_base_url ?? '';
  return {
    enabled: current?.enabled ?? false,
    rest_base_url: restBaseUrl,
    rest_app_id: current?.rest_app_id ?? '',
    authenticate_url: sanitizeOptionalRestUrlField(current?.authenticate_url, restBaseUrl),
    token_valid_url: sanitizeOptionalRestUrlField(current?.token_valid_url, restBaseUrl),
    user_attributes_url: sanitizeOptionalRestUrlField(current?.user_attributes_url, restBaseUrl),
    rest_token_id_param: current?.rest_token_id_param ?? 'tokenId',
    http_timeout_seconds: String(current?.http_timeout_seconds ?? 10),
    token_check_interval_seconds: String(current?.token_check_interval_seconds ?? 300),
    verify_tls: current?.verify_tls ?? true,
    login_sync_hmac_secret: '',
    login_sync_signature_header: current?.login_sync_signature_header ?? 'X-Signature',
    bisheng_lookup_required: current?.bisheng_lookup_required ?? false,
  };
}

export function validateRestAuthDraft(
  draft: RestAuthDraft,
  config?: RestAuthRuntimeConfig | null,
): { error?: string; payload?: Parameters<typeof updateRestAuthRuntimeConfig>[0] } {
  if (draft.enabled && !draft.rest_base_url.trim()) {
    return { error: '启用 REST 前需要填写 REST Base URL' };
  }
  if (draft.enabled && !draft.rest_app_id.trim()) {
    return { error: '启用 REST 前需要填写 REST AppId' };
  }
  const normalizedUrls = {
    rest_base_url: draft.rest_base_url.trim(),
    authenticate_url: normalizeOptionalRestUrl(draft.authenticate_url, draft.rest_base_url),
    token_valid_url: normalizeOptionalRestUrl(draft.token_valid_url, draft.rest_base_url),
    user_attributes_url: normalizeOptionalRestUrl(draft.user_attributes_url, draft.rest_base_url),
  };
  for (const [field, value] of [
    ['REST Base URL', normalizedUrls.rest_base_url],
    ['authenticate_url', normalizedUrls.authenticate_url],
    ['token_valid_url', normalizedUrls.token_valid_url],
    ['user_attributes_url', normalizedUrls.user_attributes_url],
  ] as const) {
    if (value && !/^https?:\/\//i.test(value)) {
      if (value.startsWith('/') && !normalizedUrls.rest_base_url) {
        return { error: `${field} 为相对路径时需先填写 REST Base URL，或直接留空自动拼接` };
      }
      return {
        error: `${field} 请填写完整 URL（以 http:// 或 https:// 开头），或留空由系统自动拼接`,
      };
    }
  }
  const httpTimeout = Number(draft.http_timeout_seconds);
  if (!Number.isFinite(httpTimeout) || httpTimeout <= 0) {
    return { error: 'HTTP 超时需为大于 0 的数字秒' };
  }
  const checkInterval = Number(draft.token_check_interval_seconds);
  if (!Number.isInteger(checkInterval) || checkInterval <= 0) {
    return { error: 'Token 校验间隔需为大于 0 的整数秒' };
  }
  const tokenParam = draft.rest_token_id_param.trim() || 'tokenId';
  if (!/^[A-Za-z0-9_]+$/.test(tokenParam)) {
    return { error: 'URL tokenId 参数名仅允许字母数字下划线' };
  }

  return {
    payload: {
      enabled: draft.enabled,
      rest_base_url: normalizedUrls.rest_base_url,
      rest_app_id: draft.rest_app_id.trim(),
      authenticate_url: normalizedUrls.authenticate_url,
      token_valid_url: normalizedUrls.token_valid_url,
      user_attributes_url: normalizedUrls.user_attributes_url,
      rest_token_id_param: tokenParam,
      http_timeout_seconds: httpTimeout,
      token_check_interval_seconds: checkInterval,
      verify_tls: draft.verify_tls,
      login_sync_hmac_secret: draft.login_sync_hmac_secret,
      login_sync_signature_header: draft.login_sync_signature_header.trim() || 'X-Signature',
      bisheng_lookup_required: draft.bisheng_lookup_required,
    },
  };
}
