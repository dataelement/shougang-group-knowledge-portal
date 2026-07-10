import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const useAuthSource = readFileSync('src/hooks/useAuth.ts', 'utf8');

test('auth hook checks the server session even when the local portal user cache is empty', () => {
  assert.match(useAuthSource, /fetchPortalMe\(\)/);
  assert.doesNotMatch(useAuthSource, /if\s*\(!readStoredUser\(\)\)\s*return;/);
});

test('auth hook syncs portal user changes inside the same browser tab', () => {
  assert.match(useAuthSource, /PORTAL_USER_CHANGED_EVENT/);
  assert.match(useAuthSource, /invalidatePortalContentConfigCache/);
  assert.match(useAuthSource, /const userChanged = !usersEqual\(currentUser, user\);/);
  assert.match(useAuthSource, /if \(!userChanged\) return;/);
  assert.match(useAuthSource, /function savePortalUser[\s\S]*invalidatePortalContentConfigCache\(\)/);
  assert.match(useAuthSource, /function clearPortalUser[\s\S]*invalidatePortalContentConfigCache\(\)/);
  assert.match(useAuthSource, /window\.dispatchEvent\(new Event\(PORTAL_USER_CHANGED_EVENT\)\)/);
  assert.match(useAuthSource, /window\.addEventListener\(PORTAL_USER_CHANGED_EVENT,\s*handleUserChanged\)/);
  assert.match(useAuthSource, /window\.removeEventListener\(PORTAL_USER_CHANGED_EVENT,\s*handleUserChanged\)/);
});

test('auth state is a shared singleton store rather than per-component state', () => {
  // 所有消费者订阅同一个模块级 store，避免每个组件各持一份会抖动的 user 引用。
  assert.match(useAuthSource, /useSyncExternalStore\(subscribe, getSnapshot/);
  assert.match(useAuthSource, /const listeners = new Set<\(\) => void>\(\)/);
  // 只有真正变化才替换引用：吸收 readStoredUser() 的新对象抖动，防止 [user] 依赖 effect 无谓重跑。
  assert.match(useAuthSource, /function setCurrentUser[\s\S]*if \(usersEqual\(currentUser, next\)\) return;/);
});

test('auth server check is single-flight so concurrent mounts issue one /auth/me', () => {
  // 单飞在途请求：多组件同批挂载共享同一个 promise，只发一次 /auth/me。
  assert.match(useAuthSource, /let mePromise: Promise<void> \| null = null;/);
  assert.match(useAuthSource, /function ensureAuthSynced[\s\S]*if \(mePromise\) return mePromise;/);
  assert.match(useAuthSource, /void ensureAuthSynced\(\)/);
});
