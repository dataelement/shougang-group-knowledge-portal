import { useCallback, useRef, useState } from 'react';
import { favoriteDocument, removeFavorite, fetchFavoriteStatus, favoriteKey, type FileItem } from '../api/content';
import { mergeFavoriteStatuses, withFavoriteStatus, readFavoriteStatus, type FavoriteStatusMap } from '../utils/favoriteStatus';

export function useFavoriteDocument() {
  const [statusMap, setStatusMap] = useState<FavoriteStatusMap>(new Map());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const mapRef = useRef(statusMap);
  mapRef.current = statusMap;

  const loadStatuses = useCallback(async (files: Array<Pick<FileItem, 'id' | 'spaceId'>>) => {
    if (!files.length) return;
    const incoming = await fetchFavoriteStatus(files.map((f) => ({ spaceId: f.spaceId, fileId: f.id })));
    setStatusMap((prev) => mergeFavoriteStatuses(prev, incoming));
  }, []);

  const isFavorited = useCallback((spaceId: number, fileId: number) => readFavoriteStatus(mapRef.current, spaceId, fileId), []);
  const pending = useCallback((spaceId: number, fileId: number) => pendingKeys.has(favoriteKey(spaceId, fileId)), [pendingKeys]);

  const toggleFavorite = useCallback(async (file: Pick<FileItem, 'id' | 'spaceId'>) => {
    const key = favoriteKey(file.spaceId, file.id);
    const wasFav = readFavoriteStatus(mapRef.current, file.spaceId, file.id);
    setPendingKeys((p) => new Set(p).add(key));
    setStatusMap((prev) => withFavoriteStatus(prev, file.spaceId, file.id, !wasFav)); // 乐观
    try {
      if (wasFav) await removeFavorite({ sourceSpaceId: file.spaceId, sourceFileId: file.id });
      else await favoriteDocument({ sourceSpaceId: file.spaceId, sourceFileId: file.id });
    } catch (err) {
      setStatusMap((prev) => withFavoriteStatus(prev, file.spaceId, file.id, wasFav)); // 回滚
      throw err;
    } finally {
      setPendingKeys((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  }, []);

  return { loadStatuses, isFavorited, toggleFavorite, pending };
}
