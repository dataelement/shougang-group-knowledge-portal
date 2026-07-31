export type AdvancedSearchField = 'file_name' | 'summary' | 'tags';

// 临时隐藏高级检索入口与面板；恢复时只需改为 true。
export const ADVANCED_SEARCH_ENABLED = false;

export interface AdvancedSearchForm {
  allKeywords: string;
  exactPhrase: string;
  anyKeywords: string;
  excludeKeywords: string;
  searchField: AdvancedSearchField;
  spaceLevel: string;
  spaceId: string;
  businessDomainCode: string;
  documentType: string;
  fileSubcategoryCode: string;
  fileExt: string;
  tag: string;
  updatedFrom: string;
  updatedTo: string;
}

export const EMPTY_ADVANCED_SEARCH_FORM: AdvancedSearchForm = {
  allKeywords: '',
  exactPhrase: '',
  anyKeywords: '',
  excludeKeywords: '',
  searchField: 'file_name',
  spaceLevel: '',
  spaceId: '',
  businessDomainCode: '',
  documentType: '',
  fileSubcategoryCode: '',
  fileExt: '',
  tag: '',
  updatedFrom: '',
  updatedTo: '',
};

export const ADVANCED_SEARCH_PARAM_KEYS = [
  'advanced',
  'all_keywords',
  'exact_phrase',
  'any_keywords',
  'exclude_keywords',
  'search_field',
  'updated_from',
  'updated_to',
] as const;

const ADVANCED_FORM_PARAM_KEYS: Array<[keyof AdvancedSearchForm, string]> = [
  ['allKeywords', 'all_keywords'],
  ['exactPhrase', 'exact_phrase'],
  ['anyKeywords', 'any_keywords'],
  ['excludeKeywords', 'exclude_keywords'],
  ['spaceLevel', 'space_level'],
  ['spaceId', 'space_id'],
  ['businessDomainCode', 'business_domain_code'],
  ['documentType', 'document_type'],
  ['fileSubcategoryCode', 'file_subcategory_code'],
  ['fileExt', 'file_ext'],
  ['tag', 'tag'],
  ['updatedFrom', 'updated_from'],
  ['updatedTo', 'updated_to'],
];

const SEARCH_FIELDS = new Set<AdvancedSearchField>(['file_name', 'summary', 'tags']);

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildAdvancedRetrievalQuery(form: AdvancedSearchForm): string {
  const parts = [
    normalizeSearchText(form.exactPhrase),
    normalizeSearchText(form.allKeywords),
    normalizeSearchText(form.anyKeywords),
  ].filter(Boolean);
  return [...new Set(parts)].join(' ');
}

export function getAdvancedSearchForm(
  params: URLSearchParams,
  fallbackKeyword = '',
): AdvancedSearchForm {
  const searchField = params.get('search_field') as AdvancedSearchField | null;
  const form = {
    ...EMPTY_ADVANCED_SEARCH_FORM,
    allKeywords: params.get('all_keywords') || '',
    exactPhrase: params.get('exact_phrase') || '',
    anyKeywords: params.get('any_keywords') || '',
    excludeKeywords: params.get('exclude_keywords') || '',
    searchField: searchField && SEARCH_FIELDS.has(searchField) ? searchField : 'file_name',
    spaceLevel: params.get('space_level') || '',
    spaceId: params.get('space_id') || '',
    businessDomainCode: params.get('business_domain_code') || '',
    documentType: params.get('document_type') || '',
    fileSubcategoryCode: params.get('file_subcategory_code') || '',
    fileExt: params.get('file_ext') || '',
    tag: params.get('tag') || '',
    updatedFrom: params.get('updated_from') || '',
    updatedTo: params.get('updated_to') || '',
  };
  const hasAdvancedKeyword = Boolean(
    form.allKeywords
    || form.exactPhrase
    || form.anyKeywords
    || form.excludeKeywords,
  );
  if (!hasAdvancedKeyword && fallbackKeyword.trim()) {
    form.allKeywords = fallbackKeyword.trim();
  }
  return form;
}

export function applyAdvancedSearchForm(
  params: URLSearchParams,
  form: AdvancedSearchForm,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [formKey, paramKey] of ADVANCED_FORM_PARAM_KEYS) {
    const value = String(form[formKey] || '').trim();
    if (value) next.set(paramKey, value);
    else next.delete(paramKey);
  }
  next.set('advanced', '1');
  next.set('search_field', form.searchField);
  const retrievalQuery = buildAdvancedRetrievalQuery(form);
  if (retrievalQuery) next.set('q', retrievalQuery);
  else next.delete('q');
  next.delete('prefill');
  next.delete('page');
  next.delete('cursor');
  return next;
}

export function clearAdvancedSearchConditions(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ADVANCED_SEARCH_PARAM_KEYS) next.delete(key);
  for (const [, paramKey] of ADVANCED_FORM_PARAM_KEYS) next.delete(paramKey);
  next.delete('q');
  next.delete('prefill');
  next.delete('page');
  next.delete('cursor');
  return next;
}

export function isAdvancedSearchOpen(params: URLSearchParams): boolean {
  return params.get('advanced') === '1';
}
