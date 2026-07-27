import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyDepartmentFileView,
  fetchDepartmentFileViewAccess,
  mapKnowledgeFileItem,
} from '../src/api/content';

function envelope(data: unknown) {
  return new Response(JSON.stringify({
    status_code: 200,
    status_message: 'success',
    data,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('view access is a side-effect-free GET mapped to the current file', async () => {
  const originalFetch = globalThis.fetch;
  let path = '';
  let method = '';
  globalThis.fetch = (async (input, init) => {
    path = String(input);
    method = String(init?.method || 'GET');
    return envelope({
      space_id: 7103,
      file_id: 9301,
      status: 'approval_required',
      content_access: 'approval_required',
      can_download: true,
      safe_metadata: { file_name: '部门检修方案.pdf' },
    });
  }) as typeof fetch;

  try {
    const result = await fetchDepartmentFileViewAccess(7103, 9301);
    assert.equal(path, '/api/v1/knowledge/space/7103/files/9301/view-access');
    assert.equal(method, 'GET');
    assert.equal(result.status, 'approval_required');
    assert.equal(result.canDownload, true);
    assert.deepEqual(result.safeMetadata, { file_name: '部门检修方案.pdf' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apply trims reason and sends resource ids only through the path', async () => {
  const originalFetch = globalThis.fetch;
  let path = '';
  let body = '';
  globalThis.fetch = (async (input, init) => {
    path = String(input);
    body = String(init?.body || '');
    return envelope({
      status: 'pending',
      space_id: 7103,
      file_id: 9301,
      instance_id: 88,
      task_ids: [101],
    });
  }) as typeof fetch;

  try {
    const result = await applyDepartmentFileView(
      7103,
      9301,
      '  项目检修需要  ',
    );
    assert.equal(
      path,
      '/api/v1/knowledge/space/7103/files/9301/view-requests',
    );
    assert.deepEqual(JSON.parse(body), { reason: '项目检修需要' });
    assert.equal(result.instanceId, 88);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apply rejects blank and overlong reasons before a request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return envelope({});
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => applyDepartmentFileView(7103, 9301, '   '),
      /请填写申请原因/,
    );
    await assert.rejects(
      () => applyDepartmentFileView(7103, 9301, 'a'.repeat(2001)),
      /不能超过2000个字符/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('file mapping preserves the independent content and download decisions', () => {
  const item = mapKnowledgeFileItem({
    id: 9301,
    space_id: 7103,
    title: '部门检修方案',
    summary: '',
    source: '设备部知识库',
    updated_at: '2026-07-23T10:00:00',
    can_download: true,
    content_access: 'approval_required',
    is_department_file: true,
  });

  assert.equal(item.contentAccess, 'approval_required');
  assert.equal(item.isDepartmentFile, true);
  assert.equal(item.canDownload, true);
});

test('file mapping treats server entry capabilities as authoritative', () => {
  const item = mapKnowledgeFileItem({
    id: 9301,
    space_id: 7103,
    title: '部门检修方案',
    summary: '',
    source: '设备部知识库',
    updated_at: '2026-07-23T10:00:00',
    can_download: true,
    entry_type: 'share',
    canonical_document_id: 91,
    canonical_version_id: 501,
    manager_file_id: 9001,
    manager_space_id: 7001,
    projection_status: 'pending',
    projection_ready: false,
    capabilities: {
      can_view: true,
      can_preview: true,
      can_download: false,
    },
  });

  assert.equal(item.entryType, 'share');
  assert.equal(item.canonicalDocumentId, 91);
  assert.equal(item.managerFileId, null);
  assert.equal(item.managerSpaceId, 7001);
  assert.equal(item.projectionReady, false);
  assert.equal(item.canDownload, false);
  assert.equal(item.capabilities?.canPreview, true);
});

test('detail page checks status before content and gate never auto-submits', () => {
  const detailSource = readFileSync('src/pages/DetailPage.tsx', 'utf8');
  const gateSource = readFileSync(
    'src/components/DepartmentFileAccessGate.tsx',
    'utf8',
  );

  assert.ok(
    detailSource.indexOf('fetchDepartmentFileViewAccess(')
      < detailSource.indexOf('fetchFileDetail('),
  );
  assert.match(detailSource, /setDetail\(null\)/);
  assert.match(detailSource, /accessResult\.status !== 'allowed'/);
  assert.match(gateSource, /maxLength=\{2000\}/);
  assert.match(gateSource, /onClick=\{submit\}/);
  assert.doesNotMatch(gateSource, /useEffect\([^)]*onApply/);
  assert.match(gateSource, /打开我的申请/);
});
