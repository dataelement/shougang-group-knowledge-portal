import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  confirmMigrationOverwrite,
  createMigrationBatch,
  fetchMigrationBatches,
} from '../src/api/knowledgeMigration';

const apiSource = readFileSync('src/api/knowledgeMigration.ts', 'utf8');

function successfulFetch(capture: (path: string, init?: RequestInit) => void) {
  return (async (input: unknown, init?: RequestInit) => {
    capture(String(input), init);
    return new Response(
      JSON.stringify({
        status_code: 200,
        status_message: 'ok',
        data: {},
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;
}

test('migration API requests use the BiSheng workspace proxy', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  globalThis.fetch = successfulFetch((path, init) => {
    requests.push({ path, init });
  });

  try {
    await fetchMigrationBatches({ page: 2, pageSize: 10 });
    await createMigrationBatch({
      request_id: 'request-1',
      source_selections: [
        {
          space_id: 1,
          nodes: [{ node_type: 'file', node_id: 2 }],
        },
      ],
      target_space_id: 3,
      target_folder_id: null,
      preserve_structure: true,
      conflict_strategy: 'skip',
    });
    await confirmMigrationOverwrite('batch-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    requests.map(({ path }) => path),
    [
      '/workspace/api/v1/knowledge/migrations/batches?page=2&page_size=10',
      '/workspace/api/v1/knowledge/migrations/batches',
      '/workspace/api/v1/knowledge/migrations/batches/batch-1/confirm-overwrite',
    ],
  );
  assert.equal(requests[0].init?.credentials, 'include');
  assert.equal(requests[1].init?.method, 'POST');
  assert.equal(requests[2].init?.method, 'POST');
});

test('migration API client has one workspace proxy base and no BFF migration path', () => {
  assert.match(
    apiSource,
    /const MIGRATION_API_BASE = '\/workspace\/api\/v1\/knowledge\/migrations';/,
  );
  assert.doesNotMatch(
    apiSource,
    /request\((?:`|')\/api\/v1\/knowledge\/migrations/,
  );
});
