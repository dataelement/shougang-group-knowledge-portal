import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_DIALOG_READY_MESSAGE,
  PORTAL_NOTIFICATION_SUMMARY_REFRESH_EVENT,
  PORTAL_OPEN_KNOWLEDGE_FILE_MESSAGE,
  getPortalApprovalMessageType,
  postOpenKnowledgeFileToFrame,
  postOpenKnowledgeFileWithRetry,
  postPortalApprovalMessageToFrame,
  storePendingPortalApprovalAction,
  takePendingPortalApprovalAction,
} from '../src/utils/portalApprovalBridge';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };
}

test('portal approval actions map to iframe message types', () => {
  assert.equal(getPortalApprovalMessageType('tasks'), 'shougang-portal:open-approval-tasks');
  assert.equal(getPortalApprovalMessageType('requests'), 'shougang-portal:open-approval-requests');
  assert.equal(getPortalApprovalMessageType('notifications'), 'shougang-portal:open-notifications');
  assert.equal(getPortalApprovalMessageType('my_uploads'), 'shougang-portal:open-my-upload');
});

test('portal dialog ready message is stable for iframe handshake', () => {
  assert.equal(PORTAL_DIALOG_READY_MESSAGE, 'shougang-portal:dialog-ready');
});

test('portal notification summary refresh event is stable for header badge refresh', () => {
  assert.equal(PORTAL_NOTIFICATION_SUMMARY_REFRESH_EVENT, 'shougang-portal:notification-summary-refresh');
});

test('pending approval action is consumed once from storage', () => {
  const storage = createMemoryStorage();
  storePendingPortalApprovalAction(storage, 'requests');

  assert.equal(takePendingPortalApprovalAction(storage), 'requests');
  assert.equal(takePendingPortalApprovalAction(storage), null);
});

test('invalid pending approval action is ignored and removed', () => {
  const storage = createMemoryStorage();
  storage.setItem('shougang-portal:pending-approval', 'unknown');

  assert.equal(takePendingPortalApprovalAction(storage), null);
  assert.equal(storage.getItem('shougang-portal:pending-approval'), null);
});

test('postPortalApprovalMessageToFrame sends the mapped message to iframe window', () => {
  const messages: unknown[] = [];
  const sent = postPortalApprovalMessageToFrame({
    contentWindow: {
      postMessage(message: unknown) {
        messages.push(message);
      },
    } as Pick<Window, 'postMessage'>,
  }, 'notifications');

  assert.equal(sent, true);
  assert.deepEqual(messages, [{ type: 'shougang-portal:open-notifications' }]);
});

test('postPortalApprovalMessageToFrame sends my uploads message to knowledge iframe', () => {
  const messages: unknown[] = [];
  const sent = postPortalApprovalMessageToFrame({
    contentWindow: {
      postMessage(message: unknown) {
        messages.push(message);
      },
    } as Pick<Window, 'postMessage'>,
  }, 'my_uploads');

  assert.equal(sent, true);
  assert.deepEqual(messages, [{ type: 'shougang-portal:open-my-upload' }]);
});

test('postPortalApprovalMessageToFrame reports false when iframe is unavailable', () => {
  assert.equal(postPortalApprovalMessageToFrame(null, 'tasks'), false);
  assert.equal(postPortalApprovalMessageToFrame({ contentWindow: null }, 'tasks'), false);
});

test('postOpenKnowledgeFileToFrame sends open-knowledge-file payload', () => {
  const messages: unknown[] = [];
  const sent = postOpenKnowledgeFileToFrame({
    contentWindow: {
      postMessage(message: unknown) {
        messages.push(message);
      },
    } as Pick<Window, 'postMessage'>,
  }, {
    spaceId: '12',
    fileId: '34',
    fileName: 'spec.pdf',
    openNonce: 'nonce-1',
  });

  assert.equal(sent, true);
  assert.equal(PORTAL_OPEN_KNOWLEDGE_FILE_MESSAGE, 'shougang-portal:open-knowledge-file');
  assert.deepEqual(messages, [{
    type: 'shougang-portal:open-knowledge-file',
    spaceId: '12',
    fileId: '34',
    fileName: 'spec.pdf',
    folderId: undefined,
    folderName: undefined,
    openNonce: 'nonce-1',
  }]);
});

test('postOpenKnowledgeFileToFrame requires spaceId and fileId', () => {
  assert.equal(postOpenKnowledgeFileToFrame({
    contentWindow: {
      postMessage() {},
    } as Pick<Window, 'postMessage'>,
  }, { spaceId: '', fileId: '1' }), false);
  assert.equal(postOpenKnowledgeFileToFrame(null, { spaceId: '1', fileId: '2' }), false);
});

test('postOpenKnowledgeFileWithRetry reuses one openNonce across attempts', () => {
  const messages: Array<{ openNonce?: string }> = [];
  const frame = {
    contentWindow: {
      postMessage(message: unknown) {
        messages.push(message as { openNonce?: string });
      },
    } as Pick<Window, 'postMessage'>,
  };

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let intervalCb: (() => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).setInterval = (cb: () => void) => {
    intervalCb = cb;
    return 1;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).clearInterval = () => {};

  try {
    postOpenKnowledgeFileWithRetry(frame, {
      spaceId: '1',
      fileId: '2',
      openNonce: 'stable-nonce',
    }, { maxAttempts: 3, intervalMs: 10 });

    assert.equal(messages.length, 1);
    intervalCb?.();
    intervalCb?.();
    assert.equal(messages.length, 3);
    assert.ok(messages.every((msg) => msg.openNonce === 'stable-nonce'));
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
