import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuestionDescriptionHtml,
  sanitizeQuestionDescriptionHtml,
  toQuestionDescriptionEditorHtml,
  toQuestionDescriptionPlainText,
  toQuestionDescriptionRenderModel,
} from '../src/utils/questionRichText';

test('仅保留问题描述允许的富文本标签', () => {
  const html = sanitizeQuestionDescriptionHtml(
    '<p><strong>重点</strong><em>说明</em></p><ul><li>第一项</li></ul><blockquote>引用</blockquote><pre><code>const value = 1;</code></pre>',
  );

  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<em>说明<\/em>/);
  assert.match(html, /<ul><li>第一项<\/li><\/ul>/);
  assert.match(html, /<blockquote>引用<\/blockquote>/);
  assert.match(html, /<pre><code>const value = 1;<\/code><\/pre>/);
});

test('净化问题描述时清除属性和危险内容', () => {
  const html = sanitizeQuestionDescriptionHtml(
    '<p onclick="alert(1)"><strong class="danger">安全</strong><img src=x onerror="alert(1)"><script>alert(1)</script><iframe src="https://bad.example"></iframe></p>',
  );

  assert.equal(html, '<p><strong>安全</strong></p>');
  assert.ok(!html.includes('onclick'));
  assert.ok(!html.includes('onerror'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<iframe'));
});

test('历史纯文本保持段落渲染模型', () => {
  const model = toQuestionDescriptionRenderModel('第一段\n\n第二段');

  assert.deepEqual(model, {
    kind: 'text',
    paragraphs: ['第一段', '第二段'],
  });
  assert.equal(isQuestionDescriptionHtml('第一段\n\n第二段'), false);
});

test('受限 HTML 生成安全的富文本渲染模型', () => {
  const model = toQuestionDescriptionRenderModel('<p><strong>重点</strong></p>');

  assert.deepEqual(model, {
    kind: 'html',
    html: '<p><strong>重点</strong></p>',
  });
  assert.equal(isQuestionDescriptionHtml('<p><strong>重点</strong></p>'), true);
});

test('编辑器回填历史文本时转义并拆分段落', () => {
  const html = toQuestionDescriptionEditorHtml('第一段\n\n<script>alert(1)</script>');

  assert.equal(html, '<p>第一段</p><p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('富文本转换为摘要纯文本时不保留标签', () => {
  const text = toQuestionDescriptionPlainText(
    '<p><strong>重点</strong></p><ul><li>第一项</li><li>第二项</li></ul><pre><code>const x = 1;</code></pre>',
  );

  assert.equal(text, '重点 第一项 第二项 const x = 1;');
  assert.ok(!text.includes('<strong>'));
});
