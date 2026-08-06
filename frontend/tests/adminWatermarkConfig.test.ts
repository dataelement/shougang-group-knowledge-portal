import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createWatermarkDraft,
  resolvePortalWatermarkHorizontalText,
  validateWatermarkDraft,
} from '../src/utils/adminWatermarkConfig';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('resolvePortalWatermarkHorizontalText falls back to default when empty', () => {
  assert.equal(resolvePortalWatermarkHorizontalText(''), '首钢股份内部资料，严禁外传，违者必究');
  assert.equal(resolvePortalWatermarkHorizontalText('   '), '首钢股份内部资料，严禁外传，违者必究');
  assert.equal(resolvePortalWatermarkHorizontalText('自定义文案'), '自定义文案');
});

test('validateWatermarkDraft trims and rejects invalid input', () => {
  assert.deepEqual(validateWatermarkDraft({ horizontalText: '  自定义  ' }), {
    watermark: { horizontal_text: '自定义' },
  });
  assert.deepEqual(validateWatermarkDraft({ horizontalText: '' }), {
    watermark: { horizontal_text: '' },
  });
  assert.match(
    validateWatermarkDraft({ horizontalText: 'a\nb' }).error ?? '',
    /换行/,
  );
  assert.match(
    validateWatermarkDraft({ horizontalText: '文'.repeat(81) }).error ?? '',
    /80/,
  );
});

test('createWatermarkDraft uses stored configured text', () => {
  assert.deepEqual(
    createWatermarkDraft({ horizontal_text: '测试环境水印文案' }),
    { horizontalText: '测试环境水印文案' },
  );
});

test('admin watermark section wires API and admin navigation', () => {
  const adminPageSource = readSource('src/pages/AdminPage.tsx');
  const sectionSource = readSource('src/pages/admin/WatermarkAdminSection.tsx');
  const adminConfigSource = readSource('src/api/adminConfig.ts');

  assert.match(adminPageSource, /key: 'watermark'/);
  assert.match(adminPageSource, /<WatermarkAdminSection/);
  assert.match(adminPageSource, /updateWatermarkConfig/);
  assert.match(sectionSource, /水印水平文本/);
  assert.match(adminConfigSource, /updateWatermarkConfig/);
  assert.match(adminConfigSource, /\/api\/v1\/admin\/config\/watermark/);
});
