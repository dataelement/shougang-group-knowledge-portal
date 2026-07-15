import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainCodeOptions, createDomainDraft, getDomainBindableSpaceGroups, getDomainBoundSpaceIds, isSelectedDomainColor, validateDomainDraft } from '../src/utils/adminDomains';

test('createDomainDraft maps existing domain values incl. code', () => {
  const draft = createDomainDraft({
    name: '轧线',
    space_ids: [12],
    department_ids: [3, 8],
    color: '#059669',
    bg: '#d1fae5',
    icon: 'Factory',
    background_image: '/rolling-domain-bg.jpg',
    enabled: false,
    code: 'PP',
  });

  assert.deepEqual(draft, {
    name: '轧线',
    spaceIds: ['12'],
    departmentIds: ['3', '8'],
    icon: 'Factory',
    backgroundImage: '/rolling-domain-bg.jpg',
    color: '#059669',
    bg: '#d1fae5',
    enabled: false,
    code: 'PP',
  });
});

test('validateDomainDraft returns a domain config incl. uppercased code', () => {
  const result = validateDomainDraft({
    name: '冷轧',
    spaceIds: ['18'],
    departmentIds: ['3', '8', '3'],
    icon: 'Snowflake',
    backgroundImage: '/cold-domain-bg.jpg',
    color: '#6366f1',
    bg: '#ede9fe',
    enabled: true,
    code: 'pp',
  }, [
    { id: 18, name: '冷轧技术手册', description: '', file_count: 10, space_level: 'public' },
  ]);

  assert.deepEqual(result, {
    domain: {
      name: '冷轧',
      space_ids: [18],
      department_ids: [3, 8],
      icon: 'Snowflake',
      background_image: '/cold-domain-bg.jpg',
      color: '#6366f1',
      bg: '#ede9fe',
      enabled: true,
      code: 'PP',
    },
  });
});

test('validateDomainDraft preserves independently selected parent and child departments', () => {
  const result = validateDomainDraft({
    name: '研发',
    spaceIds: [],
    departmentIds: ['1', '2', '1'],
    icon: 'Factory',
    backgroundImage: '',
    color: '#2563eb',
    bg: '#eff6ff',
    enabled: true,
    code: 'RD',
  }, []);

  assert.deepEqual(result.domain?.department_ids, [1, 2]);
});

test('validateDomainDraft allows binding to a department space', () => {
  const result = validateDomainDraft({
    name: '能源',
    spaceIds: ['20'],
    departmentIds: [],
    icon: 'Zap',
    backgroundImage: '',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: 'EM',
  }, [
    { id: 20, name: '部门库', description: '', file_count: 0, space_level: 'department' },
  ]);
  assert.deepEqual(result.domain?.space_ids, [20]);
});

test('validateDomainDraft rejects binding to personal or team spaces', () => {
  const createDraft = (spaceId: string) => ({
    name: '能源',
    spaceIds: [spaceId],
    departmentIds: [],
    icon: 'Zap',
    backgroundImage: '',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: 'EM',
  });
  const spaces = [
    { id: 21, name: '个人库', description: '', file_count: 0, space_level: 'personal' },
    { id: 22, name: '团队库', description: '', file_count: 0, space_level: 'team' },
  ];

  assert.equal(validateDomainDraft(createDraft('21'), spaces).error, '绑定空间必须是公共或部门知识空间');
  assert.equal(validateDomainDraft(createDraft('22'), spaces).error, '绑定空间必须是公共或部门知识空间');
});

test('validateDomainDraft allows empty code', () => {
  const result = validateDomainDraft({
    name: '能源',
    spaceIds: [],
    departmentIds: [],
    icon: 'Zap',
    backgroundImage: '/energy-domain-bg.jpg',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: '',
  }, []);

  assert.equal(result.domain?.code, '');
  assert.deepEqual(result.domain?.space_ids, []);
});

test('validateDomainDraft still rejects unknown spaces', () => {
  const unknown = validateDomainDraft({
    name: '能源',
    spaceIds: ['30'],
    departmentIds: [],
    icon: 'Zap',
    backgroundImage: '',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: '',
  }, [
    { id: 12, name: '轧线技术案例库', description: '', file_count: 10 },
  ]);

  assert.equal(unknown.error, '绑定空间不存在');
});

test('validateDomainDraft supports multiple bindable spaces and deduplicates ids', () => {
  const result = validateDomainDraft({
    name: '能源',
    spaceIds: ['20', '21', '20'],
    departmentIds: [],
    icon: 'Zap',
    backgroundImage: '',
    color: '#d97706',
    bg: '#fef3c7',
    enabled: true,
    code: 'EM',
  }, [
    { id: 20, name: '公共库', description: '', file_count: 0, space_level: 'public' },
    { id: 21, name: '部门库', description: '', file_count: 0, space_level: 'department' },
  ]);

  assert.deepEqual(result.domain?.space_ids, [20, 21]);
});

test('buildDomainCodeOptions returns the fixed default options in display order', () => {
  const options = buildDomainCodeOptions();

  assert.deepEqual(options, [
    { code: 'PP', label: '生产' },
    { code: 'SD', label: '营销' },
    { code: 'FI', label: '财务' },
    { code: 'PM', label: '设备' },
    { code: 'SA', label: '安全' },
    { code: 'EN', label: '环保' },
    { code: 'HR', label: '人力' },
    { code: 'IT', label: '信息' },
    { code: 'EM', label: '能源' },
    { code: 'QM', label: '质量' },
    { code: 'AD', label: '管理' },
    { code: 'IM', label: '投资' },
    { code: 'MM', label: '采购' },
    { code: 'RD', label: '研发' },
  ]);
});

test('getDomainBoundSpaceIds only retains currently bindable spaces', () => {
  const boundSpaceIds = getDomainBoundSpaceIds(
    { space_ids: [19, 20, 21, 22, 999] },
    [
      { id: 19, name: '公共空间', description: '', file_count: 0, space_level: 'public' },
      { id: 20, name: '部门空间', description: '', file_count: 0, space_level: 'department' },
      { id: 21, name: '个人空间', description: '', file_count: 0, space_level: 'personal' },
      { id: 22, name: '团队空间', description: '', file_count: 0, space_level: 'team' },
    ],
  );

  assert.deepEqual(boundSpaceIds, [19, 20]);
});

test('isSelectedDomainColor matches preset color pairs exactly', () => {
  assert.equal(isSelectedDomainColor({ color: '#2563eb', bg: '#eff6ff' }, { color: '#2563eb', bg: '#eff6ff' }), true);
  assert.equal(isSelectedDomainColor({ color: '#2563eb', bg: '#eff6ff' }, { color: '#059669', bg: '#d1fae5' }), false);
});

test('getDomainBindableSpaceGroups groups public and department spaces only', () => {
  const result = getDomainBindableSpaceGroups([
    { id: 1, name: '营销', description: '', file_count: 0, space_level: 'public' },
    { id: 2, name: '我的库', description: '', file_count: 0, space_level: 'personal' },
    { id: 3, name: '部门库', description: '', file_count: 0, space_level: 'department' },
    { id: 4, name: '团队库', description: '', file_count: 0, space_level: 'team' },
  ]);
  assert.deepEqual(result.map((group) => [group.label, group.options.map((space) => space.id)]), [
    ['公共空间', [1]],
    ['部门空间', [3]],
  ]);
});
