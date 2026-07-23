import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('search results hide download action for anonymous visitors', () => {
  const source = readSource('src/pages/SearchPage.tsx');

  assert.match(source, /const \{ user \} = useAuth\(\);/);
  assert.match(source, /const canDownload = Boolean\(user\);/);
  assert.match(source, /onDownload=\{canDownload && f\.canDownload \? handleDownload : undefined\}/);
  assert.match(source, /downloadWatermarkedFile\(\{[\s\S]*entryPoint: 'search'/);
  assert.doesNotMatch(source, /recordFileDownloadEvent/);
});

test('knowledge list hides download action for anonymous visitors', () => {
  const source = readSource('src/pages/ListPage.tsx');

  assert.match(source, /import \{ useAuth \} from '\.\.\/hooks\/useAuth';/);
  assert.match(source, /const \{ user \} = useAuth\(\);/);
  assert.match(source, /const canDownload = Boolean\(user\);/);
  assert.match(source, /onDownload=\{canDownload && f\.canDownload \? handleDownload : undefined\}/);
  assert.match(source, /downloadWatermarkedFile\(\{[\s\S]*entryPoint: 'knowledge_list'/);
  assert.doesNotMatch(source, /recordFileDownloadEvent/);
});

test('document detail exposes a pending PDF button only with login and file permission', () => {
  const source = readSource('src/pages/DetailPage.tsx');

  assert.match(source, /import \{ useAuth \} from '\.\.\/hooks\/useAuth';/);
  assert.match(source, /const \{ user \} = useAuth\(\);/);
  assert.match(source, /const canDownload = Boolean\(user && detail\.canDownload\);/);
  assert.match(source, /\{canDownload \? \(/);
  assert.match(source, /disabled=\{downloadPending\}/);
  assert.match(source, /downloadPending \? '正在生成 PDF' : '下载 PDF'/);
  assert.match(source, /downloadWatermarkedFile\(/);
  assert.doesNotMatch(source, /下载原文件|recordFileDownloadEvent|effectivePreview\.downloadUrl/);
});
