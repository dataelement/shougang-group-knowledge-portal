import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('smart QA renders a dedicated error state with retry wiring', () => {
  const source = readSource('src/pages/QAPage.tsx');
  assert.match(source, /error\?:\s*boolean/);
  assert.match(source, /retryLastQuestion/);
  assert.match(source, /s\.msgError/);
});

test('search AI summary catches failures and exposes retry', () => {
  const source = readSource('src/pages/SearchPage.tsx');
  assert.match(source, /const \[aiError, setAiError\]/);
  assert.match(source, /retryAiSummary/);
  assert.match(source, /s\.aiError/);
});

test('document QA uses one message error state instead of a duplicate footer error', () => {
  const source = readSource('src/components/DocumentQaModal.tsx');
  assert.match(source, /error\?:\s*boolean/);
  assert.match(source, /retryQuestion/);
  assert.doesNotMatch(source, /setError\(/);
});

test('portal stream exposes structured retry progress to every native QA entry', () => {
  const apiSource = readSource('src/api/content.ts');
  assert.match(apiSource, /onRetry\?:\s*\(progress:\s*ChatRetryProgress\)/);
  assert.match(apiSource, /eventName === 'retry'/);
  assert.match(apiSource, /\$\{title\}\\n\$\{reason\}/);

  for (const path of [
    'src/pages/QAPage.tsx',
    'src/pages/SearchPage.tsx',
    'src/components/DocumentQaModal.tsx',
  ]) {
    assert.match(readSource(path), /onRetry/);
  }
});

test('manual retry reuses the failed answer slot instead of appending another user message', () => {
  const qaSource = readSource('src/pages/QAPage.tsx');
  const documentSource = readSource('src/components/DocumentQaModal.tsx');

  assert.match(qaSource, /retryMessageIndex/);
  assert.match(documentSource, /retryMessageIndex/);
  assert.match(qaSource, /retryMessageIndex:\s*messageIndex/);
  assert.match(documentSource, /sendQuestion\(previousQuestion\.text,\s*messageIndex\)/);
});
