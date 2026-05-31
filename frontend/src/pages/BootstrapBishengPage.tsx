import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Lock, Server, Timer, User } from 'lucide-react';
import { bootstrapBishengRuntimeConfig, fetchBishengBootstrapStatus } from '../api/bootstrap';
import s from './LoginPage.module.css';

export default function BootstrapBishengPage() {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');
  const [checking, setChecking] = useState(true);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchBishengBootstrapStatus()
      .then((status) => {
        if (!active) return;
        setRequired(status.required);
        setError(status.required ? '' : '数据源连接正常，初始化入口已关闭。');
      })
      .catch((err) => {
        if (!active) return;
        setRequired(true);
        setError(err instanceof Error ? err.message : '初始化状态检查失败');
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const nextBaseUrl = baseUrl.trim();
    const nextUsername = username.trim();
    const nextTimeout = Number(timeoutSeconds.trim());
    if (!/^https?:\/\//i.test(nextBaseUrl)) {
      setError('请输入有效的 Bisheng 后端 API 地址，必须以 http:// 或 https:// 开头');
      return;
    }
    if (!nextUsername) {
      setError('请输入 Bisheng 登录账号');
      return;
    }
    if (!password) {
      setError('请输入 Bisheng 登录密码');
      return;
    }
    if (!Number.isFinite(nextTimeout) || nextTimeout <= 0) {
      setError('请输入有效的超时时间（秒）');
      return;
    }

    setSubmitting(true);
    try {
      await bootstrapBishengRuntimeConfig({
        base_url: nextBaseUrl,
        username: nextUsername,
        password,
        timeout_seconds: nextTimeout,
      });
      setSuccess('数据源初始化成功，请使用管理员账号登录。');
      window.setTimeout(() => navigate('/login', { replace: true }), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link to="/" className={s.brand}>
            <img src="/shougang-stock-logo.png" alt="首钢股份知库" />
            <span>首钢股份知库</span>
          </Link>
          <div className={s.headerSpacer} />
          <Link to="/login" className={s.backHome}>
            <ArrowLeft size={14} />
            返回登录
          </Link>
        </div>
      </header>

      <main className={s.shell}>
        <aside
          className={s.visualSide}
          style={{ backgroundImage: 'linear-gradient(125deg, rgba(6,18,42,.78) 0%, rgba(12,38,84,.62) 42%, rgba(18,50,108,.45) 100%), url("/banner-hero-2.jpg")' }}
        >
          <span className={s.visualLabel}>数据源初始化</span>
          <div className={s.visualBlock}>
            <h1 className={s.visualTitle}>连接 Bisheng<br />恢复门户登录</h1>
            <p className={s.visualSub}>填写可用的 Bisheng 后端 API 地址与管理员账号，验证通过后门户将恢复正常登录流程。</p>
          </div>
          <div className={s.visualFootnote}>© 2026 首钢集团 · 首钢股份知库知识门户平台</div>
        </aside>

        <section className={s.formSide}>
          <div className={s.formInner}>
            <h2 className={s.formTitle}>Bisheng 初始化</h2>
            {checking ? <div className={s.bootstrapNotice}>正在检查初始化状态...</div> : null}
            {error ? (
              <div className={s.formError}>
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            ) : null}
            {success ? (
              <div className={s.formSuccess}>
                <CheckCircle2 size={14} />
                <span>{success}</span>
              </div>
            ) : null}

            <form noValidate onSubmit={handleSubmit}>
              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="bootstrap-base-url">Bisheng 后端 API 地址</label>
                <div className={s.fieldWrap}>
                  <Server size={16} className={s.leadIcon} />
                  <input
                    id="bootstrap-base-url"
                    className={s.input}
                    placeholder="例如：http://192.168.106.114:7860"
                    value={baseUrl}
                    disabled={!required || submitting}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                </div>
              </div>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="bootstrap-username">登录账号</label>
                <div className={s.fieldWrap}>
                  <User size={16} className={s.leadIcon} />
                  <input
                    id="bootstrap-username"
                    className={s.input}
                    placeholder="Bisheng 管理员账号"
                    value={username}
                    disabled={!required || submitting}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
              </div>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="bootstrap-password">登录密码</label>
                <div className={s.fieldWrap}>
                  <Lock size={16} className={s.leadIcon} />
                  <input
                    id="bootstrap-password"
                    className={s.input}
                    type="password"
                    placeholder="Bisheng 管理员密码"
                    value={password}
                    disabled={!required || submitting}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="bootstrap-timeout">请求超时（秒）</label>
                <div className={s.fieldWrap}>
                  <Timer size={16} className={s.leadIcon} />
                  <input
                    id="bootstrap-timeout"
                    className={s.input}
                    value={timeoutSeconds}
                    disabled={!required || submitting}
                    onChange={(event) => setTimeoutSeconds(event.target.value)}
                  />
                </div>
              </div>

              <button className={s.submitBtn} type="submit" disabled={!required || submitting || checking}>
                {submitting ? <span className={s.spinner} /> : null}
                {submitting ? '验证中...' : '保存并验证'}
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}
