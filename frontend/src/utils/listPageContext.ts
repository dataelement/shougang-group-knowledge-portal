import type { PortalConfig } from '../api/adminConfig';

export type ListPageContextMode = 'domain' | 'space' | 'global';

export interface ListPageContext {
  mode: ListPageContextMode;
  spaceId?: number;
  spaceIds: number[];
  pageTitle: string;
}

function normalizeSpaceIds(spaceIds: number[]): number[] {
  const seen = new Set<number>();
  return spaceIds.filter((spaceId) => {
    if (!Number.isFinite(spaceId) || spaceId <= 0 || seen.has(spaceId)) return false;
    seen.add(spaceId);
    return true;
  });
}

function parseSpaceId(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function resolveListContext(
  config: PortalConfig,
  domainName?: string,
  spaceIdParam?: string,
  tagParam?: string,
  titleParam?: string,
): ListPageContext {
  const matchedDomain = domainName ? config.domains.find((item) => item.name === domainName) : undefined;

  if (matchedDomain) {
    return {
      mode: 'domain',
      spaceIds: normalizeSpaceIds(matchedDomain.space_ids),
      pageTitle: matchedDomain.name || '知识列表',
    };
  }

  const spaceId = parseSpaceId(spaceIdParam);
  if (spaceId) {
    const space = config.spaces.find((item) => item.id === spaceId);
    return {
      mode: 'space',
      spaceId,
      spaceIds: [spaceId],
      pageTitle: space?.name || '知识库',
    };
  }

  if (titleParam) {
    return {
      mode: 'global',
      spaceIds: [],
      pageTitle: titleParam,
    };
  }

  if (tagParam) {
    const sec = config.sections.find((item) => item.tag === tagParam);
    return {
      mode: 'global',
      spaceIds: [],
      pageTitle: sec?.title || tagParam,
    };
  }

  return {
    mode: 'global',
    spaceIds: [],
    pageTitle: '知识列表',
  };
}
