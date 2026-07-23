import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpertProfilesPath } from '../src/api/expertQa';
import {
  applyExpertListOptions,
  calculateExpertScore,
  getNextExpertSort,
} from '../src/utils/expertManagement';

test('expert score follows the configured contribution weights', () => {
  assert.equal(
    calculateExpertScore({
      answer_count: 3,
      adoption_count: 2,
      vote_count: 4,
    }),
    21,
  );
});

test('expert list path keeps search, all filters, and sorting together', () => {
  const path = buildExpertProfilesPath(2, 10, '徐佳', {
    departmentId: '101',
    jobFamily: '制造技术族',
    jobCategory: '质量技术类',
    position: '质量检测',
    major: '首席工程师',
    sortBy: 'expert_score',
    sortOrder: 'desc',
  });
  const url = new URL(path, 'https://portal.example');

  assert.equal(url.pathname, '/workspace/api/v1/qa_experts/experts');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('keyword'), '徐佳');
  assert.equal(url.searchParams.get('department_id'), '101');
  assert.equal(url.searchParams.get('job_family'), '制造技术族');
  assert.equal(url.searchParams.get('job_category'), '质量技术类');
  assert.equal(url.searchParams.get('position'), '质量检测');
  assert.equal(url.searchParams.get('major'), '首席工程师');
  assert.equal(url.searchParams.get('sort_by'), 'expert_score');
  assert.equal(url.searchParams.get('sort_order'), 'desc');
});

test('clicking a new field starts ascending and repeated clicks toggle direction', () => {
  const next = getNextExpertSort(
    { field: 'created_at', order: 'desc' },
    'job_family',
  );
  assert.deepEqual(next, { field: 'job_family', order: 'asc' });
  assert.deepEqual(
    getNextExpertSort(next, 'job_family'),
    { field: 'job_family', order: 'desc' },
  );
});

test('legacy expert results are filtered by all selected career fields and sorted by score', () => {
  const base = {
    user_id: 1,
    introduction: null,
    depart_ment: '质量部',
    department_id: 10,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  const experts = [
    {
      ...base,
      id: 1,
      expert_name: '不匹配专家',
      job_family: '制造技术族',
      job_category: '质量技术类',
      position: '质量检测',
      major: '首席工程师',
      answer_count: 100,
      adoption_count: 0,
      vote_count: 0,
    },
    {
      ...base,
      id: 2,
      expert_name: '匹配专家乙',
      job_family: '技能操作族',
      job_category: '设备技能类',
      position: '精密点检',
      major: '首席技师',
      answer_count: 2,
      adoption_count: 1,
      vote_count: 1,
    },
    {
      ...base,
      id: 3,
      expert_name: '匹配专家甲',
      job_family: '技能操作族',
      job_category: '设备技能类',
      position: '精密点检',
      major: '首席技师',
      answer_count: 1,
      adoption_count: 3,
      vote_count: 0,
    },
    {
      ...base,
      id: 4,
      expert_name: '其他部门专家',
      department_id: 11,
      depart_ment: '设备部',
      job_family: '技能操作族',
      job_category: '设备技能类',
      position: '精密点检',
      major: '首席技师',
      answer_count: 100,
      adoption_count: 100,
      vote_count: 100,
    },
  ];

  const result = applyExpertListOptions(experts, {
    departmentId: '10',
    jobFamily: '技能操作族',
    jobCategory: '设备技能类',
    position: '精密点检',
    major: '首席技师',
    sortBy: 'expert_score',
    sortOrder: 'desc',
  });

  assert.deepEqual(result.map((expert) => expert.expert_name), [
    '匹配专家甲',
    '匹配专家乙',
  ]);
});
