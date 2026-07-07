import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBusinessDomainCodeFromFileEncoding,
  getBusinessDomainFilterOptions,
  normalizeBusinessDomainCode,
} from '../src/utils/businessDomains';

test('business domain code is parsed from the third file encoding segment', () => {
  assert.equal(getBusinessDomainCodeFromFileEncoding('SGGF-STD-PP-202607-0001'), 'PP');
  assert.equal(getBusinessDomainCodeFromFileEncoding(' sggf-pro-qm-0001 '), 'QM');
  assert.equal(getBusinessDomainCodeFromFileEncoding('SGGF-STD-PP'), '');
  assert.equal(getBusinessDomainCodeFromFileEncoding(''), '');
});

test('business domain filter options use configured domains with codes only', () => {
  assert.deepEqual(
    getBusinessDomainFilterOptions([
      { name: '生产', code: 'pp', enabled: true, space_ids: [], color: '', bg: '', icon: '', background_image: '' },
      { name: '未编码', code: '', enabled: true, space_ids: [], color: '', bg: '', icon: '', background_image: '' },
      { name: '重复生产', code: 'PP', enabled: true, space_ids: [], color: '', bg: '', icon: '', background_image: '' },
      { name: '质量', code: 'QM', enabled: false, space_ids: [], color: '', bg: '', icon: '', background_image: '' },
    ]),
    [
      { code: 'PP', label: '生产 / PP' },
      { code: 'QM', label: '质量 / QM' },
    ],
  );
});

test('business domain code normalizes to uppercase', () => {
  assert.equal(normalizeBusinessDomainCode(' qm '), 'QM');
});
