import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('vite dev server proxies root MinIO asset paths returned by BiSheng', () => {
  const configSource = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  assert.match(configSource, /\^\/bisheng/);
});

test('nginx MinIO proxy preserves the Host used to sign presigned URLs', () => {
  const nginxSource = readFileSync(resolve(process.cwd(), '../deploy/nginx/default.conf.template'), 'utf8');

  assert.match(nginxSource, /proxy_set_header\s+Host\s+\$\{BISHENG_MINIO_SIGNED_HOST\};/);
});

test('deployment exposes MinIO signed host as an explicit environment variable', () => {
  const composeSource = readFileSync(resolve(process.cwd(), '../docker-compose.yaml'), 'utf8');
  const dockerfileSource = readFileSync(resolve(process.cwd(), '../deploy/Dockerfile.portal-frontend'), 'utf8');

  assert.match(composeSource, /BISHENG_MINIO_SIGNED_HOST:/);
  assert.match(dockerfileSource, /ENV BISHENG_MINIO_SIGNED_HOST=/);
});
