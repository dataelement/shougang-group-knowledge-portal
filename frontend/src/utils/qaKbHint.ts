/**
 * 智能问答「选择知识库」旁的气泡提示节流:每周最多提示一次。
 * 用户 x 掉后记录到 localStorage,一周内不再出现;一周后自动再次提示。
 */
const STORAGE_KEY = 'portal.qaKbHintNextAt';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldShowQaKbHint(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const nextAt = raw ? Number(raw) : 0;
    return !Number.isFinite(nextAt) || Date.now() >= nextAt;
  } catch {
    return true;
  }
}

export function dismissQaKbHint(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + WEEK_MS));
  } catch {
    // ignore
  }
}

export const QA_KB_HINT_TEXT = '定位知识库，为您提供更精准的解答。';
