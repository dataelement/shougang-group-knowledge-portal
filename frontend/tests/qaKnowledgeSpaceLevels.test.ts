import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QA_SPACE_LEVEL_LABELS,
  QA_SPACE_LEVEL_ORDER,
  filterSpacesByLevel,
  isQaSpaceLevelTab,
  pickDefaultSpaceLevel,
} from '../src/components/qaKnowledgeSpaceLevels';

test('QA_SPACE_LEVEL_ORDER is public → department → team → personal', () => {
  assert.deepEqual([...QA_SPACE_LEVEL_ORDER], ['public', 'department', 'team', 'personal']);
});

test('labels match product copy', () => {
  assert.equal(QA_SPACE_LEVEL_LABELS.public, '公共知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.department, '部门知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.team, '团队知识库');
  assert.equal(QA_SPACE_LEVEL_LABELS.personal, '个人知识库');
});

test('isQaSpaceLevelTab accepts only the four tabs', () => {
  assert.equal(isQaSpaceLevelTab('public'), true);
  assert.equal(isQaSpaceLevelTab('other'), false);
  assert.equal(isQaSpaceLevelTab(''), false);
});

test('pickDefaultSpaceLevel prefers first non-empty level', () => {
  assert.equal(pickDefaultSpaceLevel([]), 'public');
  assert.equal(pickDefaultSpaceLevel([{ spaceLevel: 'personal' }]), 'personal');
  assert.equal(
    pickDefaultSpaceLevel([{ spaceLevel: 'team' }, { spaceLevel: 'public' }]),
    'public',
  );
  assert.equal(
    pickDefaultSpaceLevel([{ spaceLevel: 'other' }, { spaceLevel: 'department' }]),
    'department',
  );
  assert.equal(pickDefaultSpaceLevel([{ spaceLevel: 'other' }]), 'public');
});

test('filterSpacesByLevel keeps only exact level and drops other/unknown', () => {
  const spaces = [
    { id: 1, spaceLevel: 'public' },
    { id: 2, spaceLevel: 'department' },
    { id: 3, spaceLevel: 'other' },
    { id: 4, spaceLevel: null },
    { id: 5, spaceLevel: 'public' },
  ];
  assert.deepEqual(
    filterSpacesByLevel(spaces, 'public').map((s) => s.id),
    [1, 5],
  );
  assert.deepEqual(filterSpacesByLevel(spaces, 'team'), []);
});
