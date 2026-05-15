import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileItem } from '../src/api/content';
import { buildFileListItemView } from '../src/utils/fileListItemView';

const baseFile: FileItem = {
  id: 1580,
  spaceId: 12,
  title: 'PostgreSQL 数据库迁移指南',
  summary: '从 MySQL 迁移到 PostgreSQL 的完整指南，包括数据迁移步骤、兼容性问题和注意事项。',
  source: '团队知识库',
  date: '2024-12-08T09:30:00',
  tags: ['最新精选', '数据库', 'PostgreSQL', '迁移', '运维'],
  ext: 'pdf',
  sizeLabel: '949.33KB',
  fileEncoding: 'GF-ZD-SC-202604-01201',
};

test('builds rich list card fields from existing file data', () => {
  const view = buildFileListItemView(baseFile, { visibleTagCount: 3 });

  assert.equal(view.documentTypeLabel, 'PDF 文档');
  assert.equal(view.dateLabel, '2024/12/08 09:30');
  assert.equal(view.sourcePath, '团队知识库 > PDF 文档');
  assert.equal(view.summaryText, baseFile.summary);
  assert.equal(Object.hasOwn(view, 'snippetText'), false);
  assert.deepEqual(view.visibleTags, ['数据库', 'PostgreSQL', '迁移']);
  assert.equal(view.hiddenTagCount, 1);
  assert.deepEqual(view.actions, ['detail']);
});

test('does not fabricate unsupported confidence or actions', () => {
  const view = buildFileListItemView({ ...baseFile, summary: '', ext: '', tags: ['典型案例'] });

  assert.equal(view.documentTypeLabel, '文档');
  assert.equal(view.summaryText, '');
  assert.equal(Object.hasOwn(view, 'snippetText'), false);
  assert.equal(view.confidenceLabel, '');
  assert.deepEqual(view.visibleTags, []);
  assert.deepEqual(view.actions, ['detail']);
});

test('adds favorite action only when enabled by the caller', () => {
  const view = buildFileListItemView(baseFile, { canFavorite: true });

  assert.deepEqual(view.actions, ['favorite', 'detail']);
});

test('adds share action when enabled by the caller', () => {
  const view = buildFileListItemView(baseFile, { canFavorite: true, canShare: true });

  assert.deepEqual(view.actions, ['favorite', 'share', 'detail']);
});
