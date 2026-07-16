import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBindingDraft, validateBindingDraft, groupBindingsByDepartment,
} from '../src/utils/deptKnowledgeBinding';

test('createBindingDraft is empty', () => {
  assert.deepEqual(createBindingDraft(), { spaceId: null, departmentId: null });
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
