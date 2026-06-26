import { favoriteKey } from '../api/content';

export type FavoriteStatusMap = Map<string, boolean>;

export function mergeFavoriteStatuses(prev: FavoriteStatusMap, incoming: FavoriteStatusMap): FavoriteStatusMap {
  const next = new Map(prev);
  incoming.forEach((v, k) => next.set(k, v));
  return next;
}

export function withFavoriteStatus(prev: FavoriteStatusMap, spaceId: number, fileId: number, value: boolean): FavoriteStatusMap {
  const next = new Map(prev);
  next.set(favoriteKey(spaceId, fileId), value);
  return next;
}

export function readFavoriteStatus(map: FavoriteStatusMap, spaceId: number, fileId: number): boolean {
  return Boolean(map.get(favoriteKey(spaceId, fileId)));
}
