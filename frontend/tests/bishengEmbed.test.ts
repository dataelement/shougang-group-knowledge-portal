import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledgeEmbedUrl } from '../src/utils/bishengEmbed';

const portalLocation = {
  protocol: 'http:',
  hostname: '110.16.193.170',
  origin: 'http://110.16.193.170:3001',
};

test('configured legacy knowledge URL uses the portal knowledge route on current hostname', () => {
  const url = resolveKnowledgeEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/knowledge',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge-portal?portal_embed=1');
});

test('configured custom knowledge URL keeps path and merges embed params on current hostname', () => {
  const url = resolveKnowledgeEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/custom-knowledge?foo=bar',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:4001/workspace/custom-knowledge?foo=bar&portal_embed=1');
});

test('runtime asset URL is converted to the knowledge page on the current portal hostname', () => {
  const url = resolveKnowledgeEmbedUrl(
    'http://127.0.0.1:4001',
    '',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge-portal?portal_embed=1');
});

test('fallback default avoids localhost so iframe can receive portal cookies', () => {
  const url = resolveKnowledgeEmbedUrl('', '', portalLocation);
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge-portal?portal_embed=1');
});
