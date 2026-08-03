import type { PortalConfig } from '../api/adminConfig';

export type ListPageContextMode = 'domain' | 'space' | 'global' | 'category';

export interface ListPageContext {
  mode: ListPageContextMode;
  spaceId?: number;
  spaceIds: number[];
  businessDomainCode?: string;
  categoryCode?: string;
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

export function hasListScopeFilters(
  params: URLSearchParams,
  businessDomainFilter = '',
): boolean {
  return Boolean(
    (params.get('q') || '').trim()
    || (params.get('filter_tag') || '').trim()
    || (params.get('tag') || '').trim()
    || (params.get('space_level') || '').trim()
    || (params.get('space_id') || '').trim()
    || (params.get('file_ext') || '').trim()
    || (params.get('document_type') || '').trim()
    || (params.get('file_subcategory_code') || '').trim()
    || businessDomainFilter.trim()
  );
}

export function resolveListContext(
  config: PortalConfig,
  domainName?: string,
  spaceIdParam?: string,
  tagParam?: string,
  titleParam?: string,
  categoryCode?: string,
): ListPageContext {
  const normalizedCategoryCode = (categoryCode ?? '').trim().toUpperCase();
  const matchedCategory = normalizedCategoryCode
    ? (config.category_cards ?? []).find((item) => item.code.trim().toUpperCase() === normalizedCategoryCode)
    : undefined;
  if (matchedCategory) {
    return {
      mode: 'category',
      spaceIds: normalizeSpaceIds(matchedCategory.space_ids),
      categoryCode: matchedCategory.code.trim().toUpperCase(),
      pageTitle: matchedCategory.name || matchedCategory.code || '分类知识',
    };
  }

  const matchedDomain = domainName ? config.domains.find((item) => item.name === domainName) : undefined;

  if (matchedDomain) {
    return {
      mode: 'domain',
      spaceIds: normalizeSpaceIds(matchedDomain.space_ids),
      businessDomainCode: matchedDomain.code.trim().toUpperCase(),
      pageTitle: matchedDomain.name || '知识列表',
    };
  }

  const spaceId = parseSpaceId(spaceIdParam);
  if (spaceId) {
    return {
      mode: 'space',
      spaceId,
      spaceIds: [spaceId],
      pageTitle: titleParam || '知识库',
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
