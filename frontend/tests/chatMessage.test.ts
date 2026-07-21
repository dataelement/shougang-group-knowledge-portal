import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReferencedCitations,
  renderChatMarkdownWithSanitizer,
  stripUnclosedPlaceholders,
} from '../src/utils/chatMessage';
import type { Citation } from '../src/api/content';

const identity = (html: string) => html;

const K1: Citation = {
  key: 'knowledgesearch_aaa:5',
  citationId: 'knowledgesearch_aaa',
  itemId: '5',
  type: 'rag',
  sourcePayload: {
    knowledgeId: 3313,
    knowledgeName: '首钢知识空间',
    documentId: 86146,
    documentName: '冷轧带钢边部折皱缺陷.pdf',
    fileType: 'pdf',
    snippet: '内容片段',
  },
};

const K2: Citation = {
  key: 'knowledgesearch_bbb:0',
  citationId: 'knowledgesearch_bbb',
  itemId: '0',
  type: 'rag',
  sourcePayload: {
    knowledgeId: 3313,
    knowledgeName: '首钢知识空间',
    documentId: 91234,
    documentName: '热轧工艺手册.pdf',
    fileType: 'pdf',
    snippet: '热轧片段',
  },
};

test('单引用占位符渲染为可点击角标', () => {
  const text = 'A\\ue200knowledgesearch_aaa:5\\ue202B';
  const html = renderChatMarkdownWithSanitizer(text, [K1], identity);
  assert.match(html, /<sup class="citationRef">/);
  assert.match(html, /data-cite-key="knowledgesearch_aaa:5"/);
  assert.match(html, /href="\/space\/3313\/file\/86146\?entry_point=qa_citation"/);
  assert.match(html, />1</);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.ok(!html.includes('\\ue200'), 'raw 占位符不应残留');
  assert.ok(!html.includes('@@CITE_'), 'sentinel 不应残留');
});

test('多引用合并到同一 sup 内', () => {
  const text = '前文\\ue200knowledgesearch_aaa:5\\ue201knowledgesearch_bbb:0\\ue202后文';
  const html = renderChatMarkdownWithSanitizer(text, [K1, K2], identity);
  const supMatches = html.match(/<sup class="citationRef">[\s\S]*?<\/sup>/g) ?? [];
  assert.equal(supMatches.length, 1);
  const sup = supMatches[0];
  assert.equal((sup.match(/<a /g) ?? []).length, 2);
  assert.match(sup, /data-cite-key="knowledgesearch_aaa:5"/);
  assert.match(sup, /data-cite-key="knowledgesearch_bbb:0"/);
  assert.match(sup, />1</);
  assert.match(sup, />2</);
});

test('未在 citations 中的 key 直接被剔除，不显示 raw 占位符', () => {
  const text = 'A\\ue200knowledgesearch_unknown:9\\ue202B';
  const html = renderChatMarkdownWithSanitizer(text, [K1], identity);
  assert.ok(!html.includes('<sup'));
  assert.ok(!html.includes('knowledgesearch_unknown'));
  assert.ok(!html.includes('\\ue200'));
});

test('流式 partial 中未闭合的占位符被截断', () => {
  const partial = '正常文本 \\ue200knowledgesearch_aaa:5 还没收到结尾';
  const stripped = stripUnclosedPlaceholders(partial);
  assert.equal(stripped, '正常文本 ');
  const html = renderChatMarkdownWithSanitizer(partial, [K1], identity);
  assert.ok(!html.includes('\\ue200'));
  assert.ok(!html.includes('<sup'));
});

test('代码块内的占位符不渲染为角标', () => {
  const text = '```\n\\ue200knowledgesearch_aaa:5\\ue202\n```';
  const html = renderChatMarkdownWithSanitizer(text, [K1], identity);
  assert.match(html, /<pre>/);
  assert.ok(!html.includes('<sup'));
  assert.ok(!html.includes('@@CITE_'));
  assert.ok(!html.includes('knowledgesearch_aaa:5'));
});

test('markdown 富文本与角标可共存', () => {
  const text = '**粗体** 与 \\ue200knowledgesearch_aaa:5\\ue202\n\n1. 列表项一\n2. 列表项二';
  const html = renderChatMarkdownWithSanitizer(text, [K1], identity);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<ol>/);
  assert.match(html, /<li>列表项一<\/li>/);
  assert.match(html, /<sup class="citationRef">/);
});

test('extractReferencedCitations 仅返回文中实际被引用的 citation，按出现顺序', () => {
  const extra: Citation = {
    key: 'knowledgesearch_zzz:0',
    sourcePayload: { knowledgeId: 1, documentId: 99999, documentName: '未引用.pdf' },
  };
  const text = '段一 \\ue200knowledgesearch_bbb:0\\ue202 段二 \\ue200knowledgesearch_aaa:5\\ue202 段三 \\ue200knowledgesearch_bbb:0\\ue202';
  const referenced = extractReferencedCitations(text, [K1, K2, extra]);
  assert.equal(referenced.length, 2);
  assert.equal(referenced[0].key, 'knowledgesearch_bbb:0');
  assert.equal(referenced[1].key, 'knowledgesearch_aaa:5');
});

test('extractReferencedCitations 同 documentId 不重复，无引用返回空', () => {
  const otherChunk: Citation = {
    key: 'knowledgesearch_aaa:9',
    sourcePayload: K1.sourcePayload,
  };
  const text = '\\ue200knowledgesearch_aaa:5\\ue201knowledgesearch_aaa:9\\ue202';
  const referenced = extractReferencedCitations(text, [K1, otherChunk]);
  assert.equal(referenced.length, 1);
  assert.equal(referenced[0].sourcePayload?.documentId, 86146);

  const empty = extractReferencedCitations('纯文本无占位符', [K1, K2]);
  assert.equal(empty.length, 0);
});

test('同 documentId 的多 chunk 共用同一角标序号', () => {
  const otherChunk: Citation = {
    key: 'knowledgesearch_aaa:9',
    sourcePayload: K1.sourcePayload,
  };
  const text = '\\ue200knowledgesearch_aaa:5\\ue201knowledgesearch_aaa:9\\ue202';
  const html = renderChatMarkdownWithSanitizer(text, [K1, otherChunk], identity);
  const sup = html.match(/<sup class="citationRef">[\s\S]*?<\/sup>/)?.[0] ?? '';
  assert.equal((sup.match(/<a /g) ?? []).length, 1, '同 documentId 应去重为 1 个角标');
  assert.match(sup, />1</);
});

test('sanitize 钩子能拿到含 raw HTML 的 markdown 渲染产物', () => {
  const text = '<img src=x onerror=alert(1)>\\ue200knowledgesearch_aaa:5\\ue202';
  let captured = '';
  const spy = (html: string) => {
    captured = html;
    return html.replace(/\son\w+\s*=\s*[^\s>]+/g, '');
  };
  const out = renderChatMarkdownWithSanitizer(text, [K1], spy);
  assert.ok(captured.includes('onerror'), 'sanitize 必须收到含 onerror 的输入');
  assert.ok(!out.includes('onerror'), 'sanitize 处理后输出不含 onerror');
  assert.match(out, /<sup class="citationRef">/);
});
