import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBishengRuntimeConfig } from '../api/adminConfig';
import { useAuth } from '../hooks/useAuth';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, resolvePortalDialogsEmbedUrl } from '../utils/bishengEmbed';
import {
  PORTAL_APPROVAL_EVENT,
  PORTAL_DIALOG_CLOSED_MESSAGE,
  PORTAL_DIALOG_READY_MESSAGE,
  PORTAL_NAVIGATE_MESSAGE,
  PORTAL_NOTIFICATION_SUMMARY_REFRESH_EVENT,
  PORTAL_QA_EXPERT_NAVIGATE_MESSAGE,
  type PortalApprovalAction,
  isPortalApprovalAction,
  postPortalApprovalMessageToFrame,
} from '../utils/portalApprovalBridge';
import s from './ApprovalDialogHost.module.css';

const PORTAL_DIALOGS_PATH = '/workspace/portal-dialogs';
const EXPERT_QA_PATH_PREFIX = '/expert-qa/';

/** Allowed action codes for expert QA notifications delivered via {@link PORTAL_QA_EXPERT_NAVIGATE_MESSAGE}. */
const EXPERT_QA_ACTION_CODES = new Set([
  'qa_expert_invited',
  'qa_expert_answered',
  'qa_answer_commented',
  'qa_answer_accepted',
]);

const QA_ID_KEYS = [
  'questionId',
  'question_id',
  'qa_question_id',
  'objectId',
  'object_id',
  'targetId',
  'target_id',
  'id',
];

const QA_URL_KEYS = ['url', 'link', 'href', 'path'];

function extractQuestionIdFromUrl(value: unknown): string | number | null {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/(?:^|\/)(?:workspace\/)?expert-qa\/(\d+)(?:\D|$)/);
  return match ? match[1] : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidIdString(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== 'none' && normalized !== 'null' && normalized !== 'undefined';
}

function extractExpertQaQuestionId(raw: unknown): string | number | null {
  if (raw == null) return null;

  // Direct URL string.
  if (typeof raw === 'string') {
    return extractQuestionIdFromUrl(raw);
  }

  if (!isPlainObject(raw)) return null;

  // Breadth-first search through common wrapper keys.
  const queue: Array<Record<string, unknown>> = [raw];
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && queue.length > 0; depth += 1) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (QA_ID_KEYS.includes(key)) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && value.trim() !== '') {
          const numeric = Number(value);
          return Number.isNaN(numeric) ? value.trim() : numeric;
        }
      }
      if (QA_URL_KEYS.includes(key) && typeof value === 'string') {
        const fromUrl = extractQuestionIdFromUrl(value);
        if (fromUrl != null) return fromUrl;
      }
    }

    // Enqueue nested candidate objects for the next depth level.
    for (const value of Object.values(current)) {
      if (isPlainObject(value)) queue.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) {
          if (isPlainObject(item)) queue.push(item);
        }
      }
    }
  }

  return null;
}

const FRAME_READY_TIMEOUT_MS = 8000;

/**
 * Global host for the BiSheng approval / notification dialogs so they can be
 * opened from any portal page (not only the knowledge workbench). It mounts a
 * hidden, full-viewport iframe pointing at BiSheng's chrome-less dialog route
 * lazily on first open, then keeps it mounted for fast reopening. On a trigger
 * it shows the iframe as an overlay and postMessages the action. BiSheng renders
 * the dialog (with its own dim backdrop) and posts back when it closes, which
 * hides the overlay.
 *
 * Navigation guard: if the embedded page navigates to an `/expert-qa/*` route
 * (e.g. a clicked QA notification), the host closes the overlay and navigates
 * the top-level portal frame instead of leaving the detail page inside the iframe.
 */
export default function ApprovalDialogHost() {
  const { user } = useAuth();
  const { config } = usePortalConfig();
  const navigate = useNavigate();
  const userKey = user ? `${user.account}:${user.externalId || ''}:${user.loginAt || ''}` : '';
  const [runtimeAssetBaseUrl, setRuntimeAssetBaseUrl] = useState('');
  const [open, setOpen] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [waitingForFrame, setWaitingForFrame] = useState(false);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [frameMounted, setFrameMounted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pendingActionRef = useRef<PortalApprovalAction | null>(null);
  const readyTimeoutRef = useRef<number | null>(null);
  const initialFrameLoadRef = useRef(false);

  useEffect(() => {
    let active = true;
    void fetchBishengRuntimeConfig()
      .then((runtime) => {
        if (active) setRuntimeAssetBaseUrl(runtime.asset_base_url || '');
      })
      .catch(() => {
        // Fall back to the deployment default embed URL.
      });
    return () => {
      active = false;
    };
  }, []);

  const embedUrl = useMemo(
    () =>
      applyEmbedOriginOverride(
        resolvePortalDialogsEmbedUrl(runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url),
        import.meta.env.VITE_BISHENG_EMBED_ORIGIN,
      ),
    [runtimeAssetBaseUrl, config?.integrations?.bisheng_knowledge_entry_url],
  );

  const clearReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current !== null) {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
  }, []);

  const waitForFrameReady = useCallback((action: PortalApprovalAction) => {
    pendingActionRef.current = action;
    setWaitingForFrame(true);
    setFrameError(null);
    clearReadyTimeout();
    readyTimeoutRef.current = window.setTimeout(() => {
      if (!pendingActionRef.current) return;
      setFrameError('审批与消息窗口加载失败，请刷新页面或重新登录后再试。');
    }, FRAME_READY_TIMEOUT_MS);
  }, [clearReadyTimeout]);

  const finishPendingAction = useCallback(() => {
    pendingActionRef.current = null;
    setWaitingForFrame(false);
    setFrameError(null);
    clearReadyTimeout();
  }, [clearReadyTimeout]);

  const sendActionToReadyFrame = useCallback((action: PortalApprovalAction) => {
    const posted = postPortalApprovalMessageToFrame(frameRef.current, action);
    if (posted) {
      finishPendingAction();
      return;
    }
    setFrameReady(false);
    waitForFrameReady(action);
  }, [finishPendingAction, waitForFrameReady]);

  const sendActionToFrame = useCallback((action: PortalApprovalAction) => {
    if (!frameReady) {
      waitForFrameReady(action);
      return;
    }
    sendActionToReadyFrame(action);
  }, [frameReady, sendActionToReadyFrame, waitForFrameReady]);

  const navigateToExpertQaDetail = useCallback(
    (targetUrl: string) => {
      let pathname = targetUrl;
      let search = '';
      let hash = '';
      try {
        const parsed = new URL(targetUrl, window.location.origin);
        pathname = parsed.pathname;
        search = parsed.search;
        hash = parsed.hash;
      } catch {
        // targetUrl is already a pathname; keep it as-is.
      }
      // BiSheng may host the detail page under a /workspace prefix.
      const normalized = pathname.replace(/^\/workspace/, '') || '/';
      if (!normalized.startsWith(EXPERT_QA_PATH_PREFIX)) return false;
      // Backend sometimes serializes missing ids as the string "None".
      const params = new URLSearchParams(search);
      if (!isValidIdString(params.get('answerId'))) params.delete('answerId');
      if (!isValidIdString(params.get('commentId'))) params.delete('commentId');
      const cleanedSearch = params.toString() ? `?${params.toString()}` : '';
      setOpen(false);
      finishPendingAction();
      navigate(`${normalized}${cleanedSearch}${hash}`);
      return true;
    },
    [navigate, finishPendingAction],
  );

  const handleFrameLoad = useCallback(() => {
    if (!frameRef.current?.contentWindow) return;
    // The very first load is the portal-dialogs host itself; ignore it.
    if (!initialFrameLoadRef.current) {
      initialFrameLoadRef.current = true;
      return;
    }
    try {
      const frameLocation = frameRef.current.contentWindow.location;
      const pathname = frameLocation.pathname;
      const search = frameLocation.search;
      if (pathname.includes(PORTAL_DIALOGS_PATH)) return;
      const target = `${pathname}${search}`;
      if (navigateToExpertQaDetail(target)) return;
      // For any other unexpected navigation, close the overlay so the user is
      // not trapped on a blank iframe.
      setOpen(false);
      finishPendingAction();
    } catch {
      // Cross-origin iframe contents are not readable; ignore.
    }
  }, [navigateToExpertQaDetail, finishPendingAction]);

  useEffect(() => {
    function handleOpenEvent(event: Event) {
      const detail = (event as CustomEvent<{ action?: unknown }>).detail;
      if (!isPortalApprovalAction(detail?.action)) return;
      setFrameMounted(true);
      setOpen(true);
      sendActionToFrame(detail.action);
    }
    window.addEventListener(PORTAL_APPROVAL_EVENT, handleOpenEvent);
    return () => window.removeEventListener(PORTAL_APPROVAL_EVENT, handleOpenEvent);
  }, [sendActionToFrame]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === PORTAL_DIALOG_READY_MESSAGE) {
        setFrameReady(true);
        const action = pendingActionRef.current;
        if (action) sendActionToReadyFrame(action);
        return;
      }
      if (event.data?.type === PORTAL_DIALOG_CLOSED_MESSAGE) {
        setOpen(false);
        window.dispatchEvent(new Event(PORTAL_NOTIFICATION_SUMMARY_REFRESH_EVENT));
        return;
      }
      const isFromDialogFrame = event.source === frameRef.current?.contentWindow;
      if (event.data?.type === PORTAL_NAVIGATE_MESSAGE && isFromDialogFrame) {
        const payload = event.data?.payload ?? event.data?.data ?? event.data;
        const url =
          typeof payload === 'string'
            ? payload
            : payload?.url ?? payload?.path ?? payload?.href;
        if (typeof url === 'string') {
          navigateToExpertQaDetail(url);
        }
        return;
      }
      if (event.data?.type === PORTAL_QA_EXPERT_NAVIGATE_MESSAGE && isFromDialogFrame) {
        const payload = event.data;
        const actionCode = typeof payload?.actionCode === 'string' ? payload.actionCode : '';
        if (!EXPERT_QA_ACTION_CODES.has(actionCode)) {
          // eslint-disable-next-line no-console
          console.warn('[portal] Ignoring unsupported QA expert navigate action:', actionCode);
          return;
        }
        const questionId = extractExpertQaQuestionId(payload);
        if (questionId == null) {
          // eslint-disable-next-line no-console
          console.warn('[portal] QA expert navigate message without question id:', payload);
          return;
        }
        const answerId = isValidIdString(payload?.answerId) ? (payload.answerId as string) : null;
        const commentId = isValidIdString(payload?.commentId) ? (payload.commentId as string) : null;
        const params = new URLSearchParams();
        if (answerId) params.set('answerId', answerId);
        if (commentId) params.set('commentId', commentId);
        const query = params.toString();
        navigateToExpertQaDetail(`/expert-qa/${questionId}${query ? `?${query}` : ''}`);
        return;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sendActionToReadyFrame, navigateToExpertQaDetail]);

  const closeStatus = useCallback(() => {
    setOpen(false);
    finishPendingAction();
  }, [finishPendingAction]);

  useEffect(() => {
    setFrameReady(false);
    initialFrameLoadRef.current = false;
  }, [embedUrl]);

  useEffect(() => {
    setOpen(false);
    setFrameReady(false);
    setFrameMounted(false);
    initialFrameLoadRef.current = false;
    finishPendingAction();
  }, [finishPendingAction, userKey]);

  useEffect(() => clearReadyTimeout, [clearReadyTimeout]);

  // Logged-out users have no trigger and no BiSheng session; render nothing.
  // The iframe is mounted lazily on first open to avoid loading BiSheng's
  // portal-dialogs bundle on every page (and spamming the console with errors
  // from that bundle when it fails to read its own brand config).
  if (!user) return null;

  return (
    <div className={open ? s.overlayOpen : s.overlayHidden} aria-hidden={!open}>
      {frameMounted ? (
        <iframe
          key={userKey}
          ref={frameRef}
          className={s.frame}
          src={embedUrl}
          title="审批与消息"
          loading="lazy"
          onLoad={handleFrameLoad}
        />
      ) : null}
      {waitingForFrame ? (
        <div className={s.statusPanel} role="status" aria-live="polite">
          <div className={s.statusTitle}>{frameError ? '窗口打开失败' : '窗口加载中'}</div>
          <div className={s.statusText}>
            {frameError || '正在连接审批与消息窗口...'}
          </div>
          {frameError ? (
            <button type="button" className={s.statusButton} onClick={closeStatus}>
              关闭
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
