import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const contentApiSource = readFileSync('src/api/content.ts', 'utf8');
const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const qaPageSource = readFileSync('src/pages/QAPage.tsx', 'utf8');
const qaPageStyles = readFileSync('src/pages/QAPage.module.css', 'utf8');

function cssBlock(selector: string): string {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(qaPageStyles);
  return match?.[1] ?? '';
}

test('qa workspace exposes both canonical and portal-compatible routes', () => {
  assert.match(appSource, /<Route\s+path="\/qa"\s+element={<QAPage\s*\/>}\s*\/>/);
  assert.match(appSource, /<Route\s+path="\/portal\/qa"\s+element={<QAPage\s*\/>}\s*\/>/);
});

test('qa workspace renders writing templates and keeps chat on the existing qa scene', () => {
  assert.match(qaPageSource, /config\.qa\.template_categories/);
  assert.match(qaPageSource, /config\.qa\.templates/);
  assert.doesNotMatch(qaPageSource, /const TEMPLATE_CATEGORIES/);
  assert.doesNotMatch(qaPageSource, /const WRITING_TEMPLATES/);
  assert.match(qaPageSource, /scene:\s*'qa'/);
  assert.doesNotMatch(qaPageSource, /scene:\s*'search'/);
});

test('qa workspace uses a multiline composer with shift enter newline support', () => {
  assert.match(qaPageSource, /<textarea/);
  assert.match(qaPageSource, /Shift/);
  assert.match(qaPageSource, /开启新对话/);
  assert.match(qaPageSource, /联网搜索/);
});

test('qa workspace is backed by Bisheng daily chat conversations', () => {
  assert.match(qaPageSource, /fetchWorkstationConversations/);
  assert.match(qaPageSource, /fetchWorkstationMessages/);
  assert.match(qaPageSource, /conversationId:\s*activeSession\.conversationId/);
  assert.doesNotMatch(qaPageSource, /const DEMO_SESSIONS/);
});

test('qa workspace keeps the conversation list independently scrollable', () => {
  const sidebar = cssBlock('.sidebar');
  const sessionList = cssBlock('.sessionList');
  assert.match(sidebar, /min-height:\s*0;/);
  assert.match(sidebar, /overflow:\s*hidden;/);
  assert.match(sessionList, /overflow-y:\s*auto;/);
});

test('qa workspace does not show a blank history panel when messages are empty', () => {
  assert.match(qaPageSource, /loadingSessionId/);
  assert.match(qaPageSource, /当前会话暂无历史消息/);
  assert.doesNotMatch(qaPageSource, /const \[loadingMessages, setLoadingMessages\]/);
});

test('qa workspace reads configured general and reasoning models', () => {
  assert.match(qaPageSource, /config\.qa\.general_model/);
  assert.match(qaPageSource, /config\.qa\.reasoning_model/);
  assert.match(qaPageSource, /通用模型/);
  assert.match(qaPageSource, /推理模型/);
});

test('qa workspace sends the selected configured model with chat requests', () => {
  assert.match(qaPageSource, /model:\s*selectedModel/);
  assert.match(qaPageSource, /answerMode/);
});

test('qa workspace selects visible knowledge spaces for chat scope', () => {
  assert.match(qaPageSource, /fetchKnowledgeSpaces/);
  assert.match(qaPageSource, /availableSpaces/);
  assert.match(qaPageSource, /selectedKnowledgeSpaceIds/);
  assert.match(qaPageSource, /setSelectedKnowledgeSpaceIds\(\[\]\)/);
  assert.match(qaPageSource, /setSelectedKnowledgeSpaceIds\(availableSpaces\.map\(\(space\) => space\.id\)\)/);
  assert.match(qaPageSource, /knowledgeSpaceIds:\s*selectedKnowledgeSpaceIds/);
  assert.doesNotMatch(qaPageSource, /请至少选择一个知识库/);
  assert.match(qaPageSource, /space\.spaceLevel === 'personal'/);
  assert.match(qaPageSource, /space\.spaceLevel === 'team'/);
  assert.match(qaPageSource, /space\.spaceLevel === 'department'/);
  assert.match(qaPageSource, /space\.spaceLevel === 'public'/);
  assert.doesNotMatch(qaPageSource, /const KNOWLEDGE_SCOPES/);
  assert.doesNotMatch(qaPageSource, /展开目录/);
});

test('qa workspace uploads temporary attachments for chat', () => {
  assert.match(contentApiSource, /uploadChatAttachment/);
  assert.match(contentApiSource, /\/api\/v1\/workstation\/files/);
  assert.match(contentApiSource, /FormData/);
  assert.match(qaPageSource, /const \[attachedFiles, setAttachedFiles\]/);
  assert.match(qaPageSource, /const \[uploadingFiles, setUploadingFiles\]/);
  assert.match(qaPageSource, /type="file"/);
  assert.match(qaPageSource, /multiple/);
  assert.match(qaPageSource, /uploadChatAttachment/);
  assert.match(qaPageSource, /files:\s*messageFiles/);
  assert.match(qaPageSource, /files:\s*attachedFiles/);
  assert.match(qaPageSource, /hasChatAttachments/);
  assert.match(qaPageSource, /上传中/);
});

test('qa workspace model selector only shows model names', () => {
  assert.match(qaPageSource, /function getQaModelNameLabel/);
  assert.match(qaPageSource, /model\.name \|\| model\.display_name \|\| model\.id/);
  assert.doesNotMatch(qaPageSource, /ID \$\{model\.id\}/);
  assert.doesNotMatch(qaPageSource, /Key \$\{model\.key\}/);
  assert.doesNotMatch(qaPageSource, /choice\.fullLabel/);
});

test('qa workspace allows switching quick normal expert answer modes', () => {
  assert.match(qaPageSource, /const ANSWER_MODES/);
  assert.match(qaPageSource, /快速模式/);
  assert.match(qaPageSource, /普通模式/);
  assert.match(qaPageSource, /专家模式/);
  assert.doesNotMatch(qaPageSource, /智能体模式/);
  assert.doesNotMatch(qaPageSource, /当前会话已锁定回答模式/);
  assert.match(qaPageSource, /请先在后台配置推理模型/);
});

test('home quick app shortcuts open qa workspace templates without auto sending', () => {
  assert.match(homePageSource, /config\?\.qa\.templates/);
  assert.match(homePageSource, /show_on_home/);
  assert.match(homePageSource, /template\.id/);
  assert.doesNotMatch(homePageSource, /HOME_QA_SHORTCUTS/);
  assert.doesNotMatch(homePageSource, /总结汇报/);
  assert.match(homePageSource, /navigate\(`\/portal\/qa\?templateId=\$\{encodeURIComponent\(template\.id\)\}`\)/);
  assert.doesNotMatch(homePageSource, /app\.url/);

  assert.match(qaPageSource, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(qaPageSource, /templateId/);
  assert.match(qaPageSource, /findWritingTemplateById/);
  assert.match(qaPageSource, /window\.history\.replaceState/);
  assert.doesNotMatch(qaPageSource, /streamChatCompletion\(\{\s*scene:\s*'qa',\s*text:\s*template\.prompt/);
});
