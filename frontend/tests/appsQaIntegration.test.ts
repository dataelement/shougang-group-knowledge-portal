import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const appsPageSource = readFileSync('src/pages/AppsPage.tsx', 'utf8');
const appsPageStyles = readFileSync('src/pages/AppsPage.module.css', 'utf8');
const qaPageSource = readFileSync('src/pages/QAPage.tsx', 'utf8');
const qaPageStyles = readFileSync('src/pages/QAPage.module.css', 'utf8');
const homePageSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const floatingQaSource = readFileSync('src/components/FloatingQaButton.tsx', 'utf8');

function cssBlock(styles: string, selector: string): string {
  const match = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(styles);
  return match?.[1] ?? '';
}

test('/apps exposes smart qa and agent top-level tabs in the required order', () => {
  assert.match(appsPageSource, /MAIN_TABS/);
  assert.match(appsPageSource, /id:\s*'qa'[\s\S]*label:\s*'智能协作'/);
  assert.match(appsPageSource, /id:\s*'agent'[\s\S]*label:\s*'Agent 智能体'/);
  assert.ok(appsPageSource.indexOf("label: '智能协作'") < appsPageSource.indexOf("label: 'Agent 智能体'"));
  assert.match(appsPageSource, /resolveAppsTab/);
  assert.match(appsPageSource, /useState<AppsMainTab>\(\(\) => resolveAppsTab/);
});

test('/apps smart qa tab reuses the complete QAPage workspace capability', () => {
  assert.match(qaPageSource, /export function SmartQaWorkspace/);
  assert.match(appsPageSource, /SmartQaWorkspace/);
  assert.match(qaPageSource, /renderComposer/);
  assert.match(qaPageSource, /qaContent/);
  assert.match(qaPageSource, /streamChatCompletion\(\{[\s\S]*scene:\s*'qa'/);
  assert.match(qaPageSource, /QAKnowledgeTreePicker/);
  assert.match(qaPageSource, /fetchQaModelOptions/);
  assert.match(qaPageSource, /uploadChatAttachment/);
  assert.match(qaPageSource, /CitationList/);
});

test('/apps uses the app-style shared qa composer instead of the standalone qa workspace', () => {
  assert.match(qaPageSource, /onBeforeSend/);
  assert.match(qaPageSource, /smartAppComposer/);
  assert.match(qaPageSource, /type SmartQaComposerPlacement = 'top' \| 'bottom'/);
  assert.match(appsPageSource, /renderComposer\(\{ placement: 'top' \}\)/);
  assert.match(appsPageSource, /renderComposer\(\{ placement: 'bottom' \}\)/);
  assert.match(appsPageSource, /hasQaConversation/);
  assert.match(appsPageSource, /showTopComposer/);
  assert.doesNotMatch(appsPageSource, /<div className=\{activeTab === 'qa' \? s\.qaPane : s\.hiddenPane\}>\s*\{\s*workspace\s*\}/);
});

test('/apps places main tabs below the top composer and hides them in qa message mode', () => {
  assert.match(appsPageSource, /showMainTabs/);
  assert.match(appsPageSource, /const showMainTabs = !hasSelectedAgentWorkflow && !hasQaConversation/);
  assert.match(appsPageSource, /showMainTabs \? \(/);
  assert.match(appsPageSource, /className=\{s\.mainTabsRow\}/);
  assert.ok(appsPageSource.indexOf('className={s.sharedComposerTop}') < appsPageSource.indexOf('className={s.mainTabsRow}'));
  assert.ok(appsPageSource.indexOf('className={s.mainTabsRow}') < appsPageSource.indexOf("activeTab === 'qa' ? s.qaPane"));
  assert.doesNotMatch(appsPageSource, /<div className=\{s\.topbar\}>[\s\S]*className=\{s\.mainTabs\}/);
});

test('/apps uses main tabs as the content header without a duplicate agent title', () => {
  const mainTabsRow = cssBlock(appsPageStyles, '.mainTabsRow');
  const agentZone = cssBlock(appsPageStyles, '.agentZone');
  const composerTop = cssBlock(qaPageStyles, '.smartAppComposerTop');

  assert.match(mainTabsRow, /max-width:\s*1040px;/);
  assert.match(mainTabsRow, /padding:\s*0 36px 6px;/);
  assert.match(agentZone, /padding:\s*0 36px 32px;/);
  assert.match(composerTop, /padding:\s*20px 0 6px;/);
  assert.doesNotMatch(appsPageSource, /className=\{s\.agentHeader\}/);
  assert.doesNotMatch(appsPageSource, /className=\{s\.agentTitle\}/);
  assert.doesNotMatch(appsPageSource, /Agent 智能体\s*<\/div>[\s\S]*<\/div>\s*<div className=\{s\.tabs\}/);
});

test('new qa session restores the initial apps layout with qa tab active', () => {
  assert.match(appsPageSource, /onNewQa=\{\(\) => \{[\s\S]*qaSidebarState\.newSession\(\);[\s\S]*switchTab\('qa'\);[\s\S]*\}\}/);
  assert.match(appsPageSource, /const hasSelectedAgentWorkflow = activeTab === 'agent' && Boolean\(selectedAgent\)/);
  assert.match(appsPageSource, /const showMainTabs = !hasSelectedAgentWorkflow && !hasQaConversation/);
  assert.match(appsPageSource, /const showTopComposer = !hasSelectedAgentWorkflow && \(activeTab === 'agent' \|\| !hasQaConversation\)/);
});

test('/apps aligns qa, agent and main tab content width while keeping composer narrow', () => {
  const agentZone = cssBlock(appsPageStyles, '.agentZone');
  const templatePanel = cssBlock(qaPageStyles, '.templatePanel');
  const messages = cssBlock(qaPageStyles, '.messages');
  const composer = cssBlock(qaPageStyles, '.smartAppComposer');
  const mainTabsRow = cssBlock(appsPageStyles, '.mainTabsRow');
  const msgBubble = cssBlock(qaPageStyles, '.msgBubble');

  assert.match(agentZone, /max-width:\s*1040px;/);
  assert.match(templatePanel, /max-width:\s*1040px;/);
  assert.match(messages, /max-width:\s*1040px;/);
  assert.match(composer, /max-width:\s*690px;/);
  assert.match(mainTabsRow, /max-width:\s*1040px;/);
  assert.match(msgBubble, /max-width:\s*760px;/);
});

test('/apps smart qa template list uses the agent content visual system', () => {
  const smartAppContentArea = cssBlock(qaPageStyles, '.smartAppContentArea');
  const smartAppTemplatePanel = cssBlock(qaPageStyles, '.smartAppTemplatePanel');
  const smartAppTemplateTabs = cssBlock(qaPageStyles, '.smartAppTemplateTabs');
  const smartAppTemplateTab = cssBlock(qaPageStyles, '.smartAppTemplateTab');
  const smartAppTemplateGrid = cssBlock(qaPageStyles, '.smartAppTemplateGrid');
  const smartAppTemplateCard = cssBlock(qaPageStyles, '.smartAppTemplateCard');
  const smartAppTemplateLines = cssBlock(qaPageStyles, '.smartAppTemplateLines');
  const messages = cssBlock(qaPageStyles, '.messages');

  assert.match(qaPageSource, /const isSmartAppsMode = Boolean\(children\)/);
  assert.match(qaPageSource, /s\.smartAppContentArea/);
  assert.match(qaPageSource, /s\.smartAppTemplatePanel/);
  assert.match(qaPageSource, /s\.smartAppTemplateTabs/);
  assert.match(qaPageSource, /s\.smartAppTemplateGrid/);
  assert.match(qaPageSource, /s\.smartAppTemplateCard/);
  assert.match(smartAppContentArea, /padding:\s*0;/);
  assert.match(smartAppTemplatePanel, /padding:\s*0 36px 32px;/);
  assert.match(smartAppTemplateTabs, /border-bottom:\s*1px solid #e2e8f2;/);
  assert.match(smartAppTemplateTab, /font-size:\s*12px;/);
  assert.match(smartAppTemplateGrid, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(smartAppTemplateGrid, /gap:\s*8px;/);
  assert.match(smartAppTemplateCard, /border:\s*1px solid #e2e8f2;/);
  assert.match(smartAppTemplateCard, /padding:\s*12px;/);
  assert.match(smartAppTemplateCard, /box-shadow:\s*0 1px 4px rgba\(26,\s*63,\s*168,\s*0\.04\);/);
  assert.match(smartAppTemplateLines, /display:\s*none;/);
  assert.match(messages, /max-width:\s*1040px;/);
  assert.match(messages, /gap:\s*18px;/);
});

test('agent tab shared qa composer switches to smart qa before submitting', () => {
  assert.match(appsPageSource, /<SmartQaWorkspace[\s\S]*onBeforeSend=\{\(\) => switchTab\('qa'\)\}/);
  assert.match(appsPageSource, /activeTab === 'agent' \? `\$\{s\.agentPane\} \$\{hasSelectedAgentWorkflow \? s\.agentWorkflowPane : ''\}` : s\.hiddenPane/);
  assert.match(appsPageSource, /showTopComposer \? \(/);
  assert.match(appsPageSource, /const showTopComposer = !hasSelectedAgentWorkflow && \(activeTab === 'agent' \|\| !hasQaConversation\)/);
  assert.match(qaPageSource, /onBeforeSend\?\.\(\)/);
  assert.match(qaPageSource, /streamChatCompletion\(\{[\s\S]*scene:\s*'qa'/);
  assert.doesNotMatch(appsPageSource, /postMessage\(/);
});

test('/apps consumes templateId once inside the smart qa workspace', () => {
  assert.match(qaPageSource, /templateId/);
  assert.match(qaPageSource, /findWritingTemplateById/);
  assert.match(qaPageSource, /useLocation/);
  assert.match(qaPageSource, /useNavigate/);
  assert.match(qaPageSource, /setPendingTemplateId\(\(current\) => \(current === templateId \? current : templateId\)\)/);
  assert.match(qaPageSource, /navigate\(nextUrl, \{ replace: true \}\)/);
  assert.match(appsPageSource, /params\.set\('tab', tab\)/);
});

test('smart qa and agent share the apps left sidebar record model', () => {
  assert.match(appsPageSource, /type SmartAppsRecord/);
  assert.match(appsPageSource, /kind:\s*'qa'/);
  assert.match(appsPageSource, /kind:\s*'agent'/);
  assert.match(appsPageSource, /qaSidebarState/);
  assert.match(appsPageSource, /agentRecords/);
});

test('apps sidebar merges qa and workflow history records with source icons', () => {
  const contentSource = readFileSync('src/api/content.ts', 'utf8');

  assert.match(contentSource, /fetchAgentWorkflowConversations/);
  assert.match(contentSource, /\/api\/v1\/workstation\/workflow\/conversations/);
  assert.match(appsPageSource, /fetchAgentWorkflowConversations\(\{ page: 1, limit: 50 \}\)/);
  assert.match(appsPageSource, /\[\.\.\.qaRecords, \.\.\.agentRecords\]\.sort/);
  assert.match(appsPageSource, /resolveRecordGroup\(conversation\.updateAt \|\| conversation\.createAt\)/);
  assert.match(appsPageSource, /MessageSquareText/);
  assert.match(appsPageSource, /historyIconAgent/);
  assert.match(appsPageSource, /appendWorkflowChatId/);
  assert.match(appsPageSource, /setSelectedAgentConversationId\(record\.conversationId\)/);
  assert.match(appsPageStyles, /\.historyIconAgent/);
  assert.match(appsPageStyles, /\.historyIconQa/);
});

test('apps sidebar search filters loaded qa and workflow records by visible title only', () => {
  assert.match(appsPageSource, /searchOpen/);
  assert.match(appsPageSource, /searchQuery/);
  assert.match(appsPageSource, /normalizedSearchQuery/);
  assert.match(appsPageSource, /const visibleRecords = useMemo/);
  assert.match(appsPageSource, /record\.title\.toLowerCase\(\)\.includes\(normalizedSearchQuery\)/);
  assert.doesNotMatch(appsPageSource, /record\.latestMessage/);
  assert.doesNotMatch(appsPageSource, /getSessionLatestMessage/);
  assert.doesNotMatch(appsPageSource, /latestMessage: conversation\.latestMessage/);
  assert.match(appsPageSource, /setSearchOpen\(true\)/);
  assert.match(appsPageSource, /setSearchQuery\(''\)/);
  assert.match(appsPageSource, /未找到匹配会话/);
  assert.match(appsPageStyles, /\.searchInputWrap/);
  assert.match(appsPageStyles, /\.searchClearButton/);
  assert.match(appsPageStyles, /\.historyEmpty/);
});

test('legacy qa routes and user entries move to /apps smart qa', () => {
  assert.match(appSource, /path="\/qa"[\s\S]*<RedirectToSmartQa/);
  assert.match(appSource, /path="\/portal\/qa"[\s\S]*<RedirectToSmartQa/);
  assert.doesNotMatch(appSource, /path="\/qa"\s+element={<QAPage\s*\/>}/);
  assert.doesNotMatch(appSource, /path="\/portal\/qa"\s+element={<QAPage\s*\/>}/);
  assert.match(homePageSource, /navigate\(`\/apps\?tab=qa&templateId=\$\{encodeURIComponent\(template\.id\)\}`\)/);
  assert.match(floatingQaSource, /navigate\('\/apps\?tab=qa'\)/);
  assert.doesNotMatch(homePageSource, /navigate\(`\/portal\/qa\?templateId=/);
  assert.doesNotMatch(floatingQaSource, /navigate\('\/qa'\)/);
});
