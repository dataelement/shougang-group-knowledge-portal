import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPortalPreviewWatermarkLines,
  calculatePortalPreviewWatermarkPatternLayout,
  formatPreviewWatermarkTime,
} from '../src/utils/previewWatermark';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('portal preview watermark uses primary department and fixed Beijing date', () => {
  const viewedAt = new Date('2026-07-21T04:05:06.000Z');

  assert.equal(formatPreviewWatermarkTime(viewedAt), '2026-07-21');
  assert.deepEqual(
    buildPortalPreviewWatermarkLines(
      {
        name: '张三',
        account: 'zhangsan',
        departmentName: '设备管理部',
        externalId: 'SG001',
      },
      viewedAt,
    ),
    [
      '设备管理部-张三--SG001-2026-07-21',
      '首钢股份内部资料，严禁外传，违者必究',
    ],
  );
});

test('portal preview watermark falls back to account without department', () => {
  const lines = buildPortalPreviewWatermarkLines(
    { name: '', account: 'lisi', departmentName: '  ' },
    new Date('2026-01-01T00:00:00.000Z'),
  );

  assert.deepEqual(lines, [
    'lisi--lisi-2026-01-01',
    '首钢股份内部资料，严禁外传，违者必究',
  ]);
});

test('portal preview watermark layout uses adaptive rotated bounds and staggered rows', () => {
  const normal = calculatePortalPreviewWatermarkPatternLayout([240, 220]);
  const long = calculatePortalPreviewWatermarkPatternLayout([760, 320]);

  assert.equal(normal.cellWidth, 320);
  assert.equal(normal.cellHeight, 240);
  assert.equal(normal.patternHeight, 480);
  assert.equal(normal.secondRowOffsetX, 160);
  assert.equal(normal.rotation, -35);
  assert.equal(normal.fontSize, 16);
  assert.equal(normal.opacity, 0.11);
  assert.ok(long.cellWidth > normal.cellWidth);
  assert.ok(long.cellHeight > normal.cellHeight);
  assert.ok(long.cellWidth >= Math.ceil(long.rotatedWidth + 64));
  assert.ok(long.cellHeight >= Math.ceil(long.rotatedHeight + 48));
});

test('portal watermark layer is visual-only and detail page blocks anonymous body requests', () => {
  const componentSource = readSource('src/components/PreviewWatermark.tsx');
  const styleSource = readSource('src/components/PreviewWatermark.module.css');
  const documentPreviewSource = readSource('src/components/DocumentPreview.tsx');
  const documentPreviewStyleSource = readSource('src/components/DocumentPreview.module.css');
  const pdfPreviewSource = readSource('src/components/PdfPreview.tsx');
  const detailSource = readSource('src/pages/DetailPage.tsx');
  const authSource = readSource('src/api/auth.ts');

  assert.match(componentSource, /createContext/);
  assert.match(componentSource, /export function PreviewWatermarkOverlay/);
  assert.match(componentSource, /aria-hidden="true"/);
  assert.match(componentSource, /useState\(\(\) => new Date\(\)\)/);
  assert.match(componentSource, /<pattern/);
  assert.doesNotMatch(componentSource, /ResizeObserver/);
  assert.doesNotMatch(componentSource, /Array\.from/);
  assert.doesNotMatch(componentSource, /WATERMARK_TILE_COUNT\s*=\s*24/);
  assert.match(styleSource, /pointer-events:\s*none/);
  assert.match(styleSource, /user-select:\s*none/);
  assert.match(styleSource, /font-family:[^;]*(WenQuanYi Zen Hei|Microsoft YaHei)/);
  assert.match(styleSource, /font-size:\s*16px/);
  assert.match(styleSource, /fill:\s*#737373/);
  assert.match(styleSource, /fill-opacity:\s*0\.11/);
  assert.doesNotMatch(styleSource, /grid-auto-rows/);
  assert.doesNotMatch(styleSource, /240px/);
  assert.doesNotMatch(styleSource, /align-content:\s*space-around/);
  assert.match(documentPreviewStyleSource, /\.watermarkSurface\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden/s);
  assert.ok(
    (documentPreviewSource.match(/data-preview-watermark-surface/g)?.length ?? 0) >= 7,
    'all non-PDF document surfaces must clip their own watermark',
  );
  assert.match(documentPreviewSource, /<PreviewWatermarkOverlay\s*\/>/);
  assert.match(pdfPreviewSource, /data-preview-watermark-surface/);
  assert.match(pdfPreviewSource, /<PreviewWatermarkOverlay\s*\/>/);
  assert.match(authSource, /departmentName:\s*dto\.department_name/);
  assert.match(authSource, /externalId:\s*dto\.external_id/);

  assert.match(detailSource, /const canPreview = Boolean\(user\);/);
  assert.match(detailSource, /canPreview\s*\?\s*fetchFilePreview/);
  assert.match(detailSource, /canPreview && previewResult\?\.mode === 'chunks'/);
  assert.match(detailSource, /登录后预览/);
  assert.match(detailSource, /<PreviewWatermark key=\{previewUserKey\} user=\{user\}>/);
});
