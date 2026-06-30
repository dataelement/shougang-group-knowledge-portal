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
import appsSearchIcon from '../assets/apps-search.png';
import appsNewIcon from '../assets/apps-new.svg';
import appsHistoryIcon from '../assets/apps-history.svg';
import agentIconZhidu from '../assets/agent-icon-zhidu.png';
import agentIconFalv from '../assets/agent-icon-falv.png';
import agentIconChailv from '../assets/agent-icon-chailv.png';
import agentIconZongjie from '../assets/agent-icon-zongjie.png';
import agentIconTuijin from '../assets/agent-icon-tuijin.png';
import agentIconJianbao from '../assets/agent-icon-jianbao.png';
import agentIconBangong from '../assets/agent-icon-bangong.png';
import agentIconChachong from '../assets/agent-icon-chachong.png';
import agentIconYinhuan from '../assets/agent-icon-yinhuan.png';
import agentIconHuozai from '../assets/agent-icon-huozai.png';
import agentIconHetong from '../assets/agent-icon-hetong.png';
import type { AgentItemConfig, PortalConfig } from '../api/adminConfig';
import {
  favoriteAgentWorkflow,
  fetchAgentFavoriteWorkflowIds,
  fetchAgentWorkflowConversations,
  fetchAgentWorkflows,
  removeAgentWorkflowFavorite,
  type AgentWorkflowConversation,
} from '../api/content';
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
  | { kind: 'qa'; id: string; title: string; group: Session['group']; updatedAt?: string; session: Session }
  | {
    kind: 'agent';
    id: string;
    agentId: string;
    workflowId: string;
    conversationId: string;
    title: string;
    group: Session['group'];
    updatedAt?: string;
  };

const MAIN_TABS: { id: AppsMainTab; label: string }[] = [
  { id: 'qa', label: '智能协作' },
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

const AGENT_IMAGE_MAP: Record<string, string> = {
  制度专家: agentIconZhidu,
  安全法律法规: agentIconFalv,
  差旅问答助手: agentIconChailv,
  总结报告: agentIconZongjie,
  工作推进方案: agentIconTuijin,
  行业洞察简报: agentIconJianbao,
  办公材料撰写: agentIconBangong,
  项目查重: agentIconChachong,
  AI识别隐患: agentIconYinhuan,
  安全重大火灾隐患: agentIconHuozai,
  合同审核: agentIconHetong,
};

function getCategoryStyle(name: string): { color: string; background: string } {
  if (/写作/.test(name)) return { color: '#00B42A', background: 'rgba(0, 180, 42, 0.08)' };
  if (/识别/.test(name)) return { color: '#FF7D00', background: 'rgba(255, 125, 0, 0.08)' };
  if (/审核/.test(name)) return { color: '#8848CB', background: 'rgba(136, 72, 203, 0.08)' };
  return { color: '#3662E3', background: 'rgba(54, 98, 227, 0.08)' };
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

function resolveRecordGroup(dateText?: string): Session['group'] {
  if (!dateText) return '今天';
  const time = Date.parse(dateText);
  if (Number.isNaN(time)) return '今天';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(time);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diffDays <= 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 7) return '7 天内';
  return '30 天内';
}

function getRecordTime(record: SmartAppsRecord): number {
  const time = Date.parse(record.updatedAt || '');
  return Number.isNaN(time) ? 0 : time;
}

function appendWorkflowChatId(url: string, chatId: string): string {
  const safeChatId = chatId.trim();
  if (!safeChatId) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('chat_id', safeChatId);
  return parsed.toString();
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
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleRecords = useMemo(() => {
    if (!normalizedSearchQuery) return records;
    return records.filter((record) => record.title.toLowerCase().includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, records]);

  return (
    <aside className={s.sidebar} aria-label="智能应用会话列表">
      <div className={s.searchBox}>
        <img src={appsSearchIcon} className={s.searchBoxIcon} alt="" aria-hidden="true" />
        <input
          aria-label="搜索对话内容"
          className={s.searchBoxInput}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索对话内容"
        />
      </div>

      <button className={s.navRow} type="button" onClick={onNewQa}>
        <img src={appsNewIcon} className={s.navRowIcon} alt="" aria-hidden="true" />
        <span className={s.navRowText}>新对话</span>
      </button>
      <div className={s.navRow}>
        <img src={appsHistoryIcon} className={s.navRowIcon} alt="" aria-hidden="true" />
        <span className={s.navRowText}>历史对话</span>
      </div>

      <div className={s.historyList}>
        {loading ? <div className={s.historyEmpty}>会话加载中...</div> : null}
        {visibleRecords.map((record) => (
          <button
            className={`${s.convItem} ${activeRecordId === record.id ? s.convItemActive : ''}`}
            key={`${record.kind}-${record.id}`}
            onClick={() => onSelectRecord(record)}
            title={record.title}
            type="button"
          >
            {record.title}
          </button>
        ))}
        {!loading && normalizedSearchQuery && !visibleRecords.length ? (
          <div className={s.historyEmpty}>未找到匹配会话</div>
        ) : null}
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
  const [agentWorkflows, setAgentWorkflows] = useState<AgentItemConfig[]>([]);
  const [loadingAgentWorkflows, setLoadingAgentWorkflows] = useState(false);
  const [agentWorkflowsError, setAgentWorkflowsError] = useState('');
  const [favoriteWorkflowIds, setFavoriteWorkflowIds] = useState<Set<string>>(() => new Set());
  const [updatingFavoriteWorkflowIds, setUpdatingFavoriteWorkflowIds] = useState<Set<string>>(() => new Set());
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedAgentConversationId, setSelectedAgentConversationId] = useState('');
  const [agentWorkflowConversations, setAgentWorkflowConversations] = useState<AgentWorkflowConversation[]>([]);
  const [loadingAgentWorkflowConversations, setLoadingAgentWorkflowConversations] = useState(false);
  const [activeAgentRecordId, setActiveAgentRecordId] = useState('');
  const [agentLaunchKey, setAgentLaunchKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeLoadTimedOut, setIframeLoadTimedOut] = useState(false);
  const iframeLoadTimerRef = useRef<number | null>(null);
  const agentConfig = config?.agent_config ?? { categories: [], agents: [] };
  const agentConfigSignature = useMemo(
    () => agentConfig.agents
      .map((agent) => `${agent.id}:${agent.workflow_id}:${agent.enabled ? '1' : '0'}`)
      .join('|'),
    [agentConfig.agents],
  );

  useEffect(() => {
    setActiveTab(resolveAppsTab(location.search));
  }, [location.search]);

  useEffect(() => {
    if (configLoading) {
      setAgentWorkflows([]);
      setLoadingAgentWorkflows(true);
      setAgentWorkflowsError('');
      return undefined;
    }
    if (configError) {
      setAgentWorkflows([]);
      setLoadingAgentWorkflows(false);
      setAgentWorkflowsError(configError);
      return undefined;
    }
    let active = true;
    setAgentWorkflows([]);
    setLoadingAgentWorkflows(true);
    setAgentWorkflowsError('');
    void fetchAgentWorkflows()
      .then((items) => {
        if (active) setAgentWorkflows(items);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAgentWorkflows([]);
        setAgentWorkflowsError(error instanceof Error ? error.message : '智能体列表加载失败');
      })
      .finally(() => {
        if (active) setLoadingAgentWorkflows(false);
      });
    return () => {
      active = false;
    };
  }, [configLoading, configError, agentConfigSignature]);

  const enabledCategories = useMemo(
    () => agentConfig.categories.filter((category) => category.enabled),
    [agentConfig.categories],
  );
  const enabledAgents = useMemo(
    () => agentWorkflows.filter((agent) => agent.enabled),
    [agentWorkflows],
  );
  const selectedAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === selectedAgentId) ?? null,
    [enabledAgents, selectedAgentId],
  );
  const agentFilters = useMemo<AgentFilterOption[]>(
    () => [
      { id: 'all', label: '全部' },
      { id: 'favorite', label: '我的收藏' },
      ...enabledCategories.map((category) => ({
        id: toCategoryFilterId(category.id),
        label: category.name,
      })),
    ],
    [enabledCategories],
  );
  const visibleAgents = useMemo(() => {
    if (activeAgentFilter === 'all') return enabledAgents;
    if (activeAgentFilter === 'favorite') return enabledAgents.filter((agent) => favoriteWorkflowIds.has(agent.workflow_id));
    const categoryId = activeAgentFilter.replace(/^category:/, '');
    return enabledAgents.filter((agent) => agent.category_id === categoryId);
  }, [activeAgentFilter, enabledAgents, enabledCategories, favoriteWorkflowIds]);
  const bishengBaseUrl = getBishengBaseUrl(config);
  const iframeResult = useMemo(
    () => (selectedAgent
      ? resolvePortalWorkflowChatEmbedUrl(bishengBaseUrl, selectedAgent.workflow_id)
      : null),
    [bishengBaseUrl, selectedAgent],
  );
  const iframeSrc = iframeResult?.ok
    ? appendWorkflowChatId(
      applyEmbedOriginOverride(iframeResult.url, import.meta.env.VITE_BISHENG_EMBED_ORIGIN),
      selectedAgentConversationId,
    )
    : '';

  useEffect(() => {
    if (configLoading || configError || loadingAgentWorkflows || agentWorkflowsError) return undefined;
    if (!enabledAgents.length) {
      setAgentWorkflowConversations([]);
      setLoadingAgentWorkflowConversations(false);
      return undefined;
    }
    let active = true;
    setLoadingAgentWorkflowConversations(true);
    void fetchAgentWorkflowConversations({ page: 1, limit: 50 })
      .then((items) => {
        if (active) setAgentWorkflowConversations(items);
      })
      .catch(() => {
        if (active) setAgentWorkflowConversations([]);
      })
      .finally(() => {
        if (active) setLoadingAgentWorkflowConversations(false);
      });
    return () => {
      active = false;
    };
  }, [configLoading, configError, loadingAgentWorkflows, agentWorkflowsError, enabledAgents]);

  useEffect(() => {
    let active = true;
    void fetchAgentFavoriteWorkflowIds()
      .then((workflowIds) => {
        if (active) setFavoriteWorkflowIds(new Set(workflowIds));
      })
      .catch(() => {
        if (active) setFavoriteWorkflowIds(new Set());
      });
    return () => {
      active = false;
    };
  }, []);

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

  async function toggleFavorite(agent: AgentItemConfig) {
    const workflowId = agent.workflow_id.trim();
    if (!workflowId || updatingFavoriteWorkflowIds.has(workflowId)) return;
    const shouldFavorite = !favoriteWorkflowIds.has(workflowId);
    setUpdatingFavoriteWorkflowIds((current) => new Set(current).add(workflowId));
    try {
      if (shouldFavorite) {
        await favoriteAgentWorkflow(workflowId);
      } else {
        await removeAgentWorkflowFavorite(workflowId);
      }
      setFavoriteWorkflowIds((current) => {
        const next = new Set(current);
        if (shouldFavorite) {
          next.add(workflowId);
        } else {
          next.delete(workflowId);
        }
        return next;
      });
    } finally {
      setUpdatingFavoriteWorkflowIds((current) => {
        const next = new Set(current);
        next.delete(workflowId);
        return next;
      });
    }
  }

  function selectAgent(agent: AgentItemConfig) {
    setSelectedAgentId(agent.id);
    setSelectedAgentConversationId('');
    setAgentLaunchKey((current) => current + 1);
    const recordId = `agent_new_${agent.id}`;
    setActiveAgentRecordId(recordId);
  }

  return (
    <SmartQaWorkspace onBeforeSend={() => switchTab('qa')}>
      {({ qaContent, hasConversation: hasQaConversation, renderComposer, qaSidebarState }) => {
        const qaRecords: SmartAppsRecord[] = qaSidebarState.sessions.map((session) => ({
          kind: 'qa',
          id: session.id,
          title: session.title,
          group: session.group,
          updatedAt: session.updatedAt,
          session,
        }));
        const agentRecords: SmartAppsRecord[] = agentWorkflowConversations.map((conversation) => ({
          kind: 'agent',
          id: `agent_${conversation.conversationId}`,
          agentId: conversation.agentId,
          workflowId: conversation.workflowId,
          conversationId: conversation.conversationId,
          title: conversation.title,
          group: resolveRecordGroup(conversation.updateAt || conversation.createAt),
          updatedAt: conversation.updateAt || conversation.createAt,
        }));
        const records = [...qaRecords, ...agentRecords].sort((left, right) => getRecordTime(right) - getRecordTime(left));
        const activeRecordId = activeTab === 'agent' ? activeAgentRecordId : qaSidebarState.activeId;
        const hasSelectedAgentWorkflow = activeTab === 'agent' && Boolean(selectedAgent);
        const showTopComposer = !hasSelectedAgentWorkflow && (activeTab === 'agent' || !hasQaConversation);
        const showMainTabs = !hasSelectedAgentWorkflow && !hasQaConversation;
        const showAgentList = !hasSelectedAgentWorkflow;
        const agentListLoading = configLoading || loadingAgentWorkflows;
        const agentListError = configError || agentWorkflowsError;

        return (
          <PageShell hideFooter>
            <div className={s.page}>
              <div className={s.shell}>
                <SmartAppsSidebar
                  records={records}
                  activeRecordId={activeRecordId}
                  loading={qaSidebarState.loadingSessions || loadingAgentWorkflowConversations}
                  onNewQa={() => {
                    qaSidebarState.newSession();
                    setSelectedAgentId('');
                    setSelectedAgentConversationId('');
                    setActiveAgentRecordId('');
                    switchTab('qa');
                  }}
                  onSelectRecord={(record) => {
                    if (record.kind === 'qa') {
                      qaSidebarState.selectSession(record.session);
                      switchTab('qa');
                      return;
                    }
                    setSelectedAgentId(record.agentId);
                    setSelectedAgentConversationId(record.conversationId);
                    setActiveAgentRecordId(record.id);
                    setAgentLaunchKey((current) => current + 1);
                    switchTab('agent');
                  }}
                />

                <section className={s.mainPanel}>

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
                              className={`${s.tab} ${activeAgentFilter === filter.id ? s.tabActive : ''}`}
                              key={filter.id}
                              onClick={() => setActiveAgentFilter(filter.id)}
                              role="tab"
                              type="button"
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>

                        {agentListLoading ? (
                          <div className={s.agentEmpty}>
                            <Loader2 className={s.spinner} size={24} />
                            <span>正在加载智能体...</span>
                          </div>
                        ) : null}
                        {agentListError ? (
                          <div className={s.agentEmpty}>
                            <AlertCircle size={24} />
                            <span>{agentListError}</span>
                          </div>
                        ) : null}
                        {!agentListLoading && !agentListError && visibleAgents.length === 0 ? (
                          <div className={s.agentEmpty}>
                            <Bot size={24} />
                            <span>{activeAgentFilter === 'favorite' ? '暂无我的收藏智能体' : '暂无可用智能体'}</span>
                          </div>
                        ) : null}

                        {visibleAgents.length > 0 ? (
                          <div className={s.agentGrid}>
                            {visibleAgents.map((agent) => {
                              const Icon = AGENT_ICON_MAP[agent.icon] || Bot;
                              const agentImage = AGENT_IMAGE_MAP[agent.name.trim()];
                              const isFavorite = favoriteWorkflowIds.has(agent.workflow_id);
                              const isFavoriteUpdating = updatingFavoriteWorkflowIds.has(agent.workflow_id);
                              return (
                                <article
                                  className={`${s.agentCard} ${selectedAgentId === agent.id ? s.agentCardActive : ''}`}
                                  key={agent.id}
                                  onClick={() => selectAgent(agent)}
                                >
                                  <div className={s.agentCardTop}>
                                    {agentImage ? (
                                      <img className={s.agentIconImg} src={agentImage} alt="" aria-hidden="true" />
                                    ) : (
                                      <div className={s.agentIcon} style={{ background: agent.bg, color: agent.color }}>
                                        <Icon size={24} strokeWidth={2} />
                                      </div>
                                    )}
                                    <div className={s.agentCardHead}>
                                      <div className={s.agentName}>{agent.name}</div>
                                      <span className={s.agentCategory} style={getCategoryStyle(getAgentCategoryName(agent, config))}>
                                        {getAgentCategoryName(agent, config)}
                                      </span>
                                    </div>
                                    <button
                                      aria-label={isFavorite ? `取消收藏${agent.name}` : `收藏${agent.name}`}
                                      className={`${s.favoriteButton} ${isFavorite ? s.favoriteButtonActive : ''}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void toggleFavorite(agent);
                                      }}
                                      disabled={isFavoriteUpdating}
                                      title={isFavorite ? '取消收藏' : '收藏'}
                                      type="button"
                                    >
                                      <Star size={16} strokeWidth={2} />
                                    </button>
                                  </div>
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
