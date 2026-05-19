import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminConfigSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const adminPageSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');

test('admin qa config exposes general and reasoning model fields', () => {
  assert.match(adminConfigSource, /general_model:\s*string/);
  assert.match(adminConfigSource, /reasoning_model:\s*string/);
  assert.match(adminConfigSource, /quick_mode_system_prompt:\s*string/);
  assert.match(adminConfigSource, /normal_mode_system_prompt:\s*string/);
  assert.match(adminConfigSource, /expert_mode_system_prompt:\s*string/);
  assert.match(adminConfigSource, /provider_name:\s*string/);
  assert.match(adminConfigSource, /status:\s*number/);
});

test('admin qa model dialog edits both general and reasoning models', () => {
  assert.match(adminPageSource, /通用模型/);
  assert.match(adminPageSource, /推理模型/);
  assert.match(adminPageSource, /general_model:\s*qaModelDraft\.general_model/);
  assert.match(adminPageSource, /reasoning_model:\s*qaModelDraft\.reasoning_model/);
});

test('admin qa model dialog uses provider grouped model selectors', () => {
  assert.match(adminPageSource, /function buildQaModelProviderGroups/);
  assert.match(adminPageSource, /function QaModelCascaderSelect/);
  assert.match(adminPageSource, /服务商/);
  assert.match(adminPageSource, /allowEmpty/);
  assert.doesNotMatch(adminPageSource, /<QaModelChoiceGroup[\s\S]*title="通用模型"/);
  assert.doesNotMatch(adminPageSource, /<QaModelChoiceGroup[\s\S]*title="推理模型"/);
});

test('admin qa model selector shows model name and identifiers in options', () => {
  assert.match(adminPageSource, /function getQaModelOptionLabel/);
  assert.match(adminPageSource, /ID \$\{model\.id\}/);
  assert.match(adminPageSource, /Key \$\{model\.key\}/);
  assert.match(adminPageSource, /getQaModelOptionLabel\(model\)/);
});

test('admin qa config exposes answer mode prompts', () => {
  assert.match(adminPageSource, /快速模式 Prompt/);
  assert.match(adminPageSource, /普通模式 Prompt/);
  assert.match(adminPageSource, /专家模式 Prompt/);
  assert.match(adminPageSource, /quick_mode_system_prompt/);
  assert.match(adminPageSource, /normal_mode_system_prompt/);
  assert.match(adminPageSource, /expert_mode_system_prompt/);
});
