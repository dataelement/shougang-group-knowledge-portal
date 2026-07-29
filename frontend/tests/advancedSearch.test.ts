import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAdvancedSearchForm,
  buildAdvancedRetrievalQuery,
  clearAdvancedSearchConditions,
  EMPTY_ADVANCED_SEARCH_FORM,
  getAdvancedSearchForm,
} from '../src/utils/advancedSearch';

test('advanced search serializes keyword semantics, filters, date range, and keeps sort', () => {
  const params = new URLSearchParams('sort=updated_at_desc');
  const form = {
    ...EMPTY_ADVANCED_SEARCH_FORM,
    allKeywords: '轧机 振动',
    exactPhrase: '故障排查',
    anyKeywords: '轴承 松动',
    excludeKeywords: '招标',
    searchField: 'file_name' as const,
    spaceLevel: 'department',
    spaceId: '7103',
    businessDomainCode: 'PM',
    documentType: 'RPT',
    fileSubcategoryCode: 'RPT-A',
    fileExt: 'pdf',
    tag: '振动',
    updatedFrom: '2025-01-01',
    updatedTo: '2026-07-29',
  };

  const next = applyAdvancedSearchForm(params, form);

  assert.equal(next.get('advanced'), '1');
  assert.equal(next.get('q'), '故障排查 轧机 振动 轴承 松动');
  assert.equal(next.get('all_keywords'), '轧机 振动');
  assert.equal(next.get('exact_phrase'), '故障排查');
  assert.equal(next.get('any_keywords'), '轴承 松动');
  assert.equal(next.get('exclude_keywords'), '招标');
  assert.equal(next.get('search_field'), 'file_name');
  assert.equal(next.get('space_id'), '7103');
  assert.equal(next.get('updated_from'), '2025-01-01');
  assert.equal(next.get('updated_to'), '2026-07-29');
  assert.equal(next.get('sort'), 'updated_at_desc');
  assert.deepEqual(getAdvancedSearchForm(next), form);
});

test('advanced search supports filter-only browse and clear retains sorting', () => {
  const form = {
    ...EMPTY_ADVANCED_SEARCH_FORM,
    excludeKeywords: '招标',
    updatedFrom: '2025-01-01',
  };
  const applied = applyAdvancedSearchForm(new URLSearchParams('sort=relevance'), form);

  assert.equal(buildAdvancedRetrievalQuery(form), '');
  assert.equal(applied.has('q'), false);
  assert.equal(applied.get('exclude_keywords'), '招标');

  const cleared = clearAdvancedSearchConditions(applied);
  assert.equal(cleared.toString(), 'sort=relevance');
});

