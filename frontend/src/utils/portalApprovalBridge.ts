export type PortalApprovalAction = 'tasks' | 'requests' | 'notifications';
export type PortalFrameAction = PortalApprovalAction | 'my_uploads';

export const PORTAL_APPROVAL_EVENT = 'shougang-portal:open-approval';
export const PENDING_PORTAL_APPROVAL_KEY = 'shougang-portal:pending-approval';

/** Posted by the embedded BiSheng dialog host when all dialogs have closed. */
export const PORTAL_DIALOG_CLOSED_MESSAGE = 'shougang-portal:dialog-closed';
/** Posted by the embedded BiSheng dialog host after its message listener is ready. */
export const PORTAL_DIALOG_READY_MESSAGE = 'shougang-portal:dialog-ready';
export const PORTAL_NOTIFICATION_SUMMARY_REFRESH_EVENT = 'shougang-portal:notification-summary-refresh';
/** Posted by the embedded BiSheng page to ask the portal to navigate in the top frame. */
export const PORTAL_NAVIGATE_MESSAGE = 'shougang-portal:navigate';
/** Posted by the embedded BiSheng notifications dialog when a QA expert notification is clicked. */
export const PORTAL_QA_EXPERT_NAVIGATE_MESSAGE = 'shougang-portal:qa-expert-navigate';

export const PORTAL_APPROVAL_MESSAGE_TYPES: Record<PortalFrameAction, string> = {
  tasks: 'shougang-portal:open-approval-tasks',
  requests: 'shougang-portal:open-approval-requests',
  notifications: 'shougang-portal:open-notifications',
  my_uploads: 'shougang-portal:open-my-upload',
};

export function isPortalApprovalAction(value: unknown): value is PortalApprovalAction {
  return value === 'tasks' || value === 'requests' || value === 'notifications';
}

export function getPortalApprovalMessageType(action: PortalFrameAction): string {
  return PORTAL_APPROVAL_MESSAGE_TYPES[action];
}

export function storePendingPortalApprovalAction(storage: Storage, action: PortalApprovalAction) {
  storage.setItem(PENDING_PORTAL_APPROVAL_KEY, action);
}

export function takePendingPortalApprovalAction(storage: Storage): PortalApprovalAction | null {
  const raw = storage.getItem(PENDING_PORTAL_APPROVAL_KEY);
  storage.removeItem(PENDING_PORTAL_APPROVAL_KEY);
  return isPortalApprovalAction(raw) ? raw : null;
}

export type PortalApprovalFrameTarget = {
  contentWindow: Pick<Window, 'postMessage'> | null;
};

/** Open a knowledge-space file inside the already-mounted knowledge iframe (no remount). */
export const PORTAL_OPEN_KNOWLEDGE_FILE_MESSAGE = 'shougang-portal:open-knowledge-file';

export interface PortalOpenKnowledgeFilePayload {
  spaceId: string;
  fileId: string;
  fileName?: string;
  folderId?: string;
  folderName?: string;
  /** Stable across retries so Client deep-link restore is not restarted N times. */
  openNonce?: string;
}

export function postPortalApprovalMessageToFrame(
  frame: PortalApprovalFrameTarget | null,
  action: PortalFrameAction,
): boolean {
  if (!frame?.contentWindow) return false;
  frame.contentWindow.postMessage({ type: getPortalApprovalMessageType(action) }, '*');
  return true;
}

/** Ask the knowledge iframe to open a file without changing iframe.src. */
export function postOpenKnowledgeFileToFrame(
  frame: PortalApprovalFrameTarget | null,
  payload: PortalOpenKnowledgeFilePayload,
): boolean {
  const spaceId = payload.spaceId?.trim();
  const fileId = payload.fileId?.trim();
  if (!frame?.contentWindow || !spaceId || !fileId) return false;
  frame.contentWindow.postMessage(
    {
      type: PORTAL_OPEN_KNOWLEDGE_FILE_MESSAGE,
      spaceId,
      fileId,
      fileName: payload.fileName?.trim() || undefined,
      folderId: payload.folderId?.trim() || undefined,
      folderName: payload.folderName?.trim() || undefined,
      openNonce: payload.openNonce?.trim() || undefined,
    },
    '*',
  );
  return true;
}

/**
 * Retry open-file postMessage while the embedded SPA finishes hydrating.
 * Mirrors the open-document-chat retry used on knowledge iframe load.
 * Uses one openNonce for the whole retry burst so Client restore is not restarted.
 */
export function postOpenKnowledgeFileWithRetry(
  frame: PortalApprovalFrameTarget | null,
  payload: PortalOpenKnowledgeFilePayload,
  options?: {
    maxAttempts?: number;
    intervalMs?: number;
    onTimer?: (timerId: number | null) => void;
  },
): number | null {
  const maxAttempts = options?.maxAttempts ?? 8;
  const intervalMs = options?.intervalMs ?? 250;
  if (!frame?.contentWindow) {
    options?.onTimer?.(null);
    return null;
  }

  const stablePayload: PortalOpenKnowledgeFilePayload = {
    ...payload,
    openNonce: payload.openNonce?.trim() || String(Date.now()),
  };

  let attempts = 0;
  const send = () => {
    postOpenKnowledgeFileToFrame(frame, stablePayload);
    attempts += 1;
    if (attempts >= maxAttempts && timerId !== null) {
      globalThis.clearInterval(timerId);
      timerId = null;
      options?.onTimer?.(null);
    }
  };

  send();
  let timerId: number | null = globalThis.setInterval(send, intervalMs) as unknown as number;
  options?.onTimer?.(timerId);
  return timerId;
}
