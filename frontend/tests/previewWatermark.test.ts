import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPortalPreviewWatermarkLines,
  calculatePortalPreviewWatermarkGrid,
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

test('portal preview watermark density follows the document surface size', () => {
  const compactGrid = calculatePortalPreviewWatermarkGrid(800, 640);
  const tallGrid = calculatePortalPreviewWatermarkGrid(800, 2400);

  assert.deepEqual(compactGrid, { columns: 5, rows: 5, tileCount: 25 });
  assert.ok(tallGrid.tileCount > compactGrid.tileCount);
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
  assert.match(componentSource, /ResizeObserver/);
  assert.doesNotMatch(componentSource, /WATERMARK_TILE_COUNT\s*=\s*24/);
  assert.match(styleSource, /pointer-events:\s*none/);
  assert.match(styleSource, /user-select:\s*none/);
  assert.match(styleSource, /font-family:[^;]*(WenQuanYi Zen Hei|Microsoft YaHei)/);
  assert.match(styleSource, /font-size:\s*16px/);
  assert.match(styleSource, /rgba\(115,\s*115,\s*115,\s*0\.16\)/);
  assert.match(styleSource, /transform:\s*rotate\(-35deg\)/);
  assert.match(styleSource, /grid-auto-rows:\s*160px/);
  assert.match(styleSource, /padding:\s*48px\s+0\s+0\s+27px/);
  assert.match(styleSource, /240px/);
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
