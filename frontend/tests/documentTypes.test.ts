import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDocumentTypeFilterLabel,
  getDocumentTypeCodeFromFileEncoding,
  getRuntimeDocumentTypeGroups,
  getRuntimeDocumentTypes,
  matchesDocumentType,
  normalizeSearchSort,
  SEARCH_SORT_OPTIONS,
} from '../src/utils/documentTypes';

test('document type code is parsed from the second file encoding segment', () => {
  assert.equal(getDocumentTypeCodeFromFileEncoding('SGGF-RPT-PP-202604-01201'), 'RPT');
  assert.equal(getDocumentTypeCodeFromFileEncoding('SGGF-std-IT-202604-01201'), 'STD');
  assert.equal(getDocumentTypeCodeFromFileEncoding('SGGF'), '');
});

test('runtime document types flatten child categories and keep legacy flat items compatible', () => {
  assert.deepEqual(
    getRuntimeDocumentTypes([
      { code: ' pol ', label: '政策制度', children: [{ code: 'reg', label: '制度文件' }] },
      { code: 'RPT', label: '报告' },
      { code: 'RPT', label: '重复报告' },
      { code: 'STD', label: '标准规范' },
    ]),
    [
      { code: 'REG', label: '政策制度 / 制度文件', parentCode: 'POL', parentLabel: '政策制度' },
      { code: 'RPT', label: '报告', parentCode: 'RPT', parentLabel: '报告' },
      { code: 'STD', label: '标准规范', parentCode: 'STD', parentLabel: '标准规范' },
    ],
  );
});

test('runtime document type groups keep parent and child categories separately', () => {
  const groups = getRuntimeDocumentTypeGroups([
    { code: ' pro ', label: '流程与程序', children: [{ code: 'pro-a', label: '流程文件' }] },
    { code: 'RPT', label: '报告' },
  ]);

  assert.deepEqual(groups, [
    {
      code: 'PRO',
      label: '流程与程序',
      children: [{ code: 'PRO-A', label: '流程文件', parentCode: 'PRO', parentLabel: '流程与程序' }],
    },
    {
      code: 'RPT',
      label: '报告',
      children: [{ code: 'RPT', label: '报告', parentCode: 'RPT', parentLabel: '报告' }],
    },
  ]);
  assert.equal(getDocumentTypeFilterLabel(groups, 'PRO', ''), '流程与程序');
  assert.equal(getDocumentTypeFilterLabel(groups, 'PRO', 'PRO-A'), '流程与程序 / 流程文件');
});

test('document type matching requires an exact configured code match', () => {
  assert.equal(matchesDocumentType('RPT', 'RPT'), true);
  assert.equal(matchesDocumentType('STD', 'RPT'), false);
  assert.equal(matchesDocumentType('', 'RPT'), false);
});

test('search sort defaults to relevance and keeps updated time modes', () => {
  assert.deepEqual(
    SEARCH_SORT_OPTIONS.map((item) => item.value),
    ['relevance', 'updated_at_desc', 'updated_at_asc'],
  );
  assert.equal(normalizeSearchSort('relevance'), 'relevance');
  assert.equal(normalizeSearchSort('updated_at_desc'), 'updated_at_desc');
  assert.equal(normalizeSearchSort('updated_at_asc'), 'updated_at_asc');
  assert.equal(normalizeSearchSort(null), 'relevance');
  assert.equal(normalizeSearchSort('unknown'), 'relevance');
});
