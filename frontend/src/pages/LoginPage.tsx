import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  Bookmark,
  Building2,
  Check,
  Eye,
  EyeOff,
  FolderLock,
  Lock,
  User,
  Users,
} from 'lucide-react';
import {
  buildUnifiedAuthStartUrl,
  fetchPortalMe,
  fetchUnifiedAuthConfig,
  getUnifiedAuthErrorMessage,
  loginPortal,
  normalizePortalRedirect,
  type PortalUnifiedAuthConfig,
} from '../api/auth';
import { fetchBishengBootstrapStatus } from '../api/bootstrap';
import { loadPortalUser, savePortalUser } from '../hooks/useAuth';
import { usePortalConfig } from '../hooks/usePortalConfig';
import s from './LoginPage.module.css';

const WELCOME_FLAG = 'sg_just_logged_in';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = usePortalConfig();
  const params = new URLSearchParams(location.search);
  const redirect = normalizePortalRedirect(params.get('redirect'));
  const unifiedAuthError = getUnifiedAuthErrorMessage(params.get('auth_error'));
  const loginBrandName = config?.site?.login_brand_name?.trim() || '首钢股份知库';
  const loginLogoUrl = config?.site?.login_logo_url?.trim() || '/shougang-stock-logo.png';

  useEffect(() => {
    const storedUser = loadPortalUser();
    if (storedUser) {
      navigate(redirect, { replace: true });
      return;
    }
    let active = true;
    void fetchPortalMe()
      .then((user) => {
        if (!active) return;
        savePortalUser(user);
        navigate(redirect, { replace: true });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, redirect]);

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [accountError, setAccountError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [unifiedAuthConfig, setUnifiedAuthConfig] = useState<PortalUnifiedAuthConfig | null>(null);
  const [unifiedAuthLoading, setUnifiedAuthLoading] = useState(true);
  const [unifiedAuthStarting, setUnifiedAuthStarting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchBishengBootstrapStatus()
      .then((status) => {
        if (active) setBootstrapRequired(status.required);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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

  function clearErrors() {
    setAccountError('');
    setPasswordError('');
    setFormError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();
    const a = account.trim();
    const p = password;
    let bad = false;
    if (!a) {
      setAccountError('请输入账号');
      bad = true;
    }
    if (!p) {
      setPasswordError('请输入密码');
      bad = true;
    }
    if (bad) return;

    setSubmitting(true);
    try {
      const user = await loginPortal({
        account: a,
        password: p,
        remember,
      });
      savePortalUser(user);
      try {
        if (remember) window.sessionStorage.setItem(WELCOME_FLAG, '1');
      } catch {
        // ignore session storage errors
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败，请重试。';
      setFormError(message || '登录失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  function handleUnifiedAuthLogin() {
    setUnifiedAuthStarting(true);
    window.location.assign(buildUnifiedAuthStartUrl(redirect));
  }

  const unifiedAuthAvailable = unifiedAuthConfig?.enabled === true;
  const unifiedAuthLabel = unifiedAuthConfig?.label?.trim() || '统一身份认证';
  const unifiedAuthDisabled = unifiedAuthLoading || !unifiedAuthAvailable || unifiedAuthStarting;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link to="/" className={s.brand}>
            <img src={loginLogoUrl} alt={loginBrandName} />
            <span>{loginBrandName}</span>
          </Link>
          <div className={s.headerSpacer} />
          <Link to="/" className={s.backHome}>
            <ArrowLeft size={14} />
            返回首页
          </Link>
        </div>
      </header>

      <main className={s.shell}>
        <aside
          className={s.visualSide}
          style={{ backgroundImage: `linear-gradient(125deg, rgba(6,18,42,.78) 0%, rgba(12,38,84,.62) 42%, rgba(18,50,108,.45) 100%), radial-gradient(circle at 75% 22%, rgba(97,150,255,.22) 0%, rgba(97,150,255,0) 32%), url("/banner-hero-1.jpg")` }}
        >
          <div className={s.visualGlow} />
          <span className={s.visualLabel}>企业账号登录</span>

          <div className={s.visualBlock}>
            <h1 className={s.visualTitle}>
              登录后<br />解锁全域知识
            </h1>
            <p className={s.visualSub}>
              使用首钢统一身份账号登录，访问您所在业务域的内部知识库、专家社区与协同应用。
            </p>
          </div>

          <div className={s.visualPoints}>
            <div className={s.visualPoint}>
              <div className={s.visualPointIco}><FolderLock size={18} /></div>
              <div>
                <div className={s.visualPointTitle}>受控知识库</div>
                <div className={s.visualPointDesc}>按权限可见内部技术规范、案例库</div>
              </div>
            </div>
            <div className={s.visualPoint}>
              <div className={s.visualPointIco}><Users size={18} /></div>
              <div>
                <div className={s.visualPointTitle}>专家直连</div>
                <div className={s.visualPointDesc}>向认证专家发起一对一提问</div>
              </div>
            </div>
            <div className={s.visualPoint}>
              <div className={s.visualPointIco}><Bookmark size={18} /></div>
              <div>
                <div className={s.visualPointTitle}>个人收藏</div>
                <div className={s.visualPointDesc}>订阅标签与文档，记录阅读历史</div>
              </div>
            </div>
            <div className={s.visualPoint}>
              <div className={s.visualPointIco}><Bell size={18} /></div>
              <div>
                <div className={s.visualPointTitle}>订阅推送</div>
                <div className={s.visualPointDesc}>关注业务域更新，到岗即知</div>
              </div>
            </div>
          </div>

          <div className={s.visualFootnote}>© 2026 首钢集团 · 首钢股份知库知识门户平台</div>
        </aside>

        <section className={s.formSide}>
          <div className={s.formInner}>
            <h2 className={s.formTitle}>账号登录</h2>

            <form noValidate onSubmit={handleSubmit}>
              {unifiedAuthError ? (
                <div className={s.formError}>
                  <AlertCircle size={14} />
                  <span>{unifiedAuthError}</span>
                </div>
              ) : null}
              {formError ? (
                <div className={s.formError}>
                  <AlertCircle size={14} />
                  <span>{formError}</span>
                </div>
              ) : null}
              {bootstrapRequired ? (
                <div className={s.bootstrapNotice}>
                  Bisheng 数据源不可用，请先
                  <Link to="/bootstrap/bisheng">初始化数据源</Link>
                </div>
              ) : null}

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="login-account">账号</label>
                <div className={s.fieldWrap}>
                  <User size={16} className={s.leadIcon} />
                  <input
                    id="login-account"
                    className={`${s.input} ${accountError ? s.inputInvalid : ''}`}
                    autoComplete="username"
                    placeholder="账号ID"
                    value={account}
                    onChange={(e) => {
                      setAccount(e.target.value);
                      if (accountError) setAccountError('');
                      if (formError) setFormError('');
                    }}
                  />
                </div>
                {accountError ? (
                  <div className={s.fieldError}>
                    <AlertCircle size={12} />
                    <span>{accountError}</span>
                  </div>
                ) : null}
              </div>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="login-password">密码</label>
                <div className={s.fieldWrap}>
                  <Lock size={16} className={s.leadIcon} />
                  <input
                    id="login-password"
                    className={`${s.input} ${passwordError ? s.inputInvalid : ''}`}
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                      if (formError) setFormError('');
                    }}
                  />
                  <button
                    type="button"
                    className={s.pwdToggle}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPwd((prev) => !prev)}
                  >
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordError ? (
                  <div className={s.fieldError}>
                    <AlertCircle size={12} />
                    <span>{passwordError}</span>
                  </div>
                ) : null}
              </div>

              <div className={s.row}>
                <label className={s.checkbox}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span className={s.checkboxBox}>
                    <Check size={12} />
                  </span>
                  记住我（7 天内免登录）
                </label>
              </div>

              <button type="submit" className={s.submitBtn} disabled={submitting}>
                {submitting ? <span className={s.spinner} /> : null}
                <span>{submitting ? '登录中' : '登录'}</span>
              </button>
            </form>

            <div className={s.divider}>其他登录方式</div>
            <div className={s.ssoRow}>
              <button
                type="button"
                className={s.ssoBtn}
                disabled={unifiedAuthDisabled}
                title={unifiedAuthAvailable ? unifiedAuthLabel : '统一身份认证暂不可用'}
                onClick={handleUnifiedAuthLogin}
              >
                <Building2 size={16} />
                <span>{unifiedAuthStarting ? '跳转中' : `${unifiedAuthLabel}登录`}</span>
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
