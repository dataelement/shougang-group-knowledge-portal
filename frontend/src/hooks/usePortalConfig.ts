import { useEffect, useSyncExternalStore } from 'react';
import { fetchPortalContentConfig } from '../api/content';
import type { PortalConfig } from '../api/adminConfig';

interface PortalConfigSnapshot {
  config: PortalConfig | null;
  loading: boolean;
  error: string;
}

const listeners = new Set<() => void>();
let snapshot: PortalConfigSnapshot = {
  config: null,
  loading: true,
  error: '',
};
let loadPromise: Promise<void> | null = null;
let loadVersion = 0;

function emitChange() {
  for (const listener of listeners) listener();
}

function setSnapshot(next: PortalConfigSnapshot) {
  snapshot = next;
  emitChange();
}

function getSnapshot(): PortalConfigSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensurePortalConfigLoaded(): Promise<void> {
  if (snapshot.config || loadPromise) return loadPromise ?? Promise.resolve();
  const version = loadVersion;
  setSnapshot({ ...snapshot, loading: true, error: '' });
  loadPromise = fetchPortalContentConfig()
    .then((config) => {
      if (version !== loadVersion) return;
      setSnapshot({ config, loading: false, error: '' });
    })
    .catch((err: unknown) => {
      if (version !== loadVersion) return;
      setSnapshot({
        config: null,
        loading: false,
        error: err instanceof Error ? err.message : '配置加载失败',
      });
    })
    .finally(() => {
      if (version === loadVersion) {
        loadPromise = null;
      }
    });
  return loadPromise;
}

export function invalidatePortalConfigStore() {
  loadVersion += 1;
  loadPromise = null;
  setSnapshot({ config: null, loading: true, error: '' });
  void ensurePortalConfigLoaded();
}

export function usePortalConfig() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void ensurePortalConfigLoaded();
  }, []);

  return current;
}
