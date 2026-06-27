import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const useAuthSource = readFileSync('src/hooks/useAuth.ts', 'utf8');

test('auth hook checks the server session even when the local portal user cache is empty', () => {
  assert.match(useAuthSource, /void fetchPortalMe\(\)/);
  assert.doesNotMatch(useAuthSource, /if\s*\(!readStoredUser\(\)\)\s*return;/);
});

test('auth hook syncs portal user changes inside the same browser tab', () => {
  assert.match(useAuthSource, /PORTAL_USER_CHANGED_EVENT/);
  assert.match(useAuthSource, /window\.dispatchEvent\(new Event\(PORTAL_USER_CHANGED_EVENT\)\)/);
  assert.match(useAuthSource, /window\.addEventListener\(PORTAL_USER_CHANGED_EVENT,\s*syncUser\)/);
  assert.match(useAuthSource, /window\.removeEventListener\(PORTAL_USER_CHANGED_EVENT,\s*syncUser\)/);
});
