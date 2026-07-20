/**
 * 智能问答「选择知识库」旁的气泡提示节流:每个用户每周最多提示一次。
 * 用户 x 掉后按「用户」记录到 localStorage,该用户一周内不再出现;一周后自动再次提示。
 * 未登录时按 guest 单独记录,不会和已登录用户互相影响。
 */
const STORAGE_KEY_PREFIX = 'portal.qaKbHintNextAt';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 每个用户一个 key,避免同一浏览器多个账号互相顶掉提示。 */
function storageKey(userKey?: string | null): string {
  const normalized = (userKey || '').trim();
  return `${STORAGE_KEY_PREFIX}:${normalized || 'guest'}`;
}

export function shouldShowQaKbHint(userKey?: string | null): boolean {
  try {
    const raw = localStorage.getItem(storageKey(userKey));
    const nextAt = raw ? Number(raw) : 0;
    return !Number.isFinite(nextAt) || Date.now() >= nextAt;
  } catch {
    return true;
  }
}

export function dismissQaKbHint(userKey?: string | null): void {
  try {
    localStorage.setItem(storageKey(userKey), String(Date.now() + WEEK_MS));
  } catch {
    // ignore
  }
}

export const QA_KB_HINT_TEXT = '定位知识库，为您提供更精准的解答。';
