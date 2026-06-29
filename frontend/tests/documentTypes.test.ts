import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDocumentTypeCodeFromFileEncoding,
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

test('runtime document types keep configured labels and dedupe codes', () => {
  assert.deepEqual(
    getRuntimeDocumentTypes([
      { code: ' rpt ', label: '报告' },
      { code: 'RPT', label: '重复报告' },
      { code: 'STD', label: '' },
      { code: 'STD', label: '标准规范' },
    ]),
    [
      { code: 'RPT', label: '报告' },
      { code: 'STD', label: '标准规范' },
    ],
  );
});

test('document type matching requires an exact configured code match', () => {
  assert.equal(matchesDocumentType('SGGF-RPT-PP-202604-01201', 'RPT'), true);
  assert.equal(matchesDocumentType('SGGF-STD-PP-202604-01201', 'RPT'), false);
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
