export const DEFAULT_REST_TOKEN_PARAM = 'tokenId';
export const IAM_START_PATH = '/iam_start';

export function readUrlTokenId(search: string, tokenParam = DEFAULT_REST_TOKEN_PARAM): string {
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(normalized).get(tokenParam)?.trim() || '';
}

export function resolveUrlTokenId(
  search: string,
  tokenParam = DEFAULT_REST_TOKEN_PARAM,
): string {
  return readUrlTokenId(search, tokenParam) || readUrlTokenId(search, DEFAULT_REST_TOKEN_PARAM);
}

export function buildIamStartPath(search: string): string {
  if (!search) return IAM_START_PATH;
  return `${IAM_START_PATH}${search.startsWith('?') ? search : `?${search}`}`;
}
