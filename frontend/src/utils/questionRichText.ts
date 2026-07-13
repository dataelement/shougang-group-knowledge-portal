import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'ul',
  'li',
  'blockquote',
  'pre',
  'code',
] as const;

const RICH_TEXT_TAG_PATTERN = /<\/?(?:p|br|strong|em|ul|li|blockquote|pre|code)\b[^>]*>/i;

export type QuestionDescriptionRenderModel =
  | { kind: 'html'; html: string }
  | { kind: 'text'; paragraphs: string[] };

export function sanitizeQuestionDescriptionHtml(value: string): string {
  if (typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(value, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [],
    }).trim();
  }

  // Node 纯函数测试环境没有浏览器 DOM，使用最小回退逻辑验证格式契约；
  // 真实浏览器中始终由 DOMPurify 执行权威净化。
  return value
    .replace(/<(?:script|style|iframe|object|embed|svg|math|form)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed|svg|math|form)>/gi, '')
    .replace(/<(?!\/?(?:p|br|strong|em|ul|li|blockquote|pre|code)\b)[^>]*>/gi, '')
    .replace(/<(p|br|strong|em|ul|li|blockquote|pre|code)\b[^>]*>/gi, '<$1>')
    .trim();
}

export function splitQuestionDescriptionParagraphs(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function isQuestionDescriptionHtml(value?: string | null): boolean {
  if (!value?.trim()) return false;
  return RICH_TEXT_TAG_PATTERN.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function toQuestionDescriptionEditorHtml(value?: string | null): string {
  if (!value?.trim()) return '';
  if (isQuestionDescriptionHtml(value)) return sanitizeQuestionDescriptionHtml(value);

  return splitQuestionDescriptionParagraphs(value)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('');
}

export function normalizeQuestionDescriptionEditorHtml(value: string): string {
  const normalizedTags = value
    .replace(/<\/?b\b/gi, (tag) => tag.replace(/b/i, 'strong'))
    .replace(/<\/?i\b/gi, (tag) => tag.replace(/i/i, 'em'));
  const clean = sanitizeQuestionDescriptionHtml(normalizedTags);
  return clean
    .replace(/<(p|blockquote|pre)>\s*(?:<br>)?\s*<\/\1>/gi, '')
    .trim();
}

export function toQuestionDescriptionPlainText(value?: string | null): string {
  if (!value?.trim()) return '';
  const safeValue = isQuestionDescriptionHtml(value)
    ? sanitizeQuestionDescriptionHtml(value)
    : value;

  return decodeHtmlEntities(
    safeValue
      .replace(/<\/(?:p|li|blockquote|pre)>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function toQuestionDescriptionRenderModel(
  value?: string | null,
): QuestionDescriptionRenderModel {
  if (isQuestionDescriptionHtml(value)) {
    const html = sanitizeQuestionDescriptionHtml(value || '');
    if (html && RICH_TEXT_TAG_PATTERN.test(html)) return { kind: 'html', html };
  }

  return {
    kind: 'text',
    paragraphs: splitQuestionDescriptionParagraphs(value),
  };
}
