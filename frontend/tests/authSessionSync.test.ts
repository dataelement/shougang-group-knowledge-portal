import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const useAuthSource = readFileSync('src/hooks/useAuth.ts', 'utf8');

test('auth hook checks the server session even when the local portal user cache is empty', () => {
  assert.match(useAuthSource, /void fetchPortalMe\(\)/);
  assert.doesNotMatch(useAuthSource, /if\s*\(!readStoredUser\(\)\)\s*return;/);
});
