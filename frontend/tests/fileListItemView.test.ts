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
  // No resolved folder path -> falls back to the space name (old "<space> > <type>" dropped).
  assert.equal(view.sourcePath, '团队知识库');
  assert.equal(view.summaryText, baseFile.summary);
  assert.equal(Object.hasOwn(view, 'snippetText'), false);
  assert.deepEqual(view.visibleTags, ['数据库', 'PostgreSQL', '迁移']);
  assert.equal(view.hiddenTagCount, 1);
  assert.deepEqual(view.actions, []);
});

test('sourcePath uses the resolved folder breadcrumb when present', () => {
  const view = buildFileListItemView({ ...baseFile, folderPath: '测试02/C011/C0001' });
  assert.equal(view.sourcePath, '测试02/C011/C0001');
});

test('sourcePath uses the full document source path when supplied', () => {
  const fileWithSourcePath = {
    ...baseFile,
    folderPath: '信息/桃树栽培',
    sourcePath: '信息>桃树栽培/CO_2施肥对设施油桃生物学特性的影响.pdf',
  };

  const view = buildFileListItemView(fileWithSourcePath);

  assert.equal(view.sourcePath, '信息>桃树栽培/CO_2施肥对设施油桃生物学特性的影响.pdf');
});

test('does not fabricate unsupported confidence or actions', () => {
  const view = buildFileListItemView({ ...baseFile, summary: '', ext: '', tags: ['典型案例'] });

  assert.equal(view.documentTypeLabel, '文档');
  assert.equal(view.summaryText, '');
  assert.equal(Object.hasOwn(view, 'snippetText'), false);
  assert.equal(view.confidenceLabel, '');
  assert.deepEqual(view.visibleTags, []);
  assert.deepEqual(view.actions, []);
});

test('adds favorite action only when enabled by the caller', () => {
  const view = buildFileListItemView(baseFile, { canFavorite: true });

  assert.deepEqual(view.actions, ['favorite']);
});

test('adds share action when enabled by the caller', () => {
  const view = buildFileListItemView(baseFile, { canFavorite: true, canShare: true });

  assert.deepEqual(view.actions, ['favorite', 'share']);
});

test('orders list card actions as favorite download share qa', () => {
  const view = buildFileListItemView(baseFile, {
    canFavorite: true,
    canDownload: true,
    canShare: true,
    canAsk: true,
  });

  assert.deepEqual(view.actions, ['favorite', 'download', 'share', 'qa']);
});

test('adds qa action only when enabled by the caller', () => {
  const view = buildFileListItemView(baseFile, { canAsk: true });

  assert.deepEqual(view.actions, ['qa']);
});
