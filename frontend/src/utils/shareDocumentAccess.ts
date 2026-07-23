import { ApiRequestError } from '../api/content';
import { buildPortalLoginStartUrl } from './loginRedirect';

export function buildShareLoginRedirect(token: string): string {
  const sharePath = `/share/document/${encodeURIComponent(token)}`;
  return buildPortalLoginStartUrl(sharePath);
}

export function isShareLoginRequiredError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}
