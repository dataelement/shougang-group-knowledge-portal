import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('useActionToast ignores blank messages and auto-clears toast after duration', () => {
  const source = readSource('src/hooks/useActionToast.ts');

  assert.match(source, /export function useActionToast\(durationMs = 3200\)/);
  assert.match(source, /window\.setTimeout\(\(\) => setToast\(null\), durationMs\)/);
  assert.match(source, /const showError = useCallback\(\(message: string\) =>/);
  assert.match(source, /const showSuccess = useCallback\(\(message: string\) =>/);
  assert.match(source, /const text = message\.trim\(\);\s*if \(!text\) return;/);
  assert.match(source, /setToast\(\{ message: text, type: 'error' \}\)/);
  assert.match(source, /setToast\(\{ message: text, type: 'success' \}\)/);
});

test('ActionToast renders alert markup for success and error states', () => {
  const source = readSource('src/components/ActionToast.tsx');

  assert.match(source, /if \(!toast\) return null;/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-live="assertive"/);
  assert.match(source, /toast\.type === 'success' \? s\.toastSuccess : s\.toastError/);
  assert.match(source, /CheckCircle|XCircle/);
});

test('SearchPage surfaces download failures via ActionToast', () => {
  const source = stripComments(readSource('src/pages/SearchPage.tsx'));

  assert.match(source, /import \{ ActionToast \} from '\.\.\/components\/ActionToast';/);
  assert.match(source, /import \{ useActionToast \} from '\.\.\/hooks\/useActionToast';/);
  assert.match(source, /const \{ toast, showError \} = useActionToast\(\);/);
  assert.match(source, /<ActionToast toast=\{toast\} \/>/);
  assert.match(
    source,
    /const message = err instanceof Error \? err\.message : '文档下载失败';\s*setError\(message\);\s*showError\(message\);/,
  );
  assert.match(source, /\}, \[showError\]\);/);
});

test('ListPage surfaces download failures via ActionToast', () => {
  const source = stripComments(readSource('src/pages/ListPage.tsx'));

  assert.match(source, /import \{ ActionToast \} from '\.\.\/components\/ActionToast';/);
  assert.match(source, /import \{ useActionToast \} from '\.\.\/hooks\/useActionToast';/);
  assert.match(source, /const \{ toast, showError \} = useActionToast\(\);/);
  assert.match(source, /<ActionToast toast=\{toast\} \/>/);
  assert.match(
    source,
    /const message = err instanceof Error \? err\.message : '文档下载失败';\s*setError\(message\);\s*showError\(message\);/,
  );
  assert.match(source, /\}, \[showError\]\);/);
});

test('DetailPage surfaces download failures via ActionToast', () => {
  const source = stripComments(readSource('src/pages/DetailPage.tsx'));

  assert.match(source, /import \{ ActionToast \} from '\.\.\/components\/ActionToast';/);
  assert.match(source, /import \{ useActionToast \} from '\.\.\/hooks\/useActionToast';/);
  assert.match(source, /const \{ toast, showError \} = useActionToast\(\);/);
  assert.match(source, /<ActionToast toast=\{toast\} \/>/);
  assert.match(
    source,
    /const message = err instanceof Error \? err\.message : '文档下载失败';\s*setDownloadError\(message\);\s*showError\(message\);/,
  );
});
