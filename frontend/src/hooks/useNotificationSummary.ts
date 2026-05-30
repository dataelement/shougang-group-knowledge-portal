import { useCallback, useEffect, useState } from 'react';
import { fetchNotificationSummary, type NotificationSummary } from '../api/notifications';

const EMPTY_SUMMARY: NotificationSummary = { todo: 0, messages: 0, total: 0 };
const POLL_INTERVAL_MS = 60_000;

/**
 * Polls the portal notification summary (header badge counts) every 60s while
 * `enabled` (i.e. a user is logged in). Pauses polling when the tab is hidden
 * and refreshes immediately when it becomes visible again, so a backgrounded
 * tab does not keep hitting the badge endpoint.
 */
export function useNotificationSummary(enabled: boolean): NotificationSummary {
  const [fetched, setFetched] = useState<NotificationSummary>(EMPTY_SUMMARY);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      setFetched(await fetchNotificationSummary());
    } catch {
      // Badge is best-effort; keep the last known counts on transient errors.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      await refresh();
    })();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  // When logged out we surface zeros without storing state, so the badges clear
  // immediately and we never write state from the effect on disable.
  return enabled ? fetched : EMPTY_SUMMARY;
}
