import type { ReactNode } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap every case-insensitive occurrence of `query` in `text` with a `<mark>`.
 * A space-separated query highlights each keyword independently (longest first,
 * so a token that is a substring of another doesn't split it up).
 */
export function highlightMatches(text: string, query: string, className?: string): ReactNode {
  const tokens = Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
  if (!tokens.length || !text) return text;

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length <= 1) return text;

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className={className}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
