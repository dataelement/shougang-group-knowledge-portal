import type { DocumentTypeConfig } from '../api/adminConfig';

export type SearchSortValue = 'relevance' | 'updated_at_desc' | 'updated_at_asc';

export interface RuntimeDocumentTypeOption {
  code: string;
  label: string;
  parentCode: string;
  parentLabel: string;
}

export const SEARCH_SORT_OPTIONS: Array<{ value: SearchSortValue; label: string }> = [
  { value: 'relevance', label: '相关性优先' },
  { value: 'updated_at_desc', label: '更新时间倒序' },
  { value: 'updated_at_asc', label: '更新时间正序' },
];

export function normalizeSearchSort(value?: string | null): SearchSortValue {
  if (value === 'updated_at_desc' || value === 'updated_at_asc') return value;
  return 'relevance';
}

export function normalizeDocumentTypeCode(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

export function getDocumentTypeCodeFromFileEncoding(fileEncoding?: string | null): string {
  const parts = (fileEncoding ?? '').split('-').map((part) => part.trim());
  if (parts.length < 2) return '';
  return normalizeDocumentTypeCode(parts[1]);
}

export function getRuntimeDocumentTypes(documentTypes?: DocumentTypeConfig[] | null): RuntimeDocumentTypeOption[] {
  const seen = new Set<string>();
  const normalized: RuntimeDocumentTypeOption[] = [];
  for (const item of documentTypes ?? []) {
    const parentCode = normalizeDocumentTypeCode(item.code);
    const parentLabel = item.label.trim();
    if (!parentCode || !parentLabel) continue;
    const children = Array.isArray(item.children) && item.children.length
      ? item.children
      : [{ code: item.code, label: item.label }];
    for (const child of children) {
      const code = normalizeDocumentTypeCode(child.code);
      const childLabel = child.label.trim();
      if (!code || !childLabel || seen.has(code)) continue;
      seen.add(code);
      normalized.push({
        code,
        label: parentLabel === childLabel ? childLabel : `${parentLabel} / ${childLabel}`,
        parentCode,
        parentLabel,
      });
    }
  }
  return normalized;
}

export function matchesDocumentType(fileSubcategoryCode: string | undefined, documentTypeCode: string): boolean {
  const normalized = normalizeDocumentTypeCode(documentTypeCode);
  return !normalized || normalizeDocumentTypeCode(fileSubcategoryCode) === normalized;
}
