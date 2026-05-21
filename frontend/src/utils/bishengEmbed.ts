const DEFAULT_BISHENG_ASSET_PORT = '4001';
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

function toSameHostUrl(rawUrl: string, locationOverride?: EmbedLocation): string {
  const current = getCurrentLocation(locationOverride);
  const parsed = new URL(rawUrl, current.origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return rawUrl;
  parsed.hostname = current.hostname;
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
  return toSameHostUrl(parsed.toString(), locationOverride);
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
      return toSameHostUrl(parsed.toString(), locationOverride);
    } catch {
      // Fall through to the deployment default.
    }
  }

  const current = getCurrentLocation(locationOverride);
  return `${current.protocol}//${current.hostname}:${DEFAULT_BISHENG_ASSET_PORT}${DEFAULT_BISHENG_KNOWLEDGE_PATH}?${EMBED_PARAM}=1`;
}
