import type { DomainConfig } from '../api/adminConfig';

export interface BusinessDomainFilterOption {
  code: string;
  label: string;
}

export function normalizeBusinessDomainCode(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

export function getBusinessDomainCodeFromFileEncoding(fileEncoding?: string | null): string {
  const parts = (fileEncoding ?? '').split('-').map((part) => part.trim());
  if (parts.length < 4 || !parts[2]) return '';
  return normalizeBusinessDomainCode(parts[2]);
}

export function getBusinessDomainFilterOptions(domains?: DomainConfig[] | null): BusinessDomainFilterOption[] {
  const seen = new Set<string>();
  const options: BusinessDomainFilterOption[] = [];
  for (const domain of domains ?? []) {
    const code = normalizeBusinessDomainCode(domain.code);
    const name = domain.name.trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    options.push({
      code,
      label: `${name} / ${code}`,
    });
  }
  return options;
}
