import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDeleteQaTemplateCategory,
  createQaTemplateCategoryDraft,
  createQaTemplateDraft,
  validateQaTemplateCategoryDraft,
  validateQaTemplateDraft,
} from '../src/utils/adminQaTemplates';

const categories = [
  { id: 'work-report', name: '工作汇报', enabled: true },
  { id: 'plan', name: '方案策划', enabled: true },
];

test('createQaTemplateDraft maps existing template config to editor state', () => {
  assert.deepEqual(
    createQaTemplateDraft({
      id: 'work-plan',
      name: '工作计划',
      desc: '明确目标方向',
      category_id: 'plan',
      prompt: '请帮我制定一份工作计划。',
      icon: 'BriefcaseBusiness',
      color: '#f97316',
      bg: '#fff7ed',
      enabled: false,
      show_on_home: true,
    }),
    {
      id: 'work-plan',
      name: '工作计划',
      desc: '明确目标方向',
      categoryId: 'plan',
      prompt: '请帮我制定一份工作计划。',
      icon: 'BriefcaseBusiness',
      color: '#f97316',
      bg: '#fff7ed',
      enabled: false,
      showOnHome: true,
    },
  );
});

test('validateQaTemplateDraft returns a template config for valid input', () => {
  assert.deepEqual(
    validateQaTemplateDraft({
      id: '',
      name: '专项行动方案',
      desc: '集中资源攻坚',
      categoryId: 'plan',
      prompt: '请帮我起草专项行动方案。',
      icon: 'Layers3',
      color: '#f97316',
      bg: '#fff7ed',
      enabled: true,
      showOnHome: false,
    }, categories),
    {
      template: {
        id: 'special-action-plan',
        name: '专项行动方案',
        desc: '集中资源攻坚',
        category_id: 'plan',
        prompt: '请帮我起草专项行动方案。',
        icon: 'Layers3',
        color: '#f97316',
        bg: '#fff7ed',
        enabled: true,
        show_on_home: false,
      },
    },
  );
});

test('validateQaTemplateDraft rejects orphaned categories and blank prompts', () => {
  assert.equal(
    validateQaTemplateDraft({
      id: '',
      name: '测试模板',
      desc: '描述',
      categoryId: 'missing',
      prompt: '请帮我写。',
      icon: 'FileText',
      color: '#2563eb',
      bg: '#eff6ff',
      enabled: true,
      showOnHome: false,
    }, categories).error,
    '请选择有效分类',
  );
  assert.equal(
    validateQaTemplateDraft({
      id: '',
      name: '测试模板',
      desc: '描述',
      categoryId: 'plan',
      prompt: '',
      icon: 'FileText',
      color: '#2563eb',
      bg: '#eff6ff',
      enabled: true,
      showOnHome: false,
    }, categories).error,
    '请输入提示词',
  );
});

test('category helpers validate edits and block deleting categories in use', () => {
  assert.deepEqual(createQaTemplateCategoryDraft(categories[0]), {
    id: 'work-report',
    name: '工作汇报',
    enabled: true,
  });
  assert.deepEqual(validateQaTemplateCategoryDraft({
    id: '',
    name: '研究报告',
    enabled: true,
  }), {
    category: {
      id: 'research-report',
      name: '研究报告',
      enabled: true,
    },
  });
  assert.equal(
    canDeleteQaTemplateCategory('plan', [
      {
        id: 'work-plan',
        name: '工作计划',
        desc: '明确目标方向',
        category_id: 'plan',
        prompt: '请帮我制定一份工作计划。',
        icon: 'BriefcaseBusiness',
        color: '#f97316',
        bg: '#fff7ed',
        enabled: true,
        show_on_home: true,
      },
    ]),
    false,
  );
});
