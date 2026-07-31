import assert from 'node:assert/strict';
import test from 'node:test';
import type { DepartmentFileViewAccess } from '../src/api/content';
import { resolveFileActionAccess } from '../src/utils/fileActionAccess';
import { buildFileListItemView } from '../src/utils/fileListItemView';

function access(
  status: DepartmentFileViewAccess['status'],
  canDownload = false,
): DepartmentFileViewAccess {
  return {
    spaceId: 12,
    fileId: 101,
    status,
    contentAccess: status === 'allowed' ? 'allowed' : 'approval_required',
    accessSource: null,
    canDownload,
    instanceId: null,
    latestInstanceStatus: null,
    safeMetadata: {},
  };
}

test('public file actions proceed without a department access lookup', async () => {
  let calls = 0;
  const result = await resolveFileActionAccess(
    { id: 101, spaceId: 12, isDepartmentFile: false },
    'favorite',
    async () => {
      calls += 1;
      return access('allowed');
    },
  );

  assert.equal(result.outcome, 'proceed');
  assert.equal(calls, 0);
});

test('department favorite opens the access gate when viewing is not allowed', async () => {
  const result = await resolveFileActionAccess(
    { id: 101, spaceId: 12, isDepartmentFile: true },
    'favorite',
    async () => access('approval_required'),
  );

  assert.equal(result.outcome, 'show_access_gate');
});

test('department download requires both view and download permissions', async () => {
  const withoutView = await resolveFileActionAccess(
    { id: 101, spaceId: 12, isDepartmentFile: true },
    'download',
    async () => access('approval_required'),
  );
  const withoutDownload = await resolveFileActionAccess(
    { id: 101, spaceId: 12, isDepartmentFile: true },
    'download',
    async () => access('allowed', false),
  );
  const allowed = await resolveFileActionAccess(
    { id: 101, spaceId: 12, isDepartmentFile: true },
    'download',
    async () => access('allowed', true),
  );

  assert.equal(withoutView.outcome, 'show_access_gate');
  assert.equal(withoutDownload.outcome, 'download_denied');
  assert.equal(allowed.outcome, 'proceed');
});

test('deferred department search result keeps metadata and logged-in actions visible', () => {
  const view = buildFileListItemView(
    {
      id: 101,
      spaceId: 12,
      title: '设备点检标准',
      summary: '检索结果摘要',
      source: '设备部知识库',
      date: '2025-01-01T00:00:00',
      tags: [],
      ext: 'pdf',
      sizeLabel: '1MB',
      fileEncoding: 'DEVICE-001',
      isDepartmentFile: true,
      contentAccess: 'check_required',
      canDownload: false,
    },
    { canFavorite: true, canDownload: true },
  );

  assert.equal(view.locked, false);
  assert.equal(view.summaryText, '检索结果摘要');
  assert.deepEqual(view.actions, ['favorite', 'download']);
});
