import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Loader2, LockKeyhole } from 'lucide-react';
import PageShell from '../components/PageShell';
import { accessShareDocument, fetchShareDocumentMeta, type ShareDocumentMeta } from '../api/content';
import { buildShareLoginRedirect, isShareLoginRequiredError } from '../utils/shareDocumentAccess';
import s from './ShareDocumentPage.module.css';

export default function ShareDocumentPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<ShareDocumentMeta | null>(null);
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [accessing, setAccessing] = useState(false);
  const [error, setError] = useState('');
  const [loginRequired, setLoginRequired] = useState(false);

  const submitAccess = useCallback(async (nextMeta: ShareDocumentMeta | null = meta) => {
    if (!token || !nextMeta || nextMeta.expired) return;
    setAccessing(true);
    setError('');
    setLoginRequired(false);
    try {
      const access = await accessShareDocument(token, {
        password,
        inviteCode,
      });
      navigate(
        `/space/${access.spaceId}/file/${access.fileId}?share_token=${encodeURIComponent(token)}`,
        { replace: true },
      );
    } catch (err) {
      if (isShareLoginRequiredError(err)) {
        setLoginRequired(true);
      }
      setError(err instanceof Error ? err.message : '分享访问失败');
    } finally {
      setAccessing(false);
    }
  }, [inviteCode, meta, navigate, password, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setLoginRequired(false);
    void fetchShareDocumentMeta(token)
      .then((nextMeta) => {
        if (!active) return;
        setMeta(nextMeta);
        if (!nextMeta.expired && !nextMeta.requiresPassword && !nextMeta.requiresInviteCode) {
          setAccessing(true);
          accessShareDocument(token, { password: '', inviteCode: '' })
            .then((access) => {
              if (!active) return;
              navigate(
                `/space/${access.spaceId}/file/${access.fileId}?share_token=${encodeURIComponent(token)}`,
                { replace: true },
              );
            })
            .catch((err) => {
              if (!active) return;
              if (isShareLoginRequiredError(err)) {
                setLoginRequired(true);
              }
              setError(err instanceof Error ? err.message : '分享访问失败');
            })
            .finally(() => {
              if (active) setAccessing(false);
            });
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '分享链接无效');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate, token]);

  const needsInput = Boolean(meta?.requiresPassword || meta?.requiresInviteCode);

  return (
    <PageShell>
      <div className={s.container}>
        <section className={s.panel}>
          <div className={s.icon}>
            <LockKeyhole size={26} />
          </div>
          <h1 className={s.title}>文档分享访问</h1>
          {loading ? (
            <div className={s.stateLine}>
              <Loader2 size={18} className={s.spin} />
              正在读取分享信息
            </div>
          ) : null}

          {!loading && meta ? (
            <>
              <div className={s.fileName}>{meta.fileName || '共享文档'}</div>
              {meta.expired ? (
                <div className={s.errorText}>该分享链接已过期</div>
              ) : null}
              {!meta.expired && needsInput ? (
                <div className={s.form}>
                  {meta.requiresPassword ? (
                    <label className={s.field}>
                      <span>访问密码</span>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoFocus
                      />
                    </label>
                  ) : null}
                  {meta.requiresInviteCode ? (
                    <label className={s.field}>
                      <span>邀请码</span>
                      <input
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                        maxLength={6}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className={s.primaryButton}
                    onClick={() => void submitAccess()}
                    disabled={accessing}
                  >
                    {accessing ? <Loader2 size={18} className={s.spin} /> : <ArrowRight size={18} />}
                    进入文档
                  </button>
                </div>
              ) : null}
              {!meta.expired && !needsInput ? (
                <div className={s.stateLine}>
                  <Loader2 size={18} className={s.spin} />
                  正在进入文档
                </div>
              ) : null}
            </>
          ) : null}

          {error ? <div className={s.errorText}>{error}</div> : null}
          {loginRequired ? (
            <button
              type="button"
              className={s.loginButton}
              onClick={() => navigate(buildShareLoginRedirect(token))}
            >
              登录后访问
            </button>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}
