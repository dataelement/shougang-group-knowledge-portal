import type { DocumentTypeConfig } from '../api/adminConfig';

export type SearchSortValue = 'relevance' | 'updated_at_desc' | 'updated_at_asc';

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

export function getRuntimeDocumentTypes(documentTypes?: DocumentTypeConfig[] | null): DocumentTypeConfig[] {
  const seen = new Set<string>();
  const normalized: DocumentTypeConfig[] = [];
  for (const item of documentTypes ?? []) {
    const code = normalizeDocumentTypeCode(item.code);
    const label = item.label.trim();
    if (!code || !label || seen.has(code)) continue;
    seen.add(code);
    normalized.push({ code, label });
  }
  return normalized;
}

export function matchesDocumentType(fileEncoding: string, documentTypeCode: string): boolean {
  const normalized = normalizeDocumentTypeCode(documentTypeCode);
  return !normalized || getDocumentTypeCodeFromFileEncoding(fileEncoding) === normalized;
}
