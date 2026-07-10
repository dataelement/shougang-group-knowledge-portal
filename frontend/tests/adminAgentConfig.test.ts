import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canDeleteAgentCategory,
  createAgentCategoryDraft,
  createAgentDraft,
  createUrlApplicationDraft,
  toAgentCategoryConfig,
  toAgentItemConfig,
  validateAgentConfig,
  validateAgentDraft,
} from '../src/utils/adminAgentConfig';

const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('agent config helpers create stable editable drafts', () => {
  const category = createAgentCategoryDraft({ id: 'write', name: 'AI写作', enabled: true });
  const agent = createAgentDraft({
    id: 'report-agent',
    type: 'workflow',
    workflow_id: 'wf-1',
    url: '',
    name: '总结报告',
    desc: '生成总结材料',
    category_id: 'write',
    tags: ['总结', '汇报'],
    icon: 'FileText',
    icon_image_url: '',
    color: '#2563eb',
    bg: '#eff6ff',
    enabled: true,
  });

  assert.equal(toAgentCategoryConfig(category).id, 'write');
  assert.equal(toAgentItemConfig(agent).workflow_id, 'wf-1');
  assert.deepEqual(toAgentItemConfig(agent).tags, ['总结', '汇报']);
});

test('agent config validation blocks invalid references and duplicate workflows', () => {
  const validConfig = {
    categories: [{ id: 'qa', name: 'AI问答', enabled: true }],
    applications: [
      {
        id: 'policy',
        type: 'workflow' as const,
        workflow_id: 'wf-1',
        url: '',
        name: '制度专家',
        desc: '',
        category_id: 'qa',
        tags: [],
        icon: 'BookOpen',
        icon_image_url: '',
        color: '#0f766e',
        bg: '#ccfbf1',
        enabled: true,
      },
    ],
  };
  assert.equal(validateAgentConfig(validConfig), '');
  assert.match(
    validateAgentConfig({
      ...validConfig,
      applications: [
        ...validConfig.applications,
        { ...validConfig.applications[0], id: 'policy-2' },
      ],
    }),
    /workflow/,
  );
  assert.match(
    validateAgentConfig({
      ...validConfig,
      applications: [{ ...validConfig.applications[0], category_id: 'missing' }],
    }),
    /分类/,
  );
});

test('referenced agent categories cannot be deleted', () => {
  const category = { id: 'qa', name: 'AI问答', enabled: true };
  const agents = [{ id: 'policy', type: 'workflow' as const, workflow_id: 'wf-1', url: '', name: '制度专家', desc: '', category_id: 'qa', tags: [], icon: 'BookOpen', icon_image_url: '', color: '#0f766e', bg: '#ccfbf1', enabled: true }];
  assert.equal(canDeleteAgentCategory(category, agents).canDelete, false);
  assert.match(canDeleteAgentCategory(category, agents).reason, /正在使用/);
});

test('URL application drafts require safe URLs and keep uploaded icons', () => {
  const draft = createUrlApplicationDraft('url-apps');
  assert.match(validateAgentDraft(draft), /http/);
  const application = toAgentItemConfig({
    ...draft,
    name: '经营分析',
    url: 'https://apps.example.com/analysis',
    tagsText: '经营，分析',
    iconImageUrl: '/uploads/app-icons/demo.png',
  });
  assert.equal(application.type, 'url');
  assert.equal(application.workflow_id, '');
  assert.equal(application.icon_image_url, '/uploads/app-icons/demo.png');
  assert.deepEqual(application.tags, ['经营', '分析']);
});

test('admin page exposes agent config section and workflow selector states', () => {
  assert.match(adminPageSource, /智能应用配置/);
  assert.match(adminPageSource, /AgentConfigTable/);
  assert.match(adminPageSource, /AgentCategoryDialog/);
  assert.match(adminPageSource, /AgentDialog/);
  assert.match(adminPageSource, /fetchAgentWorkflowOptions/);
  assert.match(adminPageSource, /updateAgentConfig/);
  assert.match(adminPageSource, /onWorkflowKeywordChange/);
  assert.match(adminPageSource, /搜索 Bisheng workflow/);
  assert.match(adminPageSource, /刷新 workflow/);
  assert.match(adminPageSource, /添加 URL 应用/);
  assert.match(adminPageSource, /UrlApplicationDialog/);
  assert.match(adminPageSource, /uploadApplicationIcon/);
  assert.doesNotMatch(adminPageSource, /label: '应用市场'/);
  assert.match(adminPageSource, /agentWorkflowLoaded/);
  assert.match(adminPageSource, /agentWorkflowHasMore/);
  assert.match(adminPageSource, /agentWorkflowNextCursor/);
  assert.match(adminPageSource, /加载更多 workflow/);
  assert.match(adminPageSource, /未在已发布 workflow 候选项中/);
});
