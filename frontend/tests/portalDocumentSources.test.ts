import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('home recommendations preserve the home download source on detail routes', () => {
  const source = readSource('src/pages/HomePage.tsx');
  assert.match(source, /new URLSearchParams\(\{ entry_point: 'home_recommendation' \}\)/);
});

test('expert QA converts only structured knowledge document pairs to portal detail routes', () => {
  const source = readSource('src/pages/ExpertQADetailPage.tsx');
  assert.match(source, /`\/space\/\$\{docId\}\/file\/\$\{fileId\}\?entry_point=expert_qa`/);
  assert.match(source, /const href = hrefs\[index\] \|\| maybeLabel/);
  assert.doesNotMatch(source, /\/workspace\/knowledge\/file/);
});

test('QA citations carry the qa_citation source in list and inline links', () => {
  const pageSource = readSource('src/pages/QAPage.tsx');
  const markdownSource = readSource('src/utils/chatMessage.ts');
  assert.match(pageSource, /entry_point=qa_citation/);
  assert.match(markdownSource, /entry_point=qa_citation/);
});

test('frontend share access DTO never includes the opaque server grant', () => {
  const source = readSource('src/api/content.ts');
  const publicDto = source.slice(
    source.indexOf('interface ShareDocumentAccessDataDto'),
    source.indexOf('interface RelatedKnowledgeFileDataDto'),
  );
  assert.doesNotMatch(publicDto, /grant/i);
  assert.doesNotMatch(source, /download-event|recordFileDownloadEvent/);
});
