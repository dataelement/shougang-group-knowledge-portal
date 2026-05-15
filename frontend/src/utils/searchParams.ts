export function buildDomainSearchPath(domainName: string): string {
  const params = new URLSearchParams({
    domain: domainName,
    prefill: domainName,
    page: '1',
  });
  return `/search?${params.toString()}`;
}

export function getSearchDisplayKeyword(params: URLSearchParams): string {
  return params.get('q') || params.get('domain') || params.get('prefill') || '';
}

export function hasSearchContext(params: URLSearchParams): boolean {
  return Boolean(
    (params.get('q') || '').trim()
    || (params.get('domain') || '').trim()
    || (params.get('prefill') || '').trim()
    || (params.get('space_level') || '').trim()
    || (params.get('file_ext') || '').trim()
    || (params.get('tag') || '').trim(),
  );
}

export function createSubmittedSearchParams(params: URLSearchParams, draft: string): URLSearchParams {
  const keyword = draft.trim();
  const next = new URLSearchParams(params);
  if (keyword) next.set('q', keyword);
  else next.delete('q');
  next.delete('prefill');
  next.delete('page');
  return next;
}

export function createDomainFilterSearchParams(params: URLSearchParams, domainName: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (domainName) next.set('domain', domainName);
  else next.delete('domain');

  if (!next.get('q')) {
    if (domainName) next.set('prefill', domainName);
    else next.delete('prefill');
  } else {
    next.delete('prefill');
  }

  next.set('page', '1');
  return next;
}
