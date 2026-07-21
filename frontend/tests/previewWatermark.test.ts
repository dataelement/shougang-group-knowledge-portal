import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPortalPreviewWatermarkLines,
  formatPreviewWatermarkTime,
} from '../src/utils/previewWatermark';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('portal preview watermark uses external id and fixed Beijing time', () => {
  const viewedAt = new Date('2026-07-21T04:05:06.000Z');

  assert.equal(formatPreviewWatermarkTime(viewedAt), '2026-07-21 12:05:06');
  assert.deepEqual(
    buildPortalPreviewWatermarkLines(
      { name: '张三', account: 'zhangsan', externalId: 'SG-10086' },
      viewedAt,
    ),
    [
      '姓名：张三',
      '工号/账号：SG-10086',
      '北京时间：2026-07-21 12:05:06',
      '首钢集团内部资料',
    ],
  );
});

test('portal preview watermark falls back to account without external id', () => {
  const lines = buildPortalPreviewWatermarkLines(
    { name: '', account: 'lisi', externalId: '  ' },
    new Date('2026-01-01T00:00:00.000Z'),
  );

  assert.equal(lines[0], '姓名：lisi');
  assert.equal(lines[1], '工号/账号：lisi');
  assert.equal(lines[2], '北京时间：2026-01-01 08:00:00');
});

test('portal watermark layer is visual-only and detail page blocks anonymous body requests', () => {
  const componentSource = readSource('src/components/PreviewWatermark.tsx');
  const styleSource = readSource('src/components/PreviewWatermark.module.css');
  const detailSource = readSource('src/pages/DetailPage.tsx');

  assert.match(componentSource, /aria-hidden="true"/);
  assert.match(componentSource, /useState\(\(\) => new Date\(\)\)/);
  assert.match(styleSource, /pointer-events:\s*none/);
  assert.match(styleSource, /user-select:\s*none/);
  assert.match(styleSource, /transform:\s*rotate\(-\d+deg\)/);

  assert.match(detailSource, /const canPreview = Boolean\(user\);/);
  assert.match(detailSource, /canPreview\s*\?\s*fetchFilePreview/);
  assert.match(detailSource, /canPreview && previewResult\?\.mode === 'chunks'/);
  assert.match(detailSource, /登录后预览/);
  assert.match(detailSource, /<PreviewWatermark key=\{previewUserKey\} user=\{user\}>/);
});
