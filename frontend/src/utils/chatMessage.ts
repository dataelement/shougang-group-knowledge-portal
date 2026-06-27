import DOMPurify from 'dompurify';
import type { Citation } from '../api/content';

const OPEN = '\\ue200';
const SEP = '\\ue201';
const CLOSE = '\\ue202';
const PLACEHOLDER_RE = /\\ue200([\s\S]+?)\\ue202/g;
const SENTINEL_RE = /@@CITE_(\d+)@@/g;
const CODE_BLOCK_RE = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi;

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['iframe', 'object', 'embed', 'script', 'style'],
  ADD_ATTR: ['data-cite-key', 'data-cite-ordinal', 'target', 'rel'],
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(value: string): string {
  return value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderMarkdown(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const fenced = block.match(/^```\n([\s\S]*?)\n```$/);
      if (fenced) return `<pre><code>${escapeHtml(fenced[1])}</code></pre>`;

      const lines = block.split('\n');
      if (lines.every((line) => /^\d+\.\s+/.test(line))) {
        return `<ol>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
      }

      return `<p>${renderInlineMarkdown(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

function getCitationGroupId(citation: Citation): string {
  const docId = citation.sourcePayload?.documentId;
  if (docId !== undefined && docId !== null) return `doc:${docId}`;
  if (citation.citationId) return `cid:${citation.citationId}`;
  return `key:${citation.key}`;
}

export function stripUnclosedPlaceholders(text: string): string {
  if (!text) return text;
  const lastOpen = text.lastIndexOf(OPEN);
  if (lastOpen < 0) return text;
  if (text.indexOf(CLOSE, lastOpen) >= 0) return text;
  return text.slice(0, lastOpen);
}

export function extractReferencedCitations(text: string, citations: Citation[]): Citation[] {
  if (!text || citations.length === 0) return [];
  const safeInput = stripUnclosedPlaceholders(text);
  const citationByKey = new Map(citations.map((c) => [c.key, c]));
  const seenGroups = new Set<string>();
  const ordered: Citation[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(safeInput)) !== null) {
    const keys = match[1].split(SEP).map((k) => k.trim());
    for (const key of keys) {
      const citation = citationByKey.get(key);
      if (!citation) continue;
      const gid = getCitationGroupId(citation);
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
      ordered.push(citation);
    }
  }
  return ordered;
}

interface SentinelBuild {
  markdown: string;
  sentinelKeys: string[][];
  ordinalsByGroup: Map<string, number>;
}

function buildSentinelMarkdown(text: string, citationByKey: Map<string, Citation>): SentinelBuild {
  const sentinelKeys: string[][] = [];
  const ordinalsByGroup = new Map<string, number>();
  const markdown = text.replace(PLACEHOLDER_RE, (_match, group: string) => {
    const keys = group
      .split(SEP)
      .map((k) => k.trim())
      .filter((k) => k && citationByKey.has(k));
    if (keys.length === 0) return '';
    keys.forEach((k) => {
      const citation = citationByKey.get(k);
      if (!citation) return;
      const gid = getCitationGroupId(citation);
      if (!ordinalsByGroup.has(gid)) {
        ordinalsByGroup.set(gid, ordinalsByGroup.size + 1);
      }
    });
    const idx = sentinelKeys.length;
    sentinelKeys.push(keys);
    return `@@CITE_${idx}@@`;
  });
  return { markdown, sentinelKeys, ordinalsByGroup };
}

function injectCitationLinks(
  cleanHtml: string,
  sentinelKeys: string[][],
  citationByKey: Map<string, Citation>,
  ordinalsByGroup: Map<string, number>,
): string {
  const stripped = cleanHtml.replace(CODE_BLOCK_RE, (block) => block.replace(SENTINEL_RE, ''));
  return stripped.replace(SENTINEL_RE, (_match, idxStr: string) => {
    const idx = Number(idxStr);
    const keys = sentinelKeys[idx];
    if (!keys || keys.length === 0) return '';
    const seenOrdinals = new Set<number>();
    const links: string[] = [];
    for (const key of keys) {
      const citation = citationByKey.get(key);
      if (!citation) continue;
      const gid = getCitationGroupId(citation);
      const ordinal = ordinalsByGroup.get(gid) ?? 0;
      if (seenOrdinals.has(ordinal)) continue;
      seenOrdinals.add(ordinal);
      const sp = citation.sourcePayload ?? {};
      const href = sp.knowledgeId && sp.documentId
        ? `/space/${sp.knowledgeId}/file/${sp.documentId}`
        : '#';
      const title = escapeHtml(sp.documentName || key);
      const safeKey = escapeHtml(key);
      links.push(
        `<a class="citationLink" data-cite-key="${safeKey}" data-cite-ordinal="${ordinal}" href="${href}" title="${title}" target="_blank" rel="noopener noreferrer">${ordinal}</a>`,
      );
    }
    if (links.length === 0) return '';
    return `<sup class="citationRef">${links.join('<span class="citationSep">,</span>')}</sup>`;
  });
}

export function renderChatMarkdownWithSanitizer(
  text: string,
  citations: Citation[],
  sanitize: (html: string) => string,
): string {
  if (!text) return '';
  const safeInput = stripUnclosedPlaceholders(text);
  const citationByKey = new Map(citations.map((c) => [c.key, c]));
  const { markdown, sentinelKeys, ordinalsByGroup } = buildSentinelMarkdown(safeInput, citationByKey);
  const rendered = renderMarkdown(markdown);
  const clean = sanitize(rendered);
  return injectCitationLinks(clean, sentinelKeys, citationByKey, ordinalsByGroup);
}

export function renderChatMarkdown(text: string, citations: Citation[]): string {
  return renderChatMarkdownWithSanitizer(text, citations, (html) =>
    DOMPurify.sanitize(html, SANITIZE_OPTIONS),
  );
}
