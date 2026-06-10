import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEmbedOriginOverride,
  mergeKnowledgeDeepLinkParams,
  resolveKnowledgeEmbedUrl,
  resolvePortalDialogsEmbedUrl,
} from '../src/utils/bishengEmbed';

const portalLocation = {
  protocol: 'http:',
  hostname: '110.16.193.170',
  origin: 'http://110.16.193.170:3002',
};

test('configured legacy knowledge URL uses the portal same-origin knowledge route', () => {
  const url = resolveKnowledgeEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/knowledge',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1');
});

test('configured custom knowledge URL keeps path and merges embed params on portal origin', () => {
  const url = resolveKnowledgeEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/custom-knowledge?foo=bar',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:3002/workspace/custom-knowledge?foo=bar&portal_embed=1');
});

test('runtime asset URL is converted to the knowledge page on the portal origin', () => {
  const url = resolveKnowledgeEmbedUrl(
    'http://127.0.0.1:4001',
    '',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1');
});

test('fallback default uses portal origin so iframe can receive portal cookies', () => {
  const url = resolveKnowledgeEmbedUrl('', '', portalLocation);
  assert.equal(url, 'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1');
});

test('dialogs embed URL swaps the last path segment for portal-dialogs', () => {
  const url = resolvePortalDialogsEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/knowledge',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:3002/workspace/portal-dialogs?portal_embed=1');
});

test('dialogs embed URL falls back to default host path', () => {
  const url = resolvePortalDialogsEmbedUrl('', '', portalLocation);
  assert.equal(url, 'http://110.16.193.170:3002/workspace/portal-dialogs?portal_embed=1');
});

test('origin override swaps protocol/host/port but keeps path and query', () => {
  const base = 'http://110.16.193.170:4001/workspace/knowledge-portal?portal_embed=1';
  assert.equal(
    applyEmbedOriginOverride(base, 'http://192.168.106.171:3002'),
    'http://192.168.106.171:3002/workspace/knowledge-portal?portal_embed=1',
  );
});

test('origin override is a no-op when empty or unparseable', () => {
  const base = 'http://110.16.193.170:4001/workspace/knowledge-portal?portal_embed=1';
  assert.equal(applyEmbedOriginOverride(base, ''), base);
  assert.equal(applyEmbedOriginOverride(base, undefined), base);
  assert.equal(applyEmbedOriginOverride(base, 'not a url'), base);
});

test('knowledge embed URL receives portal deep-link file params', () => {
  const base = 'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1';
  const url = mergeKnowledgeDeepLinkParams(
    base,
    new URLSearchParams('spaceId=118&fileId=345'),
    portalLocation,
  );
  assert.equal(
    url,
    'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1&spaceId=118&fileId=345',
  );
});

test('knowledge embed URL ignores incomplete portal deep-link params', () => {
  const base = 'http://110.16.193.170:3002/workspace/knowledge-portal?portal_embed=1';
  assert.equal(mergeKnowledgeDeepLinkParams(base, new URLSearchParams('spaceId=118'), portalLocation), base);
  assert.equal(mergeKnowledgeDeepLinkParams(base, new URLSearchParams('fileId=345'), portalLocation), base);
});
