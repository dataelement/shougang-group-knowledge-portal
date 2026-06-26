import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORTAL_DIALOG_READY_MESSAGE,
  getPortalApprovalMessageType,
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
