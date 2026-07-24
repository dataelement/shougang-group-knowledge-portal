import { useCallback, useEffect, useState } from 'react';

export type ActionToastState = {
  message: string;
  type: 'success' | 'error';
} | null;

export function useActionToast(durationMs = 3200) {
  const [toast, setToast] = useState<ActionToastState>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [toast, durationMs]);

  const showError = useCallback((message: string) => {
    const text = message.trim();
    if (!text) return;
    setToast({ message: text, type: 'error' });
  }, []);

  const showSuccess = useCallback((message: string) => {
    const text = message.trim();
    if (!text) return;
    setToast({ message: text, type: 'success' });
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  return { toast, showError, showSuccess, clearToast };
}
