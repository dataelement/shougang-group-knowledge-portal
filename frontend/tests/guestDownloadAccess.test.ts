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
  assert.match(source, /onDownload=\{canDownload \? handleDownload : undefined\}/);
});

test('knowledge list hides download action for anonymous visitors', () => {
  const source = readSource('src/pages/ListPage.tsx');

  assert.match(source, /import \{ useAuth \} from '\.\.\/hooks\/useAuth';/);
  assert.match(source, /const \{ user \} = useAuth\(\);/);
  assert.match(source, /const canDownload = Boolean\(user\);/);
  assert.match(source, /onDownload=\{canDownload \? handleDownload : undefined\}/);
});

test('document detail hides original-file download link for anonymous visitors', () => {
  const source = readSource('src/pages/DetailPage.tsx');
  const downloadLinkIndex = source.indexOf('下载原文件');
  const gateIndex = source.lastIndexOf('{user ? (', downloadLinkIndex);

  assert.match(source, /import \{ useAuth \} from '\.\.\/hooks\/useAuth';/);
  assert.match(source, /const \{ user \} = useAuth\(\);/);
  assert.notEqual(downloadLinkIndex, -1);
  assert.notEqual(gateIndex, -1);
});
