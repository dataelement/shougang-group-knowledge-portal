import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  fetchUnifiedAuthConfig,
  logoutPortal,
  normalizePortalRedirect,
  restExchange,
  USER_UNREGISTERED_CODE,
  type PortalUnifiedAuthConfig,
} from '../api/auth';
import { ApiRequestError } from '../api/content';
import { clearAuthRecoverySuppress, savePortalUser } from '../hooks/useAuth';
import {
  PORTAL_AUTH_NOTICE_PARAM,
  PORTAL_AUTH_NOTICE_USER_UNREGISTERED,
} from '../utils/portalAuthNotice';
import {
  DEFAULT_REST_TOKEN_PARAM,
  resolveUrlTokenId,
} from '../utils/restAuthToken';
import s from './IamStartPage.module.css';

const POST_LOGIN_HOME = '/';
const WELCOME_FLAG = 'sg_just_logged_in';
const KNOWN_AUTH_ERROR_CODES = new Set([
  'invalid_callback',
  'token_expired',
  'permission_denied',
  'oauth_token_failed',
  'oauth_userinfo_failed',
  'oauth_unavailable',
  'identity_missing',
  'invalid_account',
  'user_unregistered',
]);

function markWelcome() {
  try {
    window.sessionStorage.setItem(WELCOME_FLAG, '1');
  } catch {
    // ignore session storage errors
  }
}

function buildLoginRedirectPath(params: URLSearchParams): string {
  const next = params.toString();
  return next ? `/login?${next}` : '/login';
}

function resolveExchangeAuthError(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return 'oauth_token_failed';
  if (err.reason) return err.reason;
  if (KNOWN_AUTH_ERROR_CODES.has(err.message)) return err.message;
  if (err.status === 401) return 'token_expired';
  if (err.status === 503) return 'oauth_unavailable';
  return 'oauth_token_failed';
}

export default function IamStartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState('正在验证统一身份登录票据，请稍候…');
  const exchangeAttemptRef = useRef<string | null>(null);
  const [unifiedAuthConfig, setUnifiedAuthConfig] = useState<PortalUnifiedAuthConfig | null>(null);
  const [unifiedAuthLoading, setUnifiedAuthLoading] = useState(true);

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  useEffect(() => {
    if (!isInIframe) return;
    try {
      window.top!.location.href = `${window.location.pathname}${window.location.search}`;
    } catch {
      // cross-origin access blocked — ignore
    }
  }, [isInIframe]);

  useEffect(() => {
    let active = true;
    setUnifiedAuthLoading(true);
    void fetchUnifiedAuthConfig()
      .then((next) => {
        if (active) setUnifiedAuthConfig(next);
      })
      .catch(() => {
        if (!active) return;
        setUnifiedAuthConfig({
          enabled: false,
          provider: 'custom',
          label: '统一身份认证',
          unavailableReason: 'request_failed',
        });
      })
      .finally(() => {
        if (active) setUnifiedAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isInIframe || unifiedAuthLoading) return;

    const params = new URLSearchParams(location.search);
    const redirect = normalizePortalRedirect(params.get('redirect'));
    const tokenParam = unifiedAuthConfig?.restTokenIdParam || DEFAULT_REST_TOKEN_PARAM;
    const tokenId = resolveUrlTokenId(location.search, tokenParam);

    if (!tokenId) {
      const loginParams = new URLSearchParams();
      if (redirect !== '/') loginParams.set('redirect', redirect);
      loginParams.set('auth_error', 'invalid_callback');
      navigate(buildLoginRedirectPath(loginParams), { replace: true });
      return;
    }

    if (!unifiedAuthConfig || unifiedAuthConfig.authMode !== 'rest') {
      const loginParams = new URLSearchParams();
      if (redirect !== '/') loginParams.set('redirect', redirect);
      loginParams.set('auth_error', 'oauth_unavailable');
      navigate(buildLoginRedirectPath(loginParams), { replace: true });
      return;
    }

    const attemptKey = `${tokenParam}:${tokenId}`;
    if (exchangeAttemptRef.current === attemptKey) return;
    exchangeAttemptRef.current = attemptKey;

    let active = true;
    void restExchange({ token_id: tokenId, redirect })
      .then((user) => {
        if (!active) return;
        clearAuthRecoverySuppress();
        savePortalUser(user);
        markWelcome();
        navigate(POST_LOGIN_HOME, { replace: true });
      })
      .catch(async (err) => {
        if (!active) return;
        exchangeAttemptRef.current = null;

        if (err instanceof ApiRequestError && err.reason === USER_UNREGISTERED_CODE) {
          await logoutPortal().catch(() => undefined);
          const noticeParams = new URLSearchParams();
          noticeParams.set(PORTAL_AUTH_NOTICE_PARAM, PORTAL_AUTH_NOTICE_USER_UNREGISTERED);
          if (redirect !== '/') noticeParams.set('redirect', redirect);
          navigate(buildLoginRedirectPath(noticeParams), { replace: true });
          return;
        }

        const loginParams = new URLSearchParams();
        if (redirect !== '/') loginParams.set('redirect', redirect);
        loginParams.set('auth_error', resolveExchangeAuthError(err));
        setStatusText('统一认证验证失败，正在返回登录页…');
        navigate(buildLoginRedirectPath(loginParams), { replace: true });
      });

    return () => {
      active = false;
    };
  }, [isInIframe, location.search, navigate, unifiedAuthConfig, unifiedAuthLoading]);

  if (isInIframe) return null;

  return (
    <div className={s.page}>
      <div className={s.card} role="status" aria-live="polite">
        <div className={s.spinner} aria-hidden="true" />
        <h1 className={s.title}>统一认证登录</h1>
        <p className={s.text}>{statusText}</p>
      </div>
    </div>
  );
}
