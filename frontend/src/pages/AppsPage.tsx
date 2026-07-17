import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardList,
  Edit3,
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
  renameWorkstationConversation,
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
  { id: 'qa', label: '智能写作' },
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
  // 未保存的草稿(新会话)没有更新时间,视为最新,始终排在分组最上面
  if (record.kind === 'qa' && !record.session.conversationId) {
    return Number.POSITIVE_INFINITY;
  }
  const time = Date.parse(record.updatedAt || '');
  return Number.isNaN(time) ? 0 : time;
}

const HISTORY_GROUP_ORDER: Session['group'][] = ['今天', '昨天', '7 天内', '30 天内'];

function recordOverrideKey(record: SmartAppsRecord): string {
  return `${record.kind}:${record.id}`;
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
  onRenameRecord,
}: {
  records: SmartAppsRecord[];
  activeRecordId: string;
  loading: boolean;
  onNewQa: () => void;
  onSelectRecord: (record: SmartAppsRecord) => void;
  onRenameRecord: (record: SmartAppsRecord, name: string) => Promise<void>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState('');

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleRecords = useMemo(() => {
    if (!normalizedSearchQuery) return records;
    return records.filter((record) => record.title.toLowerCase().includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, records]);

  const startRename = (record: SmartAppsRecord) => {
    setRenamingKey(recordOverrideKey(record));
    setRenameDraft(record.title);
    setRenameError('');
  };

  const cancelRename = () => {
    setRenamingKey(null);
    setRenameDraft('');
    setRenameError('');
  };

  const commitRename = async (record: SmartAppsRecord) => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === record.title) {
      cancelRename();
      return;
    }
    setRenameSaving(true);
    setRenameError('');
    try {
      await onRenameRecord(record, trimmed);
      setRenamingKey(null);
      setRenameDraft('');
    } catch {
      setRenameError('重命名失败，请重试');
    } finally {
      setRenameSaving(false);
    }
  };

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
        {/* 只有「还没有任何会话可展示」时才显示加载提示;已经有列表时不因后台二次加载把它藏掉(否则会闪) */}
        {loading && !visibleRecords.length ? <div className={s.historyEmpty}>会话加载中...</div> : null}
        {HISTORY_GROUP_ORDER.map((group) => {
          const groupRecords = visibleRecords.filter((record) => record.group === group);
          if (groupRecords.length === 0) return null;
          return (
            <section key={group} className={s.historyGroup}>
              <div className={s.historyGroupLabel}>{group}</div>
              {groupRecords.map((record) => {
                const key = recordOverrideKey(record);
                const isActive = activeRecordId === record.id;
                const isRenaming = renamingKey === key;
                return (
                  <div
                    key={key}
                    className={`${s.convItemRow} ${isActive ? s.convItemRowActive : ''}`}
                  >
                    {isRenaming ? (
                      <>
                        <input
                          autoFocus
                          disabled={renameSaving}
                          className={s.convItemInput}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename(record)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void commitRename(record);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                        />
                        {renameError ? <span className={s.convItemRenameError}>{renameError}</span> : null}
                      </>
                    ) : (
                      <>
                        <button
                          className={s.convItem}
                          onClick={() => onSelectRecord(record)}
                          title={record.title}
                          type="button"
                        >
                          {record.title}
                        </button>
                        <button
                          type="button"
                          className={s.convItemEditBtn}
                          onClick={(event) => {
                            event.stopPropagation();
                            startRename(record);
                          }}
                          aria-label="重命名会话"
                          title="重命名会话"
                        >
                          <Edit3 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
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
  const [selectedUrlApplicationId, setSelectedUrlApplicationId] = useState('');
  const [selectedAgentConversationId, setSelectedAgentConversationId] = useState('');
  const [agentWorkflowConversations, setAgentWorkflowConversations] = useState<AgentWorkflowConversation[]>([]);
  // 初始即为 true:该加载要等 config / agent 列表就绪后才启动,若从 false 起步,
  // 会话列表会先渲染出来、随后被这里翻回 true 又整个藏起来(闪一下)。保持单调 true→false。
  const [loadingAgentWorkflowConversations, setLoadingAgentWorkflowConversations] = useState(true);
  const [activeAgentRecordId, setActiveAgentRecordId] = useState('');
  const [agentLaunchKey, setAgentLaunchKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeLoadTimedOut, setIframeLoadTimedOut] = useState(false);
  const iframeLoadTimerRef = useRef<number | null>(null);
  const [urlIframeLoading, setUrlIframeLoading] = useState(false);
  const [urlIframeLoadFailed, setUrlIframeLoadFailed] = useState(false);
  const urlIframeLoadTimerRef = useRef<number | null>(null);
  const agentConfig = config?.agent_config ?? { categories: [], applications: [] };
  const agentConfigSignature = useMemo(
    () => agentConfig.applications
      .map((agent) => `${agent.id}:${agent.type}:${agent.workflow_id}:${agent.url}:${agent.enabled ? '1' : '0'}`)
      .join('|'),
    [agentConfig.applications],
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
  const enabledCategoryIds = useMemo(
    () => new Set(enabledCategories.map((category) => category.id)),
    [enabledCategories],
  );
  const enabledAgents = useMemo(
    () => agentWorkflows.filter((agent) => agent.enabled && enabledCategoryIds.has(agent.category_id)),
    [agentWorkflows, enabledCategoryIds],
  );
  const selectedAgent = useMemo(
    () => enabledAgents.find((agent) => agent.type === 'workflow' && agent.id === selectedAgentId) ?? null,
    [enabledAgents, selectedAgentId],
  );
  const selectedUrlApplication = useMemo(
    () => enabledAgents.find((agent) => agent.type === 'url' && agent.id === selectedUrlApplicationId) ?? null,
    [enabledAgents, selectedUrlApplicationId],
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
    if (activeAgentFilter === 'favorite') return enabledAgents.filter((agent) => (
      agent.type === 'workflow' && favoriteWorkflowIds.has(agent.workflow_id)
    ));
    const categoryId = activeAgentFilter.replace(/^category:/, '');
    return enabledAgents.filter((agent) => agent.category_id === categoryId);
  }, [activeAgentFilter, enabledAgents, favoriteWorkflowIds]);
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
    // 还在等前置数据:保持加载态,等它们就绪后本 effect 会再跑
    if (configLoading || loadingAgentWorkflows) return undefined;
    // 前置数据出错:别把加载态永远挂着,否则会话列表一直不显示
    if (configError || agentWorkflowsError) {
      setLoadingAgentWorkflowConversations(false);
      return undefined;
    }
    const enabledWorkflowAgents = enabledAgents.filter((agent) => agent.type === 'workflow');
    if (!enabledWorkflowAgents.length) {
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
    if (agent.type !== 'workflow') return;
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
    if (agent.type === 'url') {
      setSelectedUrlApplicationId(agent.id);
      setSelectedAgentId('');
      setSelectedAgentConversationId('');
      setActiveAgentRecordId('');
      return;
    }
    setSelectedUrlApplicationId('');
    setSelectedAgentId(agent.id);
    setSelectedAgentConversationId('');
    setAgentLaunchKey((current) => current + 1);
    const recordId = `agent_new_${agent.id}`;
    setActiveAgentRecordId(recordId);
  }

  useEffect(() => {
    if (urlIframeLoadTimerRef.current !== null) {
      window.clearTimeout(urlIframeLoadTimerRef.current);
      urlIframeLoadTimerRef.current = null;
    }
    if (!selectedUrlApplication) {
      setUrlIframeLoading(false);
      setUrlIframeLoadFailed(false);
      return undefined;
    }
    setUrlIframeLoading(true);
    setUrlIframeLoadFailed(false);
    urlIframeLoadTimerRef.current = window.setTimeout(() => {
      setUrlIframeLoading(false);
      setUrlIframeLoadFailed(true);
      urlIframeLoadTimerRef.current = null;
    }, 15000);
    return () => {
      if (urlIframeLoadTimerRef.current !== null) {
        window.clearTimeout(urlIframeLoadTimerRef.current);
        urlIframeLoadTimerRef.current = null;
      }
    };
  }, [selectedUrlApplication]);

  if (selectedUrlApplication) {
    return (
      <PageShell hideFooter mainClassName={s.urlApplicationMain}>
        <div className={s.urlApplicationWorkspace}>
          <div className={s.urlApplicationToolbar}>
            <button type="button" className={s.urlApplicationBack} onClick={() => setSelectedUrlApplicationId('')}>
              <ArrowLeft size={16} /> 返回智能应用
            </button>
            <span className={s.urlApplicationTitle}>{selectedUrlApplication.name}</span>
          </div>
          <div className={s.urlApplicationFrameWrap}>
            {urlIframeLoading ? (
              <div className={s.iframeStatus}><Loader2 className={s.spinner} size={18} /><span>正在加载 URL 应用...</span></div>
            ) : null}
            {urlIframeLoadFailed ? (
              <div className={s.urlApplicationError}>
                <AlertCircle size={24} />
                <strong>该应用无法嵌入</strong>
                <span>目标页面加载失败、超时，或禁止被 iframe 嵌入。</span>
                <button type="button" className={s.urlApplicationBack} onClick={() => setSelectedUrlApplicationId('')}>返回智能应用</button>
              </div>
            ) : null}
            <iframe
              className={s.urlApplicationFrame}
              src={selectedUrlApplication.url}
              title={selectedUrlApplication.name}
              sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
              onLoad={() => {
                if (urlIframeLoadTimerRef.current !== null) {
                  window.clearTimeout(urlIframeLoadTimerRef.current);
                  urlIframeLoadTimerRef.current = null;
                }
                setUrlIframeLoading(false);
              }}
              onError={() => {
                setUrlIframeLoading(false);
                setUrlIframeLoadFailed(true);
              }}
            />
          </div>
        </div>
      </PageShell>
    );
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
        const handleRenameRecord = async (record: SmartAppsRecord, name: string) => {
          if (record.kind === 'qa') {
            await qaSidebarState.renameSession(record.session, name);
            return;
          }
          await renameWorkstationConversation(record.conversationId, name);
          setAgentWorkflowConversations((prev) =>
            prev.map((item) =>
              item.conversationId === record.conversationId ? { ...item, title: name } : item,
            ),
          );
        };
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
                  onRenameRecord={handleRenameRecord}
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
                            <span
                              className={`${s.mainTabIcon} ${tab.id === 'qa' ? s.mainTabIconQa : s.mainTabIconAgent}`}
                              aria-hidden="true"
                            />
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
                              const agentImage = agent.icon_image_url || AGENT_IMAGE_MAP[agent.name.trim()];
                              const isWorkflowAgent = agent.type === 'workflow';
                              const isFavorite = isWorkflowAgent && favoriteWorkflowIds.has(agent.workflow_id);
                              const isFavoriteUpdating = isWorkflowAgent && updatingFavoriteWorkflowIds.has(agent.workflow_id);
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
                                    {isWorkflowAgent ? <button
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
                                    </button> : null}
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
