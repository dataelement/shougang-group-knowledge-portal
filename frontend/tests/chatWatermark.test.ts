import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewWatermarkSource = readFileSync('src/components/PreviewWatermark.tsx', 'utf8');
const previewWatermarkStyles = readFileSync('src/components/PreviewWatermark.module.css', 'utf8');
const previewWatermarkUtils = readFileSync('src/utils/previewWatermark.ts', 'utf8');
const qaPageSource = readFileSync('src/pages/QAPage.tsx', 'utf8');
const qaPageStyles = readFileSync('src/pages/QAPage.module.css', 'utf8');
const appsPageSource = readFileSync('src/pages/AppsPage.tsx', 'utf8');

test('portal exposes a provider-only current-user watermark with a single opacity source', () => {
  assert.match(previewWatermarkSource, /export function PreviewWatermarkProvider/);
  assert.match(previewWatermarkSource, /user\s*\?\s*buildPortalPreviewWatermarkLines/);
  assert.match(previewWatermarkSource, /fillOpacity=\{layout\.opacity\}/);
  assert.match(previewWatermarkUtils, /WATERMARK_OPACITY\s*=\s*0\.31/);
  assert.doesNotMatch(previewWatermarkStyles, /fill-opacity/);
  assert.match(previewWatermarkStyles, /pointer-events:\s*none/);
  assert.match(previewWatermarkSource, /aria-hidden="true"/);
});

test('smart QA watermarks only the authenticated conversation content surface', () => {
  const qaContentStart = qaPageSource.indexOf('const qaContent =');
  const qaContentEnd = qaPageSource.indexOf('const renderComposer', qaContentStart);
  const qaContentSource = qaPageSource.slice(qaContentStart, qaContentEnd);

  assert.ok(qaContentStart >= 0 && qaContentEnd > qaContentStart);
  assert.match(qaContentSource, /<PreviewWatermarkProvider user=\{user\}>/);
  assert.match(qaContentSource, /data-chat-watermark-surface/);
  assert.match(
    qaContentSource,
    /\{\(!isSmartAppsMode \|\| hasConversation\) \? <PreviewWatermarkOverlay\s*\/> : null\}/,
  );
  assert.equal(
    qaContentSource.match(/<PreviewWatermarkOverlay\s*\/>/g)?.length,
    1,
    'smart writing must use one conversation-gated overlay',
  );
  assert.doesNotMatch(qaContentSource, /<textarea/);
  assert.doesNotMatch(qaContentSource, /className=\{s\.composer/);
  assert.match(
    qaPageStyles,
    /\.chatWatermarkSurface\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden/s,
  );
  assert.match(qaPageStyles, /\.contentArea\s*\{[^}]*overflow-y:\s*auto/s);
});

test('URL applications use one host overlay while authenticated workflow iframes own theirs', () => {
  const urlSurfaceStart = appsPageSource.indexOf('className={s.urlApplicationFrameWrap}');
  const urlSurfaceEnd = appsPageSource.indexOf('</PreviewWatermarkProvider>', urlSurfaceStart);
  const urlSurfaceSource = appsPageSource.slice(urlSurfaceStart, urlSurfaceEnd);
  const workflowStart = appsPageSource.indexOf('className={s.agentWorkflowSurface}');
  const workflowFrameStart = appsPageSource.indexOf('className={`${s.workflowFrame}', workflowStart);
  const workflowEnd = appsPageSource.indexOf('/>', workflowFrameStart);
  const workflowSource = appsPageSource.slice(workflowStart, workflowEnd);

  assert.ok(urlSurfaceStart >= 0 && urlSurfaceEnd > urlSurfaceStart);
  assert.match(appsPageSource, /const \{ user \} = useAuth\(\)/);
  assert.match(urlSurfaceSource, /data-chat-watermark-surface/);
  assert.match(urlSurfaceSource, /<PreviewWatermarkOverlay\s*\/>/);
  assert.match(appsPageSource, /<PreviewWatermarkProvider user=\{user\}>/);

  assert.ok(workflowStart >= 0 && workflowEnd > workflowStart);
  assert.doesNotMatch(workflowSource, /PreviewWatermark(?:Provider|Overlay)/);
  assert.doesNotMatch(workflowSource, /data-chat-watermark-surface/);
});
