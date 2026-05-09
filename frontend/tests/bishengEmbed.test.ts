import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledgeEmbedUrl } from '../src/utils/bishengEmbed';

const portalLocation = {
  protocol: 'http:',
  hostname: '110.16.193.170',
  origin: 'http://110.16.193.170:3001',
};

test('configured knowledge URL keeps port and path but uses current portal hostname', () => {
  const url = resolveKnowledgeEmbedUrl(
    '',
    'http://192.168.106.114:4001/workspace/knowledge',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge');
});

test('runtime asset URL is converted to the knowledge page on the current portal hostname', () => {
  const url = resolveKnowledgeEmbedUrl(
    'http://127.0.0.1:4001',
    '',
    portalLocation,
  );
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge');
});

test('fallback default avoids localhost so iframe can receive portal cookies', () => {
  const url = resolveKnowledgeEmbedUrl('', '', portalLocation);
  assert.equal(url, 'http://110.16.193.170:4001/workspace/knowledge');
});
