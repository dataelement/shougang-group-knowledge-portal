import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  Globe,
  Loader2,
  PenLine,
  Search,
  Send,
  Star,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import type { AgentItemConfig, PortalConfig } from '../api/adminConfig';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { applyEmbedOriginOverride, resolvePortalWorkflowChatEmbedUrl } from '../utils/bishengEmbed';
import { SmartQaWorkspace, type Session } from './QAPage';
import s from './AppsPage.module.css';

type AppsMainTab = 'qa' | 'agent';
type AgentFilter = 'all' | 'favorite' | `category:${string}`;

interface AgentFilterOption {
  id: AgentFilter;
  label: string;
}

type SmartAppsRecord =
  | { kind: 'qa'; id: string; title: string; group: string; session: Session }
  | { kind: 'agent'; id: string; agentId: string; title: string; group: string };

const MAIN_TABS: { id: AppsMainTab; label: string }[] = [
  { id: 'qa', label: '智能问答' },
  { id: 'agent', label: 'Agent 智能体' },
];

const AGENT_ICON_MAP: Record<string, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  Globe,
  PenLine,
  Search,
  Send,
};

export function resolveAppsTab(search: string): AppsMainTab {
  const tab = new URLSearchParams(search).get('tab')?.trim();
  return tab === 'agent' ? 'agent' : 'qa';
}

function getAgentCategoryName(agent: AgentItemConfig, config: PortalConfig | null): string {
  return config?.agent_config.categories.find((category) => category.id === agent.category_id)?.name || agent.category_id;
}

function getBishengBaseUrl(config: PortalConfig | null): string {
  return (
    config?.integrations?.bisheng_admin_entry_url?.trim()
    || config?.integrations?.bisheng_knowledge_entry_url?.trim()
    || ''
  );
}

function toCategoryFilterId(categoryId: string): AgentFilter {
  return `category:${categoryId}`;
}

function SmartAppsSidebar({
  records,
  activeRecordId,
  loading,
  onNewQa,
  onSelectRecord,
}: {
  records: SmartAppsRecord[];
  activeRecordId: string;
  loading: boolean;
  onNewQa: () => void;
  onSelectRecord: (record: SmartAppsRecord) => void;
}) {
  const groups = ['今天', '昨天', '7 天内', '30 天内', 'Agent'];
  return (
    <aside className={s.sidebar} aria-label="智能应用会话列表">
      <div className={s.logoRow}>
        <div className={s.logoIcon}>
          <Bot size={17} strokeWidth={2} />
        </div>
      </div>
      <div className={s.sidebarBody}>
        <button className={s.newButton} type="button" onClick={onNewQa}>
          <PenLine size={14} strokeWidth={2} />
          发起新对话
        </button>
        <button className={s.searchButton} type="button">
          <Search size={14} strokeWidth={2} />
          搜索对话内容
        </button>
      </div>
      <div className={s.sidebarSection}>最近</div>
      <div className={s.historyList}>
        {loading ? <div className={s.historyGroupLabel}>会话加载中...</div> : null}
        {groups.map((group) => {
          const groupRecords = records.filter((record) => record.group === group);
          if (!groupRecords.length) return null;
          return (
            <div className={s.historyGroup} key={group}>
              <div className={s.historyGroupLabel}>{group}</div>
              {groupRecords.map((record) => (
                <button
                  className={`${s.historyItem} ${activeRecordId === record.id ? s.historyItemActive : ''}`}
                  key={`${record.kind}-${record.id}`}
                  onClick={() => onSelectRecord(record)}
                  title={record.title}
                  type="button"
                >
                  {record.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default function AppsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { config, loading: configLoading, error: configError } = usePortalConfig();
  const [activeTab, setActiveTab] = useState<AppsMainTab>(() => resolveAppsTab(location.search));
  const [activeAgentFilter, setActiveAgentFilter] = useState<AgentFilter>('all');
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentRecords, setAgentRecords] = useState<SmartAppsRecord[]>([]);
  const [activeAgentRecordId, setActiveAgentRecordId] = useState('');
  const [agentLaunchKey, setAgentLaunchKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeLoadTimedOut, setIframeLoadTimedOut] = useState(false);
  const iframeLoadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveTab(resolveAppsTab(location.search));
  }, [location.search]);

  const agentConfig = config?.agent_config ?? { categories: [], agents: [] };
  const enabledCategories = useMemo(
    () => agentConfig.categories.filter((category) => category.enabled),
    [agentConfig.categories],
  );
  const enabledAgents = useMemo(
    () => agentConfig.agents.filter((agent) => agent.enabled),
    [agentConfig.agents],
  );
  const selectedAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [enabledAgents, selectedAgentId],
  );
  const agentFilters = useMemo<AgentFilterOption[]>(
    () => [
      { id: 'all', label: '全部' },
      { id: 'favorite', label: '收藏' },
      ...enabledCategories.map((category) => ({
        id: toCategoryFilterId(category.id),
        label: category.name,
      })),
    ],
    [enabledCategories],
  );
  const visibleAgents = useMemo(() => {
    if (activeAgentFilter === 'all') return enabledAgents;
    if (activeAgentFilter === 'favorite') return enabledAgents.filter((agent) => favoriteIds.has(agent.id));
    const categoryId = activeAgentFilter.replace(/^category:/, '');
    return enabledAgents.filter((agent) => agent.category_id === categoryId);
  }, [activeAgentFilter, enabledAgents, enabledCategories, favoriteIds]);
  const bishengBaseUrl = getBishengBaseUrl(config);
  const iframeResult = useMemo(
    () => (selectedAgent
      ? resolvePortalWorkflowChatEmbedUrl(bishengBaseUrl, selectedAgent.workflow_id)
      : null),
    [bishengBaseUrl, selectedAgent],
  );
  const iframeSrc = iframeResult?.ok
    ? applyEmbedOriginOverride(iframeResult.url, import.meta.env.VITE_BISHENG_EMBED_ORIGIN)
    : '';

  useEffect(() => {
    if (iframeLoadTimerRef.current !== null) {
      window.clearTimeout(iframeLoadTimerRef.current);
      iframeLoadTimerRef.current = null;
    }
    if (!iframeSrc) {
      setIframeLoading(false);
      setIframeLoadTimedOut(false);
      return undefined;
    }
    setIframeLoading(true);
    setIframeLoadTimedOut(false);
    iframeLoadTimerRef.current = window.setTimeout(() => {
      setIframeLoading(false);
      setIframeLoadTimedOut(true);
      iframeLoadTimerRef.current = null;
    }, 15000);
    return () => {
      if (iframeLoadTimerRef.current !== null) {
        window.clearTimeout(iframeLoadTimerRef.current);
        iframeLoadTimerRef.current = null;
      }
    };
  }, [iframeSrc, agentLaunchKey]);

  function syncTabToUrl(tab: AppsMainTab) {
    const params = new URLSearchParams(location.search);
    params.set('tab', tab);
    navigate(`/apps?${params.toString()}`, { replace: true });
  }

  function switchTab(tab: AppsMainTab) {
    setActiveTab(tab);
    syncTabToUrl(tab);
  }

  function toggleFavorite(agentId: string) {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  function selectAgent(agent: AgentItemConfig) {
    setSelectedAgentId(agent.id);
    setAgentLaunchKey((current) => current + 1);
    const recordId = `agent_${agent.id}`;
    setActiveAgentRecordId(recordId);
    setAgentRecords((current) => {
      if (current.some((record) => record.id === recordId)) return current;
      return [{ kind: 'agent', id: recordId, agentId: agent.id, title: agent.name, group: 'Agent' }, ...current];
    });
  }

  return (
    <SmartQaWorkspace onBeforeSend={() => switchTab('qa')}>
      {({ qaContent, hasConversation: hasQaConversation, renderComposer, qaSidebarState }) => {
        const qaRecords: SmartAppsRecord[] = qaSidebarState.sessions.map((session) => ({
          kind: 'qa',
          id: session.id,
          title: session.title,
          group: session.group,
          session,
        }));
        const records = [...qaRecords, ...agentRecords];
        const activeRecordId = activeTab === 'agent' ? activeAgentRecordId : qaSidebarState.activeId;
        const hasSelectedAgentWorkflow = activeTab === 'agent' && Boolean(selectedAgent);
        const showTopComposer = !hasSelectedAgentWorkflow && (activeTab === 'agent' || !hasQaConversation);
        const showMainTabs = !hasSelectedAgentWorkflow && !hasQaConversation;
        const showAgentList = !hasSelectedAgentWorkflow;

        return (
          <PageShell>
            <div className={s.page}>
              <div className={s.shell}>
                <SmartAppsSidebar
                  records={records}
                  activeRecordId={activeRecordId}
                  loading={qaSidebarState.loadingSessions}
                  onNewQa={() => {
                    qaSidebarState.newSession();
                    switchTab('qa');
                  }}
                  onSelectRecord={(record) => {
                    if (record.kind === 'qa') {
                      qaSidebarState.selectSession(record.session);
                      switchTab('qa');
                      return;
                    }
                    setSelectedAgentId(record.agentId);
                    setActiveAgentRecordId(record.id);
                    setAgentLaunchKey((current) => current + 1);
                    switchTab('agent');
                  }}
                />

                <section className={s.mainPanel}>
                  {!hasSelectedAgentWorkflow ? <div className={s.topbar} /> : null}

                  {showTopComposer ? (
                    <div className={s.sharedComposerTop}>
                      {renderComposer({ placement: 'top' })}
                    </div>
                  ) : null}

                  {showMainTabs ? (
                    <div className={s.mainTabsRow}>
                      <div className={s.mainTabs} role="tablist" aria-label="智能应用类型">
                        {MAIN_TABS.map((tab) => (
                          <button
                            aria-selected={activeTab === tab.id}
                            className={`${s.mainTab} ${activeTab === tab.id ? s.mainTabActive : ''}`}
                            key={tab.id}
                            onClick={() => switchTab(tab.id)}
                            role="tab"
                            type="button"
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className={activeTab === 'qa' ? s.qaPane : s.hiddenPane}>
                    <div className={hasQaConversation ? s.qaConversationContent : s.qaTemplateContent}>
                      {qaContent}
                    </div>
                    {hasQaConversation ? (
                      <div className={s.sharedComposerBottom}>
                        {renderComposer({ placement: 'bottom' })}
                      </div>
                    ) : null}
                  </div>

                  <div className={activeTab === 'agent' ? `${s.agentPane} ${hasSelectedAgentWorkflow ? s.agentWorkflowPane : ''}` : s.hiddenPane}>
                    {showAgentList ? (
                      <div className={s.agentZone}>
                        <div className={s.tabs} role="tablist" aria-label="智能体分类">
                          {agentFilters.map((filter) => (
                            <button
                              aria-selected={activeAgentFilter === filter.id}
                              className={`${s.tab} ${filter.id === 'favorite' ? s.favoriteTab : ''} ${activeAgentFilter === filter.id ? s.tabActive : ''}`}
                              key={filter.id}
                              onClick={() => setActiveAgentFilter(filter.id)}
                              role="tab"
                              type="button"
                            >
                              {filter.id === 'favorite' ? <Star size={12} strokeWidth={2} /> : null}
                              {filter.label}
                            </button>
                          ))}
                        </div>

                        {configLoading ? (
                          <div className={s.agentEmpty}>
                            <Loader2 className={s.spinner} size={24} />
                            <span>正在加载智能体配置...</span>
                          </div>
                        ) : null}
                        {configError ? (
                          <div className={s.agentEmpty}>
                            <AlertCircle size={24} />
                            <span>{configError}</span>
                          </div>
                        ) : null}
                        {!configLoading && !configError && visibleAgents.length === 0 ? (
                          <div className={s.agentEmpty}>
                            <Bot size={24} />
                            <span>{activeAgentFilter === 'favorite' ? '暂无收藏的智能体' : '暂无可用智能体'}</span>
                          </div>
                        ) : null}

                        {visibleAgents.length > 0 ? (
                          <div className={s.agentGrid}>
                            {visibleAgents.map((agent) => {
                              const Icon = AGENT_ICON_MAP[agent.icon] || Bot;
                              const isFavorite = favoriteIds.has(agent.id);
                              return (
                                <article
                                  className={`${s.agentCard} ${selectedAgentId === agent.id ? s.agentCardActive : ''}`}
                                  key={agent.id}
                                  onClick={() => selectAgent(agent)}
                                >
                                  <div className={s.agentCardTop}>
                                    <div className={s.agentIcon} style={{ background: agent.bg, color: agent.color }}>
                                      <Icon size={16} strokeWidth={2} />
                                    </div>
                                    <div className={s.agentCardMeta}>
                                      <div className={s.agentCategory}>{getAgentCategoryName(agent, config)}</div>
                                      <button
                                        aria-label={isFavorite ? `取消收藏${agent.name}` : `收藏${agent.name}`}
                                        className={`${s.favoriteButton} ${isFavorite ? s.favoriteButtonActive : ''}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          toggleFavorite(agent.id);
                                        }}
                                        title={isFavorite ? '取消收藏' : '收藏'}
                                        type="button"
                                      >
                                        <Star size={14} strokeWidth={2} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className={s.agentName}>{agent.name}</div>
                                  <div className={s.agentDesc}>{agent.desc}</div>
                                  <div className={s.agentTags}>
                                    {agent.tags.map((tag) => (
                                      <span className={s.agentTag} key={tag}>{tag}</span>
                                    ))}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {hasSelectedAgentWorkflow && selectedAgent ? (
                      <div className={s.agentWorkflowSurface}>
                        <div className={`${s.iframePanel} ${s.iframePanelFull}`}>
                          {iframeResult?.ok ? (
                            <>
                              {iframeLoading ? (
                                <div className={s.iframeStatus}>
                                  <Loader2 className={s.spinner} size={18} />
                                  <span>正在加载 Bisheng workflow 对话页...</span>
                                </div>
                              ) : null}
                              {iframeLoadTimedOut ? (
                                <div className={s.iframeWarning}>
                                  <AlertCircle size={18} />
                                  <span>页面加载时间较长，请检查 Bisheng 登录态或 iframe 嵌入策略。</span>
                                </div>
                              ) : null}
                              <iframe
                                className={`${s.workflowFrame} ${s.workflowFrameFull}`}
                                key={`${selectedAgent.id}-${agentLaunchKey}`}
                                src={iframeSrc}
                                title={`${selectedAgent.name} workflow 对话`}
                                allow="clipboard-read; clipboard-write"
                                onLoad={() => {
                                  if (iframeLoadTimerRef.current !== null) {
                                    window.clearTimeout(iframeLoadTimerRef.current);
                                    iframeLoadTimerRef.current = null;
                                  }
                                  setIframeLoading(false);
                                  setIframeLoadTimedOut(false);
                                }}
                              />
                            </>
                          ) : (
                            <div className={s.iframeError}>
                              <AlertCircle size={22} />
                              <span>{iframeResult?.message || '无法打开 Agent，请检查配置。'}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
          </PageShell>
        );
      }}
    </SmartQaWorkspace>
  );
}
