export type PortalApprovalAction = 'tasks' | 'requests' | 'notifications';

export const PORTAL_APPROVAL_EVENT = 'shougang-portal:open-approval';
export const PENDING_PORTAL_APPROVAL_KEY = 'shougang-portal:pending-approval';

/** Posted by the embedded BiSheng dialog host when all dialogs have closed. */
export const PORTAL_DIALOG_CLOSED_MESSAGE = 'shougang-portal:dialog-closed';

export const PORTAL_APPROVAL_MESSAGE_TYPES: Record<PortalApprovalAction, string> = {
  tasks: 'shougang-portal:open-approval-tasks',
  requests: 'shougang-portal:open-approval-requests',
  notifications: 'shougang-portal:open-notifications',
};

export function isPortalApprovalAction(value: unknown): value is PortalApprovalAction {
  return value === 'tasks' || value === 'requests' || value === 'notifications';
}

export function getPortalApprovalMessageType(action: PortalApprovalAction): string {
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

export function postPortalApprovalMessageToFrame(
  frame: PortalApprovalFrameTarget | null,
  action: PortalApprovalAction,
): boolean {
  if (!frame?.contentWindow) return false;
  frame.contentWindow.postMessage({ type: getPortalApprovalMessageType(action) }, '*');
  return true;
}
