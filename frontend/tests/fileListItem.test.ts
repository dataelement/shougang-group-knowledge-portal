import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FileItem } from '../src/api/content';

const stylesProxy = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
);

(require as NodeJS.Require & { extensions: NodeJS.RequireExtensions }).extensions['.css'] = (
  module: NodeJS.Module,
) => {
  module.exports = stylesProxy;
};

function ensureCompiledCssStub(relativePath: string): void {
  const target = resolve(__dirname, '..', relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '', { flag: 'w' });
}

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const baseFile: FileItem = {
  id: 1580,
  spaceId: 12,
  title: '视频处理任务服务设计',
  summary: '文档摘要',
  source: '财务',
  date: '2026-05-15T11:30:00',
  tags: ['PDF'],
  ext: 'pdf',
  sizeLabel: '575382',
  fileEncoding: 'SGGF-STD-IT-20260500000001',
};

test('does not render document encoding or file size in the list card metadata', async () => {
  ensureCompiledCssStub('src/components/FileListItem.module.css');
  ensureCompiledCssStub('src/components/TagPill.module.css');

  const { default: FileListItem } = await import('../src/components/FileListItem');

  const html = renderToStaticMarkup(React.createElement(FileListItem, { file: baseFile }));

  assert.equal(html.includes(baseFile.fileEncoding), false);
  assert.equal(html.includes(baseFile.sizeLabel), false);
});

test('download action shows pending spinner while the async download is resolving', () => {
  const source = readSource('src/components/FileListItem.tsx');
  const styles = readSource('src/components/FileListItem.module.css');

  assert.match(source, /Loader2/);
  assert.match(source, /const \[downloadPending, setDownloadPending\] = useState\(false\);/);
  assert.match(source, /disabled=\{downloadPending\}/);
  assert.match(source, /aria-busy=\{downloadPending\}/);
  assert.match(source, /downloadPending \? <Loader2 size=\{19\} className=\{s\.spinner\} \/> : <Download size=\{19\} \/>/);
  assert.match(styles, /\.spinner/);
  assert.match(styles, /@keyframes file-list-item-spin/);
});
