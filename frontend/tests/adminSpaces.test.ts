import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteSpace, getSpaceBindingState, getSpaceUsage, getSpaceUsageSummary, setSpaceEnabled, upsertSpace } from '../src/utils/adminSpaces';

test('getSpaceBindingState distinguishes new, enabled, and disabled spaces', () => {
  const spaces = [
    { id: 12, name: '轧线技术案例库', file_count: 10, tag_count: 0, enabled: true },
    { id: 18, name: '冷轧技术手册', file_count: 12, tag_count: 0, enabled: false },
  ];

  assert.equal(getSpaceBindingState(spaces, { id: 25, name: '设备维修规范', description: '', file_count: 8 }), 'new');
  assert.equal(getSpaceBindingState(spaces, { id: 12, name: '轧线技术案例库', description: '', file_count: 10 }), 'enabled');
  assert.equal(getSpaceBindingState(spaces, { id: 18, name: '冷轧技术手册', description: '', file_count: 12 }), 'disabled');
});

test('getSpaceUsage and canDeleteSpace block deletion for referenced spaces', () => {
  const usage = getSpaceUsage(12, [
    { name: '轧线', space_ids: [12], color: '#111', bg: '#eee', icon: 'Factory', background_image: '', enabled: true, code: '' },
  ], {
    knowledge_space_ids: [12, 18],
    hot_questions: [],
    welcome_message: '你好，我是首钢股份知库智能助手，请问有什么可以帮您？',
    ai_search_system_prompt: '',
    qa_system_prompt: '',
    quick_mode_system_prompt: '',
    normal_mode_system_prompt: '',
    expert_mode_system_prompt: '',
    selected_model: '',
    general_model: '',
    reasoning_model: '',
    template_categories: [],
    templates: [],
  });

  assert.deepEqual(usage, { domainNames: ['轧线'], usedInQa: true });
  assert.equal(canDeleteSpace(usage), false);
  assert.equal(getSpaceUsageSummary(usage), '业务域：轧线 / 问答范围');
});

test('upsertSpace adds new spaces and re-enables existing disabled spaces', () => {
  const added = upsertSpace([], {
    id: 30,
    name: '能源管理文档',
    description: '能源',
    file_count: 5,
  });
  assert.equal(added.length, 1);
  assert.equal(added[0].enabled, true);

  const reenabled = upsertSpace([
    { id: 30, name: '旧名字', file_count: 1, tag_count: 0, enabled: false },
  ], {
    id: 30,
    name: '能源管理文档',
    description: '能源',
    file_count: 5,
  });
  assert.equal(reenabled[0].name, '能源管理文档');
  assert.equal(reenabled[0].file_count, 5);
  assert.equal(reenabled[0].enabled, true);
});

test('setSpaceEnabled updates only the targeted row', () => {
  const updated = setSpaceEnabled([
    { id: 12, name: '轧线', file_count: 1, tag_count: 0, enabled: true },
    { id: 18, name: '冷轧', file_count: 1, tag_count: 0, enabled: true },
  ], 1, false);

  assert.equal(updated[0].enabled, true);
  assert.equal(updated[1].enabled, false);
});
