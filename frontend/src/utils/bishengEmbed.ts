const DEFAULT_BISHENG_KNOWLEDGE_PATH = '/workspace/knowledge-portal';
const LEGACY_BISHENG_KNOWLEDGE_PATH = '/workspace/knowledge';
const EMBED_PARAM = 'portal_embed';

export type EmbedLocation = Pick<Location, 'protocol' | 'hostname' | 'origin'>;

function getCurrentLocation(locationOverride?: EmbedLocation): EmbedLocation {
  if (locationOverride) return locationOverride;
  if (typeof window !== 'undefined') return window.location;
  return {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1',
  };
}

function toPortalOriginUrl(rawUrl: string, locationOverride?: EmbedLocation): string {
  const current = getCurrentLocation(locationOverride);
  const parsed = new URL(rawUrl, current.origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return rawUrl;
  const portalOrigin = new URL(current.origin);
  parsed.protocol = portalOrigin.protocol;
  parsed.host = portalOrigin.host;
  return parsed.toString();
}

function withPortalKnowledgeRoute(rawUrl: string, locationOverride?: EmbedLocation): string {
  const current = getCurrentLocation(locationOverride);
  const parsed = new URL(rawUrl, current.origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return rawUrl;
  if (parsed.pathname === LEGACY_BISHENG_KNOWLEDGE_PATH || parsed.pathname === '/knowledge') {
    parsed.pathname = DEFAULT_BISHENG_KNOWLEDGE_PATH;
  }
  parsed.searchParams.set(EMBED_PARAM, '1');
  return toPortalOriginUrl(parsed.toString(), locationOverride);
}

/**
 * Override the protocol/host/port of an already-resolved embed URL while
 * keeping its path and query. Used only for local development via
 * VITE_BISHENG_EMBED_ORIGIN, so a local portal can embed a remote (test-env)
 * BiSheng instead of the same-host default. Returns the URL unchanged if the
 * override is empty or unparseable.
 */
export function applyEmbedOriginOverride(rawUrl: string, originOverride?: string): string {
  const origin = originOverride?.trim();
  if (!origin) return rawUrl;
  try {
    const target = new URL(origin);
    const parsed = new URL(rawUrl, target.origin);
    parsed.protocol = target.protocol;
    parsed.host = target.host; // host includes the port
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Derive the chrome-less dialog-host embed URL ("/workspace/portal-dialogs")
 * from the same inputs as the knowledge embed, by swapping the last path
 * segment. Keeps the host normalization and the portal_embed marker.
 */
export function resolvePortalDialogsEmbedUrl(
  runtimeAssetBaseUrl?: string,
  knowledgeEntryUrl?: string,
  locationOverride?: EmbedLocation,
): string {
  const knowledgeUrl = resolveKnowledgeEmbedUrl(runtimeAssetBaseUrl, knowledgeEntryUrl, locationOverride);
  try {
    const parsed = new URL(knowledgeUrl, getCurrentLocation(locationOverride).origin);
    parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, '/portal-dialogs');
    return parsed.toString();
  } catch {
    return knowledgeUrl;
  }
}

export function resolveKnowledgeEmbedUrl(
  runtimeAssetBaseUrl?: string,
  knowledgeEntryUrl?: string,
  locationOverride?: EmbedLocation,
) {
  const configuredUrl = knowledgeEntryUrl?.trim() || '';
  if (configuredUrl) return withPortalKnowledgeRoute(configuredUrl, locationOverride);

  const sourceUrl = runtimeAssetBaseUrl?.trim() || '';
  if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl, getCurrentLocation(locationOverride).origin);
      parsed.pathname = DEFAULT_BISHENG_KNOWLEDGE_PATH;
      parsed.search = '';
      parsed.hash = '';
      parsed.searchParams.set(EMBED_PARAM, '1');
      return toPortalOriginUrl(parsed.toString(), locationOverride);
    } catch {
      // Fall through to the deployment default.
    }
  }

  const current = getCurrentLocation(locationOverride);
  return `${current.origin}${DEFAULT_BISHENG_KNOWLEDGE_PATH}?${EMBED_PARAM}=1`;
}
