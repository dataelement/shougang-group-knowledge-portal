import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hostSource = readFileSync('src/components/ApprovalDialogHost.tsx', 'utf8');

test('approval dialog iframe is keyed by current portal user identity', () => {
  assert.match(hostSource, /const userKey = user \?/);
  assert.match(hostSource, /<iframe\s+key=\{userKey\}/);
});

test('approval dialog host resets communication state when portal user changes', () => {
  assert.match(hostSource, /setOpen\(false\);\s*setFrameReady\(false\);\s*finishPendingAction\(\);/s);
  assert.match(hostSource, /\[finishPendingAction, userKey\]/);
});
