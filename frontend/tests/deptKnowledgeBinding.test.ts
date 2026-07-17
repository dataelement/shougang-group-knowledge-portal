import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createBindingDraft, filterDepartmentOptions, findDepartmentOption, getIndeterminateDepartmentIds, groupBindingsByDepartment, toggleSelectedDepartmentId, validateBindingDraft,
} from '../src/utils/deptKnowledgeBinding';

const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('createBindingDraft is empty', () => {
  assert.deepEqual(createBindingDraft(), { spaceId: null, departmentId: null });
});

test('business domain department selection treats parent and child as independent choices', () => {
  assert.deepEqual(toggleSelectedDepartmentId(['1'], 2), ['1', '2']);
  assert.deepEqual(toggleSelectedDepartmentId(['1', '2'], 1), ['2']);
});

test('selected descendant makes every unselected ancestor indeterminate', () => {
  const departments = [{
    id: 1,
    name: '首钢股份',
    children: [{
      id: 2,
      name: '研发中心',
      children: [{ id: 3, name: '研发一部', children: [] }],
    }],
  }];

  assert.deepEqual([...getIndeterminateDepartmentIds(departments, ['3'])].sort(), [1, 2]);
});

test('unselected parent stays indeterminate when all descendants are selected', () => {
  const departments = [{
    id: 1,
    name: '研发中心',
    children: [
      { id: 2, name: '研发一部', children: [] },
      { id: 3, name: '研发二部', children: [] },
    ],
  }];

  assert.deepEqual([...getIndeterminateDepartmentIds(departments, ['2', '3'])], [1]);
  assert.deepEqual([...getIndeterminateDepartmentIds(departments, ['1', '2', '3'])], []);
  assert.deepEqual([...getIndeterminateDepartmentIds(departments, [])], []);
});

test('business domain tree wires indeterminate state to checkbox and accessibility state', () => {
  assert.match(adminPageSource, /input\.indeterminate = indeterminate/);
  assert.match(adminPageSource, /aria-checked=\{indeterminate \? 'mixed' : selected\}/);
});

test('validate requires both', () => {
  assert.equal(
    validateBindingDraft({ spaceId: null, departmentId: 3 }),
    '请选择要绑定的团队/科室知识库',
  );
  assert.ok(validateBindingDraft({ spaceId: 10, departmentId: null }));
  assert.equal(validateBindingDraft({ spaceId: 10, departmentId: 3 }), null);
});

test('groupBindingsByDepartment sorts by department name', () => {
  const rows = [
    { space_id: 2, space_name: 'B', department_id: 2, department_name: '乙部' },
    { space_id: 1, space_name: 'A', department_id: 1, department_name: '甲部' },
  ];
  const sorted = groupBindingsByDepartment(rows as any);
  assert.equal(sorted[0].department_name, '甲部');
});

test('department tree search keeps the matched node and its ancestor', () => {
  const departments = [{
    id: 1,
    name: '首钢股份',
    children: [{ id: 2, name: '研发中心', children: [] }],
  }];

  assert.equal(findDepartmentOption(departments, 2)?.name, '研发中心');
  assert.deepEqual(filterDepartmentOptions(departments, '研发'), [{
    id: 1,
    name: '首钢股份',
    children: [{ id: 2, name: '研发中心', children: [] }],
  }]);
});
