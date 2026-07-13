import type { DocumentTypeConfig } from '../api/adminConfig';

export type SearchSortValue = 'relevance' | 'updated_at_desc' | 'updated_at_asc';
export type TimeSortValue = Exclude<SearchSortValue, 'relevance'>;

export interface RuntimeDocumentTypeOption {
  code: string;
  label: string;
  parentCode: string;
  parentLabel: string;
}

export interface RuntimeDocumentTypeChildOption {
  code: string;
  label: string;
  parentCode: string;
  parentLabel: string;
}

export interface RuntimeDocumentTypeGroupOption {
  code: string;
  label: string;
  children: RuntimeDocumentTypeChildOption[];
}

export const SEARCH_SORT_OPTIONS: Array<{ value: SearchSortValue; label: string }> = [
  { value: 'relevance', label: '相关性优先' },
  { value: 'updated_at_desc', label: '更新时间倒序' },
  { value: 'updated_at_asc', label: '更新时间正序' },
];

export const TIME_SORT_OPTIONS: Array<{ value: TimeSortValue; label: string }> = [
  { value: 'updated_at_desc', label: '更新时间倒序' },
  { value: 'updated_at_asc', label: '更新时间正序' },
];

export function normalizeSearchSort(value?: string | null): SearchSortValue {
  if (value === 'updated_at_desc' || value === 'updated_at_asc') return value;
  return 'relevance';
}

export function normalizeTimeSort(value?: string | null): TimeSortValue | '' {
  if (value === 'updated_at_desc' || value === 'updated_at_asc') return value;
  return '';
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
  return getRuntimeDocumentTypeGroups(documentTypes).flatMap((group) => (
    group.children.map((child) => ({
      code: child.code,
      label: group.label === child.label ? child.label : `${group.label} / ${child.label}`,
      parentCode: group.code,
      parentLabel: group.label,
    }))
  ));
}

export function getRuntimeDocumentTypeGroups(documentTypes?: DocumentTypeConfig[] | null): RuntimeDocumentTypeGroupOption[] {
  const seen = new Set<string>();
  const normalized: RuntimeDocumentTypeGroupOption[] = [];
  for (const item of documentTypes ?? []) {
    const parentCode = normalizeDocumentTypeCode(item.code);
    const parentLabel = item.label.trim();
    if (!parentCode || !parentLabel) continue;
    if (seen.has(parentCode)) continue;
    seen.add(parentCode);
    const children = Array.isArray(item.children) && item.children.length
      ? item.children
      : [{ code: item.code, label: item.label }];
    const normalizedChildren: RuntimeDocumentTypeChildOption[] = [];
    const childSeen = new Set<string>();
    for (const child of children) {
      const code = normalizeDocumentTypeCode(child.code);
      const childLabel = child.label.trim();
      if (!code || !childLabel || childSeen.has(code)) continue;
      childSeen.add(code);
      normalizedChildren.push({
        code,
        parentCode,
        label: childLabel,
        parentLabel,
      });
    }
    normalized.push({
      code: parentCode,
      label: parentLabel,
      children: normalizedChildren,
    });
  }
  return normalized;
}

export function findRuntimeDocumentTypeGroup(
  groups: RuntimeDocumentTypeGroupOption[],
  documentTypeCode: string,
): RuntimeDocumentTypeGroupOption | undefined {
  const normalized = normalizeDocumentTypeCode(documentTypeCode);
  return groups.find((group) => group.code === normalized);
}

export function findRuntimeDocumentTypeChild(
  groups: RuntimeDocumentTypeGroupOption[],
  fileSubcategoryCode: string,
): RuntimeDocumentTypeChildOption | undefined {
  const normalized = normalizeDocumentTypeCode(fileSubcategoryCode);
  for (const group of groups) {
    const child = group.children.find((item) => item.code === normalized);
    if (child) return child;
  }
  return undefined;
}

export function getDocumentTypeFilterLabel(
  groups: RuntimeDocumentTypeGroupOption[],
  documentTypeCode?: string | null,
  fileSubcategoryCode?: string | null,
  placeholder = '文件分类',
): string {
  const child = findRuntimeDocumentTypeChild(groups, fileSubcategoryCode ?? '');
  if (child) return `${child.parentLabel} / ${child.label}`;
  const group = findRuntimeDocumentTypeGroup(groups, documentTypeCode ?? '');
  return group?.label ?? placeholder;
}

export function matchesDocumentType(
  fileSubcategoryCode: string | undefined,
  documentTypeCode: string,
  parentDocumentTypeCode?: string,
): boolean {
  const normalized = normalizeDocumentTypeCode(documentTypeCode);
  const normalizedParent = normalizeDocumentTypeCode(parentDocumentTypeCode);
  if (normalized && normalizedParent) {
    return normalizeDocumentTypeCode(fileSubcategoryCode) === normalizedParent;
  }
  return !normalized || normalizeDocumentTypeCode(fileSubcategoryCode) === normalized;
}
