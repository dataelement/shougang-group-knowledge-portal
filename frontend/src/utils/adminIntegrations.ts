export function getSafeExternalHttpUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return '';
    }
    return normalized;
  } catch {
    return '';
  }
}
