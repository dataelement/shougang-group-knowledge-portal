import { ApiRequestError } from '../api/content';

export function buildShareLoginRedirect(token: string): string {
  const sharePath = `/share/document/${encodeURIComponent(token)}`;
  return `/login?redirect=${encodeURIComponent(sharePath)}`;
}

export function isShareLoginRequiredError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}
