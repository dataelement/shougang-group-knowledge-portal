import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainDraft, isSelectedDomainColor, validateDomainDraft, getDomainBindableSpaceGroups, DOMAIN_CODE_OPTIONS } from '../src/utils/adminDomains';

test('createDomainDraft maps existing domain values incl. code', () => {
  const draft = createDomainDraft({
    name: '轧线',
    space_ids: [12],
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
      icon: 'Snowflake',
      background_image: '/cold-domain-bg.jpg',
      color: '#6366f1',
      bg: '#ede9fe',
      enabled: true,
      code: 'PP',
    },
  });
});

test('validateDomainDraft allows binding to a department space', () => {
  const result = validateDomainDraft({
    name: '能源',
    spaceIds: ['20'],
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

test('DOMAIN_CODE_OPTIONS covers the 14 business-domain codes', () => {
  assert.equal(DOMAIN_CODE_OPTIONS.length, 14);
  assert.ok(DOMAIN_CODE_OPTIONS.some((o) => o.code === 'PP' && o.label === '生产'));
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
