import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolvePortalWorkflowChatEmbedUrl,
} from '../src/utils/bishengEmbed';

const appsPageSource = readFileSync('src/pages/AppsPage.tsx', 'utf8');
const adminConfigSource = readFileSync('src/api/adminConfig.ts', 'utf8');
const contentApiSource = readFileSync('src/api/content.ts', 'utf8');
const embedSource = readFileSync('src/utils/bishengEmbed.ts', 'utf8');
const bishengRoutesSource = readFileSync('../../bisheng/src/frontend/platform/src/routes/index.tsx', 'utf8');
const bishengClientRoutesSource = readFileSync('../../bisheng/src/frontend/client/src/routes/index.tsx', 'utf8');
const portalWorkflowChatSource = readFileSync('../../bisheng/src/frontend/platform/src/pages/ChatAppPage/portalWorkflowChat.tsx', 'utf8');
const portalWorkflowChatClientSource = readFileSync('../../bisheng/src/frontend/client/src/pages/portalWorkflowChat/PortalWorkflowChatPage.tsx', 'utf8');
const standaloneChatPageSource = readFileSync('../../bisheng/src/frontend/client/src/pages/standaloneChat/StandaloneChatPage.tsx', 'utf8');
const standaloneSidebarHookSource = readFileSync('../../bisheng/src/frontend/client/src/pages/standaloneChat/hooks/useStandaloneSidebar.ts', 'utf8');
const appChatSource = readFileSync('../../bisheng/src/frontend/client/src/pages/appChat/index.tsx', 'utf8');
const appChatViewSource = readFileSync('../../bisheng/src/frontend/client/src/pages/appChat/ChatView.tsx', 'utf8');

const portalLocation = {
  protocol: 'http:',
  hostname: '110.16.193.170',
  origin: 'http://110.16.193.170:3002',
};

test('agent config API types and clients are exposed', () => {
  assert.match(adminConfigSource, /interface AgentConfig/);
  assert.match(adminConfigSource, /interface AgentWorkflowOption/);
  assert.match(adminConfigSource, /fetchAgentConfig/);
  assert.match(adminConfigSource, /updateAgentConfig/);
  assert.match(adminConfigSource, /fetchAgentWorkflowOptions/);
  assert.match(adminConfigSource, /agent_config/);
});

test('apps agent tab uses dynamic config data without static mock fallback', () => {
  assert.match(appsPageSource, /config\?\.agent_config/);
  assert.match(contentApiSource, /fetchAgentWorkflows/);
  assert.match(contentApiSource, /\/api\/v1\/workstation\/workflow\/agents/);
  assert.match(appsPageSource, /fetchAgentWorkflows\(\)/);
  assert.match(appsPageSource, /agentWorkflows/);
  assert.match(appsPageSource, /enabledAgents/);
  assert.match(appsPageSource, /agentEmpty/);
  assert.doesNotMatch(appsPageSource, /const AGENTS:\s*Agent\[\]/);
});

test('portal workflow iframe URL uses a dedicated route and keeps secrets out', () => {
  const result = resolvePortalWorkflowChatEmbedUrl(
    'http://127.0.0.1:4001',
    'workflow-uuid',
    portalLocation,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.url : '', 'http://110.16.193.170:3002/workspace/portal-chat/workflow/auth/workflow-uuid/?portal_embed=1');
  assert.doesNotMatch(result.ok ? result.url : '', /token|password|username|\/workspace\/chat\//);
  assert.match(embedSource, /DEFAULT_BISHENG_PORTAL_WORKFLOW_CHAT_PATH/);
  assert.match(embedSource, /\/workspace\/portal-chat\/workflow\/auth\//);
  assert.match(embedSource, /encodeURIComponent\(safeWorkflowId\)}\//);
});

test('portal workflow iframe URL returns typed errors for missing config', () => {
  const missingBase = resolvePortalWorkflowChatEmbedUrl('', 'workflow-uuid', portalLocation);
  assert.equal(missingBase.ok, false);
  assert.equal(missingBase.ok ? '' : missingBase.reason, 'missing_bisheng_base_url');
  const missingWorkflow = resolvePortalWorkflowChatEmbedUrl('http://127.0.0.1:4001', '', portalLocation);
  assert.equal(missingWorkflow.ok, false);
  assert.equal(missingWorkflow.ok ? '' : missingWorkflow.reason, 'missing_workflow_id');
  assert.doesNotMatch(appsPageSource, /window\.location\.origin/);
});

test('apps agent filtering uses category ids and iframe has loading states', () => {
  assert.match(appsPageSource, /type AgentFilter = 'all' \| 'favorite' \| `category:\$\{string\}`/);
  assert.match(appsPageSource, /toCategoryFilterId\(category\.id\)/);
  assert.match(appsPageSource, /key=\{filter\.id\}/);
  assert.match(appsPageSource, /iframeLoading/);
  assert.match(appsPageSource, /iframeLoadTimedOut/);
  assert.match(appsPageSource, /onLoad=\{\(\) => \{/);
});

test('apps agent favorites are persisted by workflow id', () => {
  assert.match(contentApiSource, /fetchAgentFavoriteWorkflowIds/);
  assert.match(contentApiSource, /favoriteAgentWorkflow/);
  assert.match(contentApiSource, /removeAgentWorkflowFavorite/);
  assert.match(contentApiSource, /\/api\/v1\/workstation\/workflow\/favorites/);
  assert.match(appsPageSource, /favoriteWorkflowIds/);
  assert.match(appsPageSource, /favoriteWorkflowIds\.has\(agent\.workflow_id\)/);
  assert.match(appsPageSource, /toggleFavorite\(agent\)/);
});

test('bisheng portal workflow chat route is independent from original chat route', () => {
  assert.match(bishengRoutesSource, /PortalWorkflowChat/);
  assert.match(bishengRoutesSource, /\/portal-chat\/workflow\/auth\/:id\//);
  assert.match(bishengRoutesSource, /\/portal-chat\/workflow\/auth\/:id"/);
  assert.match(bishengClientRoutesSource, /PortalWorkflowChatPage/);
  assert.match(bishengClientRoutesSource, /portal-chat\/workflow\/auth\/:flowId\//);
  assert.match(bishengClientRoutesSource, /portal-chat\/workflow\/auth\/:flowId'/);
  assert.match(portalWorkflowChatClientSource, /StandaloneChatPage/);
  assert.match(portalWorkflowChatClientSource, /flowType="workflow"/);
  assert.match(portalWorkflowChatClientSource, /hideSidebar/);
  assert.match(portalWorkflowChatClientSource, /forceNewChatOnLoad/);
  assert.match(portalWorkflowChatSource, /AppNumType\.FLOW/);
  assert.match(portalWorkflowChatSource, /ChatPanne/);
  assert.doesNotMatch(portalWorkflowChatSource, /export default function chatShare/);
});

test('portal workflow chat embed hides Bisheng sidebar and starts a fresh workflow session', () => {
  assert.match(standaloneChatPageSource, /hideSidebar\?: boolean/);
  assert.match(standaloneChatPageSource, /hideShare\?: boolean/);
  assert.match(standaloneChatPageSource, /forceNewChatOnLoad\?: boolean/);
  assert.match(standaloneChatPageSource, /initialChatId\?: string/);
  assert.match(standaloneChatPageSource, /const showSidebarControls = !hideSidebar/);
  assert.match(standaloneChatPageSource, /isTabletOrMobile && showSidebarControls && sidebarVisible/);
  assert.match(standaloneChatPageSource, /!isTabletOrMobile && showSidebarControls/);
  assert.match(standaloneChatPageSource, /showSidebarControls && \(/);
  assert.match(standaloneSidebarHookSource, /forceNewChatOnLoad\?: boolean/);
  assert.match(standaloneSidebarHookSource, /initialChatId\?: string/);
  assert.match(
    standaloneSidebarHookSource,
    /if \(initialChatId\) \{[\s\S]*setActiveChatId\(initialChatId\);[\s\S]*setHistoryLoaded\(true\);[\s\S]*return;/,
  );
  assert.match(
    standaloneSidebarHookSource,
    /if \(forceNewChatOnLoad\) \{[\s\S]*createNewChat\(\);[\s\S]*setHistoryLoaded\(true\);[\s\S]*return;/,
  );
  assert.match(portalWorkflowChatClientSource, /searchParams\.get\('chat_id'\)/);
  assert.match(portalWorkflowChatClientSource, /hideShare/);
  assert.match(portalWorkflowChatClientSource, /forceNewChatOnLoad=\{!chatId\}/);
  assert.match(portalWorkflowChatClientSource, /initialChatId=\{chatId\}/);
  assert.match(standaloneChatPageSource, /hideShare=\{hideShare\}/);
  assert.match(appChatSource, /hideShare = false/);
  assert.match(appChatSource, /const hideShareForMobile = hideShare \|\| flow\?\.can_share !== true/);
  assert.match(appChatSource, /hideShare=\{hideShare\}/);
  assert.match(appChatViewSource, /hideShare: forceHideShare = false/);
  assert.match(appChatViewSource, /const hideShare = forceHideShare \|\| data\?\.can_share !== true/);
  assert.match(appsPageSource, /agentLaunchKey/);
  assert.match(appsPageSource, /setAgentLaunchKey\(\(current\) => current \+ 1\)/);
  assert.match(appsPageSource, /key=\{`\$\{selectedAgent\.id\}-\$\{agentLaunchKey\}`\}/);
});

test('selected agent workflow covers apps main area without portal qa composer or agent list', () => {
  const cssSource = readFileSync('src/pages/AppsPage.module.css', 'utf8');

  assert.match(appsPageSource, /const hasSelectedAgentWorkflow = activeTab === 'agent' && Boolean\(selectedAgent\)/);
  assert.match(appsPageSource, /const showTopComposer = !hasSelectedAgentWorkflow && \(activeTab === 'agent' \|\| !hasQaConversation\)/);
  assert.match(appsPageSource, /const showMainTabs = !hasSelectedAgentWorkflow && !hasQaConversation/);
  assert.match(appsPageSource, /const showAgentList = !hasSelectedAgentWorkflow/);
  assert.match(appsPageSource, /!hasSelectedAgentWorkflow \? <div className=\{s\.topbar\} \/> : null/);
  assert.match(appsPageSource, /showAgentList \? \(/);
  assert.match(appsPageSource, /hasSelectedAgentWorkflow && selectedAgent \? \(/);
  assert.match(appsPageSource, /s\.agentWorkflowSurface/);
  assert.match(appsPageSource, /s\.iframePanelFull/);
  assert.match(appsPageSource, /s\.workflowFrameFull/);
  assert.doesNotMatch(appsPageSource, /postMessage\(/);
  assert.match(cssSource, /\.agentWorkflowPane[\s\S]*overflow:\s*hidden;/);
  assert.match(cssSource, /\.agentWorkflowSurface[\s\S]*flex:\s*1;[\s\S]*min-height:\s*0;/);
  assert.match(cssSource, /\.iframePanelFull[\s\S]*margin-top:\s*0;[\s\S]*border:\s*0;/);
  assert.match(cssSource, /\.workflowFrameFull[\s\S]*min-height:\s*0;[\s\S]*height:\s*100%;/);
});
