import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Globe2,
  Layers3,
  Loader2,
  MessageSquare,
  Mic,
  Paperclip,
  PenLine,
  Plus,
  ScrollText,
  Search,
  Send,
  User,
  X,
} from 'lucide-react';
import Header from '../components/Header';
import {
  ApiRequestError,
  fetchKnowledgeSpaces,
  fetchPortalContentConfig,
  fetchWorkstationConversations,
  fetchWorkstationMessages,
  streamChatCompletion,
  uploadChatAttachment,
  type ChatAttachment,
  type Citation,
  type KnowledgeSpace,
  type WorkstationChatMessage,
  type WorkstationConversation,
} from '../api/content';
import { fetchQaModelOptions, type PortalConfig, type QAConfig, type QAModelOption, type QATemplateCategoryConfig, type QATemplateConfig, type SpaceConfig } from '../api/adminConfig';
import { useAuth } from '../hooks/useAuth';
import { extractReferencedCitations, renderChatMarkdown } from '../utils/chatMessage';
import s from './QAPage.module.css';

interface Message {
  role: 'bot' | 'user';
  text: string;
  files?: ChatAttachment[];
  citations?: Citation[];
}

interface Session {
  id: string;
  conversationId?: string;
  title: string;
  group: '今天' | '昨天' | '7 天内' | '30 天内';
  messages: Message[];
  loaded: boolean;
  answerMode: AnswerMode;
  updatedAt?: string;
}

interface UploadingAttachment {
  id: string;
  name: string;
}

interface ConfiguredQaModelChoice {
  id: string;
  label: string;
  typeLabel: '通用模型' | '推理模型';
}

type AnswerMode = 'quick' | 'normal' | 'expert';

interface AnswerModeOption {
  id: AnswerMode;
  label: string;
  desc: string;
}

type KnowledgeSpaceGroupLabel = '个人知识库' | '团队知识库' | '部门知识库' | '公共知识库' | '其他知识库';

const ALL_TEMPLATE_CATEGORY_ID = '__all__';

const TEMPLATE_ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  BriefcaseBusiness,
  Layers3,
  FileText,
  ScrollText,
  PenLine,
  Search,
  MessageSquare,
  Globe,
  Bot,
};

const ANSWER_MODES: AnswerModeOption[] = [
  { id: 'quick', label: '快速模式', desc: '极速、简短生成，关联知识库。' },
  { id: 'normal', label: '普通模式', desc: '通用模型，可把问题讲清：分段落、列要点、篇幅适中。' },
  { id: 'expert', label: '专家模式', desc: '基于推理模型，抽丝剥茧解决复杂难题。' },
];
const KNOWLEDGE_SPACE_GROUPS: KnowledgeSpaceGroupLabel[] = ['个人知识库', '团队知识库', '部门知识库', '公共知识库', '其他知识库'];
const QA_ATTACHMENT_ACCEPT = '.pdf,.txt,.doc,.docx,.ppt,.pptx,.md,.html,.xls,.xlsx,.wps,.dps,.et,.png,.jpg,.jpeg,.bmp';
const QA_ATTACHMENT_EXTENSIONS = new Set(
  QA_ATTACHMENT_ACCEPT.split(',').map((item) => item.replace('.', '')),
);

function getWelcomeMessage(welcomeMessage?: string) {
  return welcomeMessage?.trim() || '你好，我是首钢股份知库智能助手，请问有什么可以帮您？';
}

function getQaModelNameLabel(model: QAModelOption): string {
  return model.name || model.display_name || model.id;
}

function buildConfiguredQaModelChoices(
  qa: Pick<QAConfig, 'selected_model' | 'general_model' | 'reasoning_model'>,
  models: QAModelOption[],
): ConfiguredQaModelChoice[] {
  const optionById = new Map(models.map((model) => [model.id, model]));
  const choices: ConfiguredQaModelChoice[] = [];
  const seen = new Set<string>();

  const appendChoice = (typeLabel: ConfiguredQaModelChoice['typeLabel'], rawModelId: string) => {
    const modelId = rawModelId.trim();
    if (!modelId || seen.has(modelId)) return;
    const option = optionById.get(modelId);
    choices.push({
      id: modelId,
      label: option ? getQaModelNameLabel(option) : modelId,
      typeLabel,
    });
    seen.add(modelId);
  };

  appendChoice('通用模型', qa.general_model || qa.selected_model || '');
  appendChoice('推理模型', qa.reasoning_model || '');
  return choices;
}

function resolveSessionGroup(dateText?: string): Session['group'] {
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

function createDraftSession(answerMode: AnswerMode = 'quick'): Session {
  return {
    id: `local_${Date.now()}`,
    title: '新会话',
    group: '今天',
    messages: [],
    loaded: true,
    answerMode,
  };
}

function mapConversationToSession(conversation: WorkstationConversation): Session {
  return {
    id: conversation.conversationId,
    conversationId: conversation.conversationId,
    title: conversation.title || '新会话',
    group: resolveSessionGroup(conversation.updateAt || conversation.createAt),
    messages: [],
    loaded: false,
    answerMode: 'quick',
    updatedAt: conversation.updateAt || conversation.createAt,
  };
}

function mapChatMessage(message: WorkstationChatMessage): Message {
  return {
    role: message.role,
    text: message.text,
    files: message.files,
    citations: message.citations,
  };
}

function mapConfigSpaceToKnowledgeSpace(space: SpaceConfig): KnowledgeSpace {
  return {
    id: space.id,
    name: space.name,
    description: '',
    authType: 'public',
    userRole: '',
    spaceKind: 'normal',
    spaceLevel: space.space_level ?? '',
    departmentName: '',
    fileCount: space.file_count ?? 0,
    memberCount: 0,
    isPinned: false,
    updatedAt: '',
    sources: ['portal-config'],
  };
}

function getAnonymousPublicKnowledgeSpaces(config: PortalConfig): KnowledgeSpace[] {
  return config.spaces
    .filter((space) => space.enabled && space.space_level === 'public')
    .map(mapConfigSpaceToKnowledgeSpace);
}

function getAttachmentName(file: ChatAttachment): string {
  return file.filename || file.file_id || file.temp_file_id || '附件';
}

function getAttachmentKey(file: ChatAttachment): string {
  return file.filepath || file.file_id || file.temp_file_id || getAttachmentName(file);
}

function isSupportedAttachment(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return QA_ATTACHMENT_EXTENSIONS.has(ext);
}

function AttachmentChips({
  files,
  uploadingFiles = [],
  onRemove,
  className = '',
}: {
  files: ChatAttachment[];
  uploadingFiles?: UploadingAttachment[];
  onRemove?: (file: ChatAttachment) => void;
  className?: string;
}) {
  if (!files.length && !uploadingFiles.length) return null;
  return (
    <div className={`${s.attachmentList} ${className}`}>
      {uploadingFiles.map((file) => (
        <span key={file.id} className={`${s.attachmentChip} ${s.attachmentUploading}`}>
          <Loader2 size={14} className={s.spinner} />
          <span className={s.attachmentName}>{file.name}</span>
          <span>上传中</span>
        </span>
      ))}
      {files.map((file) => (
        <span key={getAttachmentKey(file)} className={s.attachmentChip}>
          <Paperclip size={14} />
          <span className={s.attachmentName}>{getAttachmentName(file)}</span>
          {onRemove ? (
            <button
              type="button"
              className={s.attachmentRemove}
              onClick={() => onRemove(file)}
              aria-label={`移除附件 ${getAttachmentName(file)}`}
            >
              <X size={13} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function getKnowledgeSpaceGroup(space: KnowledgeSpace): KnowledgeSpaceGroupLabel {
  if (space.spaceLevel === 'personal') return '个人知识库';
  if (space.spaceLevel === 'team') return '团队知识库';
  if (space.spaceLevel === 'department') return '部门知识库';
  if (space.spaceLevel === 'public') return '公共知识库';
  if (space.sources.includes('mine') || space.spaceKind === 'personal') return '个人知识库';
  if (space.sources.includes('joined') || space.sources.includes('managed') || space.spaceKind === 'team') return '团队知识库';
  if (space.sources.includes('department') || space.spaceKind === 'department') return '部门知识库';
  return '其他知识库';
}

function getKnowledgeSpaceMeta(space: KnowledgeSpace): string {
  const parts = [
    space.departmentName,
    space.fileCount ? `${space.fileCount} 个文档` : '',
    space.userRole,
  ].filter(Boolean);
  return parts.join(' · ');
}

function groupKnowledgeSpaces(spaces: KnowledgeSpace[]): Record<KnowledgeSpaceGroupLabel, KnowledgeSpace[]> {
  return spaces.reduce(
    (grouped, space) => {
      grouped[getKnowledgeSpaceGroup(space)].push(space);
      return grouped;
    },
    {
      个人知识库: [],
      团队知识库: [],
      部门知识库: [],
      公共知识库: [],
      其他知识库: [],
    } as Record<KnowledgeSpaceGroupLabel, KnowledgeSpace[]>,
  );
}

function getKnowledgePickerLabel(
  spaces: KnowledgeSpace[],
  selectedIds: number[],
  loading: boolean,
): string {
  if (loading) return '知识库加载中';
  if (!selectedIds.length) return '选择知识库';
  if (spaces.length > 0 && selectedIds.length === spaces.length) return '全部知识库';
  if (selectedIds.length === 1) {
    return spaces.find((space) => space.id === selectedIds[0])?.name || '已选 1 个知识库';
  }
  return `已选 ${selectedIds.length} 个知识库`;
}

function CitationList({ items }: { items: Citation[] }) {
  return (
    <ol className={s.citations}>
      {items.map((c, idx) => {
        const sp = c.sourcePayload ?? {};
        const href = sp.knowledgeId && sp.documentId
          ? `/space/${sp.knowledgeId}/file/${sp.documentId}`
          : undefined;
        const label = sp.documentName || c.key;
        return (
          <li key={c.key} className={s.citationItem}>
            <span className={s.citationIndex}>{idx + 1}</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={s.citationLink}
                title={label}
              >
                {label}
              </a>
            ) : (
              <span className={s.citationLink}>{label}</span>
            )}
            {sp.knowledgeName ? <span className={s.citationHint}>· {sp.knowledgeName}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function getTemplateIcon(icon: string) {
  return TEMPLATE_ICON_MAP[icon] || FileText;
}

function findWritingTemplateById(templates: QATemplateConfig[], templateId: string): QATemplateConfig | undefined {
  return templates.find((template) => template.id === templateId);
}

const INITIAL_DRAFT_SESSION = createDraftSession();

export default function QAPage() {
  const { user } = useAuth();
  const [assistantGreeting, setAssistantGreeting] = useState(getWelcomeMessage());
  const [sessions, setSessions] = useState<Session[]>(() => [INITIAL_DRAFT_SESSION]);
  const [activeId, setActiveId] = useState(() => INITIAL_DRAFT_SESSION.id);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [availableSpaces, setAvailableSpaces] = useState<KnowledgeSpace[]>([]);
  const [selectedKnowledgeSpaceIds, setSelectedKnowledgeSpaceIds] = useState<number[]>([]);
  const [loadingKnowledgeSpaces, setLoadingKnowledgeSpaces] = useState(true);
  const [templateCategories, setTemplateCategories] = useState<QATemplateCategoryConfig[]>([]);
  const [writingTemplates, setWritingTemplates] = useState<QATemplateConfig[]>([]);
  const [templateCategory, setTemplateCategory] = useState(ALL_TEMPLATE_CATEGORY_ID);
  const [pendingTemplateId, setPendingTemplateId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('templateId')?.trim() || '';
  });
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [modelChoices, setModelChoices] = useState<ConfiguredQaModelChoice[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [composerTip, setComposerTip] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingAttachment[]>([]);
  const msgEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((ss) => ss.id === activeId) ?? sessions[0];
  const enabledCategories = templateCategories.filter((category) => category.enabled);
  const enabledCategoryIds = new Set(enabledCategories.map((category) => category.id));
  const visibleTemplates = writingTemplates.filter((item) => (
    item.enabled
      && enabledCategoryIds.has(item.category_id)
      && (templateCategory === ALL_TEMPLATE_CATEGORY_ID || item.category_id === templateCategory)
  ));
  const hasConversation = Boolean(activeSession.conversationId)
    || activeSession.messages.some((msg) => msg.role === 'user')
    || streaming;
  const activeSessionLoading = loadingSessionId === activeSession.id;
  const answerMode = activeSession.answerMode;
  const answerModeOption = ANSWER_MODES.find((mode) => mode.id === answerMode) ?? ANSWER_MODES[0];
  const generalModelChoice = modelChoices.find((choice) => choice.typeLabel === '通用模型');
  const reasoningModelChoice = modelChoices.find((choice) => choice.typeLabel === '推理模型');
  const selectedModelChoice = answerMode === 'expert' ? reasoningModelChoice : generalModelChoice;
  const selectedModel = selectedModelChoice?.id ?? '';
  const selectedKnowledgeSpaceIdSet = new Set(selectedKnowledgeSpaceIds);
  const groupedKnowledgeSpaces = groupKnowledgeSpaces(availableSpaces);
  const hasChatAttachments = attachedFiles.length > 0 || uploadingFiles.length > 0;
  const knowledgePickerLabel = getKnowledgePickerLabel(
    availableSpaces,
    selectedKnowledgeSpaceIds,
    loadingKnowledgeSpaces,
  );

  const applyWritingTemplate = (template: QATemplateConfig) => {
    setTemplateCategory(template.category_id);
    setInput(template.prompt);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!pendingTemplateId || !templatesLoaded) return;
    const template = findWritingTemplateById(writingTemplates, pendingTemplateId);
    if (template) applyWritingTemplate(template);

    const params = new URLSearchParams(window.location.search);
    params.delete('templateId');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
    setPendingTemplateId('');
  }, [pendingTemplateId, templatesLoaded, writingTemplates]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession.messages, streaming]);

  useEffect(() => {
    if (!modelMenuOpen && !knowledgePickerOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;

      if (modelMenuOpen && modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false);
      }
      if (knowledgePickerOpen && knowledgePickerRef.current && !knowledgePickerRef.current.contains(target)) {
        setKnowledgePickerOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [modelMenuOpen, knowledgePickerOpen]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await fetchPortalContentConfig();
        if (!active) return;
        const modelOptions = await fetchQaModelOptions().then((data) => data.models).catch(() => []);
        if (!active) return;
        const qaModelConfig = {
          selected_model: config.qa.selected_model,
          general_model: config.qa.general_model,
          reasoning_model: config.qa.reasoning_model,
        };
        const choices = buildConfiguredQaModelChoices(qaModelConfig, modelOptions);
        setAssistantGreeting(getWelcomeMessage(config.qa.welcome_message));
        setTemplateCategories(config.qa.template_categories);
        setWritingTemplates(config.qa.templates);
        setModelChoices(choices);
      } catch {
        // 配置失败时保留页面本地默认值，保证问答页可用。
      } finally {
        if (active) setTemplatesLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingKnowledgeSpaces(true);
    if (!user) {
      void fetchPortalContentConfig()
        .then((config) => {
          if (!active) return;
          const spaces = getAnonymousPublicKnowledgeSpaces(config);
          setAvailableSpaces(spaces);
          setSelectedKnowledgeSpaceIds([]);
          if (!spaces.length) {
            setComposerTip('当前暂无可用公共知识库。');
          }
        })
        .catch(() => {
          if (active) setComposerTip('公共知识库列表加载失败，请稍后重试。');
        })
        .finally(() => {
          if (active) setLoadingKnowledgeSpaces(false);
        });
      return () => {
        active = false;
      };
    }

    void fetchKnowledgeSpaces()
      .then(({ data: spaces }) => {
        if (!active) return;
        setAvailableSpaces(spaces);
        setSelectedKnowledgeSpaceIds([]);
        if (!spaces.length) {
          setComposerTip('当前账号暂无可用知识库。');
        }
      })
      .catch(() => {
        if (active) setComposerTip('知识库列表加载失败，请确认登录状态后重试。');
      })
      .finally(() => {
        if (active) setLoadingKnowledgeSpaces(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    setLoadingSessions(true);
    if (!user) {
      const draft = createDraftSession();
      setSessions([draft]);
      setActiveId(draft.id);
      setLoadingSessions(false);
      return () => {
        active = false;
      };
    }

    void fetchWorkstationConversations({ page: 1, limit: 50 })
      .then((items) => {
        if (!active) return;
        const remoteSessions = items.map(mapConversationToSession);
        setSessions((prev) => {
          const localSessions = prev.filter((item) => !item.conversationId);
          const merged = [...localSessions, ...remoteSessions];
          return merged.length ? merged : [createDraftSession()];
        });
      })
      .catch(() => {
        if (active) setComposerTip('会话列表加载失败，请确认登录状态后重试。');
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!composerTip) return;
    const timer = window.setTimeout(() => setComposerTip(''), 2200);
    return () => window.clearTimeout(timer);
  }, [composerTip]);

  const updateLastBotMessage = (sessionId: string, mutator: (last: Message) => Message) => {
    setSessions((prev) =>
      prev.map((ss) => {
        if (ss.id !== sessionId) return ss;
        const msgs = [...ss.messages];
        const lastIdx = msgs.length - 1;
        if (lastIdx < 0 || msgs[lastIdx].role !== 'bot') return ss;
        msgs[lastIdx] = mutator(msgs[lastIdx]);
        return { ...ss, messages: msgs };
      }),
    );
  };

  const loadSessionMessages = (session: Session) => {
    if (!session.conversationId || session.loaded || loadingSessionId === session.id) return;
    setLoadingSessionId(session.id);
    void fetchWorkstationMessages(session.conversationId)
      .then((messages) => {
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id
              ? { ...item, messages: messages.map(mapChatMessage), loaded: true }
              : item,
          ),
        );
      })
      .catch(() => {
        setComposerTip('会话历史加载失败，请稍后重试。');
      })
      .finally(() => {
        setLoadingSessionId((current) => (current === session.id ? null : current));
      });
  };

  const selectSession = (session: Session) => {
    setActiveId(session.id);
    loadSessionMessages(session);
  };

  const sendMessage = () => {
    const text = input.trim();
    const messageFiles = attachedFiles;
    if ((!text && !messageFiles.length) || streaming || uploadingFiles.length) return;
    if (answerMode === 'expert' && !reasoningModelChoice) {
      setComposerTip('请先在后台配置推理模型。');
      return;
    }
    if (!selectedModel) {
      setComposerTip('请先在后台配置问答模型。');
      return;
    }
    const finalText = text || '请分析附件内容。';
    const targetSessionId = activeId;
    setInput('');
    setAttachedFiles([]);
    setStreaming(true);
    setModelMenuOpen(false);
    setModeMenuOpen(false);
    setKnowledgePickerOpen(false);

    setSessions((prev) =>
      prev.map((ss) =>
        ss.id === targetSessionId
          ? {
              ...ss,
              title: ss.title === '新会话' ? finalText.slice(0, 18) : ss.title,
              messages: [...ss.messages, { role: 'user', text: finalText, files: messageFiles }, { role: 'bot', text: '' }],
            }
          : ss,
      ),
    );

    void streamChatCompletion({
      scene: 'qa',
      text: finalText,
      knowledgeSpaceIds: selectedKnowledgeSpaceIds,
      files: attachedFiles,
      conversationId: activeSession.conversationId,
      model: selectedModel,
      answerMode,
      onConversationId(conversationId) {
        setSessions((prev) =>
          prev.map((ss) =>
            ss.id === targetSessionId
              ? { ...ss, conversationId, id: ss.id, loaded: true }
              : ss,
          ),
        );
      },
      onUpdate(currentText) {
        updateLastBotMessage(targetSessionId, (last) => ({ ...last, text: currentText }));
      },
      onCitations(list) {
        updateLastBotMessage(targetSessionId, (last) => ({ ...last, citations: list }));
      },
    }).catch((error: unknown) => {
      const text = error instanceof ApiRequestError
        ? error.message || '问答请求失败，请稍后重试。'
        : '问答请求失败，请稍后重试。';
      updateLastBotMessage(targetSessionId, () => ({
        role: 'bot',
        text,
        citations: undefined,
      }));
    }).finally(() => {
      setStreaming(false);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sendMessage();
  };

  const newSession = () => {
    const ns = createDraftSession();
    const id = ns.id;
    setSessions((prev) => [ns, ...prev]);
    setActiveId(id);
    setInput('');
    setAttachedFiles([]);
    setUploadingFiles([]);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const chooseTemplate = (template: QATemplateConfig) => {
    applyWritingTemplate(template);
  };

  const chooseAnswerMode = (mode: AnswerMode) => {
    if (mode === 'expert' && !reasoningModelChoice) {
      setComposerTip('请先在后台配置推理模型。');
      return;
    }
    setSessions((prev) =>
      prev.map((ss) => (ss.id === activeId ? { ...ss, answerMode: mode } : ss)),
    );
    setModeMenuOpen(false);
  };

  const toggleKnowledgeSpace = (spaceId: number) => {
    setSelectedKnowledgeSpaceIds((prev) =>
      prev.includes(spaceId)
        ? prev.filter((id) => id !== spaceId)
        : [...prev, spaceId],
    );
  };

  const selectAllKnowledgeSpaces = () => {
    setSelectedKnowledgeSpaceIds(availableSpaces.map((space) => space.id));
  };

  const clearKnowledgeSpaces = () => {
    setSelectedKnowledgeSpaceIds([]);
  };

  const handleAttachmentSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const supportedFiles = files.filter(isSupportedAttachment);
    if (supportedFiles.length !== files.length) {
      setComposerTip('仅支持常见文档、表格、演示文稿、图片和文本附件。');
    }
    if (!supportedFiles.length) return;

    supportedFiles.forEach((file, index) => {
      const uploadId = `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`;
      setUploadingFiles((prev) => [...prev, { id: uploadId, name: file.name }]);
      void uploadChatAttachment(file)
        .then((attachment) => {
          setAttachedFiles((prev) => [
            ...prev,
            {
              ...attachment,
              filename: attachment.filename || file.name,
              type: attachment.type || file.type,
            },
          ]);
        })
        .catch(() => {
          setComposerTip(`${file.name} 上传失败，请稍后重试。`);
        })
        .finally(() => {
          setUploadingFiles((prev) => prev.filter((item) => item.id !== uploadId));
        });
    });
  };

  const removeAttachedFile = (target: ChatAttachment) => {
    const targetKey = getAttachmentKey(target);
    setAttachedFiles((prev) => prev.filter((file) => getAttachmentKey(file) !== targetKey));
  };

  const showUnavailableTip = (label: string) => {
    setComposerTip(`${label}入口已保留，当前仅作为前端演示状态。`);
  };

  return (
    <>
      <Header />
      <main className={s.layout}>
        <aside className={s.sidebar} aria-label="对话列表">
          <div className={s.sideTop}>
            <div className={s.sideTitle}>对话列表</div>
          </div>
          <button className={s.newSessionBtn} onClick={newSession}>
            <Plus size={15} />
            开启新对话
          </button>
          {loadingSessions ? <div className={s.groupLabel}>会话加载中...</div> : null}
          <div className={s.sessionList}>
            {(['今天', '昨天', '7 天内', '30 天内'] as Session['group'][]).map((group) => {
              const groupSessions = sessions.filter((session) => session.group === group);
              if (groupSessions.length === 0) return null;
              return (
                <section key={group} className={s.sessionGroup}>
                  <div className={s.groupLabel}>{group}</div>
                  {groupSessions.map((ss) => (
                    <button
                      key={ss.id}
                      type="button"
                      className={`${s.sessionItem} ${ss.id === activeId ? s.sessionItemActive : ''}`}
                      onClick={() => selectSession(ss)}
                      title={ss.title}
                    >
                      {ss.title}
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </aside>

        <section className={s.workspace}>
          <div className={s.workspaceHeader}>
            <div>
              <h1>知识问答</h1>
              <p>基于企业知识范围的演示对话</p>
            </div>
            <div className={s.modelWrap} ref={modelMenuRef}>
              <button
                className={s.modelSelect}
                type="button"
                disabled={!modelChoices.length}
                onClick={() => setModelMenuOpen((value) => !value)}
              >
                {selectedModelChoice ? selectedModelChoice.label : '未配置模型'}
                <ChevronDown size={15} />
              </button>
              {modelMenuOpen && modelChoices.length ? (
                <div className={s.modelMenu}>
                  {modelChoices.map((choice) => (
                    <button
                      key={`${choice.typeLabel}-${choice.id}`}
                      type="button"
                      className={`${s.modelOption} ${choice.id === selectedModel ? s.modelOptionActive : ''}`}
                      onClick={() => {
                        if (choice.typeLabel === '推理模型') {
                          chooseAnswerMode('expert');
                        } else if (answerMode === 'expert') {
                          chooseAnswerMode('normal');
                        }
                        setModelMenuOpen(false);
                      }}
                    >
                      <strong>{choice.label}</strong>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className={s.contentArea}>
            {!hasConversation ? (
              <div className={s.templatePanel}>
                <div className={s.templateTabs} role="tablist" aria-label="写作模板分类">
                  {[{ id: ALL_TEMPLATE_CATEGORY_ID, name: '全部' }, ...enabledCategories].map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      role="tab"
                      aria-selected={templateCategory === category.id}
                      className={`${s.templateTab} ${templateCategory === category.id ? s.templateTabActive : ''}`}
                      onClick={() => setTemplateCategory(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <div className={s.templateGrid}>
                  {visibleTemplates.map((template) => {
                    const TemplateIcon = getTemplateIcon(template.icon);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={s.templateCard}
                        onClick={() => chooseTemplate(template)}
                      >
                        <span className={s.templateIcon} style={{ background: template.color }}>
                          <TemplateIcon size={17} />
                        </span>
                        <span className={s.templateText}>
                          <strong>{template.name}</strong>
                          <span>{template.desc}</span>
                        </span>
                        <span className={s.templateLines} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={s.messages}>
                {activeSessionLoading ? (
                  <div className={s.thinking}>
                    <Loader2 size={16} className={s.spinner} />
                    <span>正在加载会话...</span>
                  </div>
                ) : null}
                {!activeSessionLoading && activeSession.messages.length === 0 ? (
                  <div className={s.emptyConversation}>
                    <Bot size={18} />
                    <span>当前会话暂无历史消息，请输入问题继续对话。</span>
                  </div>
                ) : null}
                {activeSession.messages.map((msg, i) => {
                  const isLastMessage = i === activeSession.messages.length - 1;
                  const isThinking = streaming && msg.role === 'bot' && isLastMessage && !msg.text.trim();
                  const referenced = msg.role === 'bot' && msg.citations
                    ? extractReferencedCitations(msg.text, msg.citations)
                    : [];
                  return (
                    <div
                      key={`${msg.role}-${i}`}
                      className={`${s.msgRow} ${msg.role === 'user' ? s.msgRowUser : ''}`}
                    >
                      <div className={`${s.avatar} ${msg.role === 'bot' ? s.avatarBot : s.avatarUser}`}>
                        {msg.role === 'bot' ? <Bot size={16} /> : <User size={16} />}
                      </div>
                      <div className={s.msgColumn}>
                        {msg.role === 'bot' ? (
                          isThinking ? (
                            <div className={`${s.msgBubble} ${s.msgBot} ${s.thinking}`}>
                              <Loader2 size={16} className={s.spinner} />
                              <span>思考中...</span>
                            </div>
                          ) : (
                            <div
                              className={`${s.msgBubble} ${s.msgBot} ${s.botContent}`}
                              dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.text, msg.citations ?? []) }}
                            />
                          )
                        ) : (
                          <div className={`${s.msgBubble} ${s.msgUser}`}>{msg.text}</div>
                        )}
                        {msg.files?.length ? (
                          <AttachmentChips files={msg.files} className={s.messageAttachments} />
                        ) : null}
                        {msg.role === 'bot' && referenced.length > 0 ? (
                          <CitationList items={referenced} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div ref={msgEndRef} />
              </div>
            )}
          </div>

          <div className={s.composerShell}>
            <div className={s.composerSlogan}>
              <PenLine size={18} />
              <span>先厘清要写什么，动笔时帮你少走弯路</span>
            </div>
            <textarea
              ref={inputRef}
              className={s.chatInput}
              aria-label="输入你的问题，Enter 发送，Shift+Enter 换行"
              placeholder={assistantGreeting}
              value={input}
              rows={3}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {hasChatAttachments ? (
              <AttachmentChips
                files={attachedFiles}
                uploadingFiles={uploadingFiles}
                onRemove={removeAttachedFile}
                className={s.composerAttachments}
              />
            ) : null}
            <div className={s.composerTools}>
              <div className={s.toolLeft}>
                <div className={s.modePicker}>
                  <button
                    type="button"
                    className={s.pillButton}
                    onClick={() => setModeMenuOpen((value) => !value)}
                  >
                    <BrainCircuit size={15} />
                    {answerModeOption.label}
                    <ChevronDown size={14} />
                  </button>
                  {modeMenuOpen ? (
                    <div className={s.modePanel}>
                      <div className={s.modePanelTitle}>选择一种问答模式</div>
                      <div className={s.modeGrid}>
                        {ANSWER_MODES.map((mode) => {
                          const disabled = mode.id === 'expert' && !reasoningModelChoice;
                          return (
                            <button
                              key={mode.id}
                              type="button"
                              className={`${s.modeCard} ${answerMode === mode.id ? s.modeCardActive : ''}`}
                              disabled={disabled}
                              onClick={() => chooseAnswerMode(mode.id)}
                              title={disabled ? '请先在后台配置推理模型' : mode.desc}
                            >
                              <strong>{mode.label}</strong>
                              <span>{disabled ? '请先在后台配置推理模型。' : mode.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className={s.knowledgePicker} ref={knowledgePickerRef}>
                  <button
                    type="button"
                    className={s.pillButton}
                    disabled={loadingKnowledgeSpaces || !availableSpaces.length}
                    onClick={() => setKnowledgePickerOpen((value) => !value)}
                  >
                    <Search size={15} />
                    {knowledgePickerLabel}
                    <ChevronDown size={14} />
                  </button>
                  {knowledgePickerOpen ? (
                    <div className={s.knowledgePanel}>
                      <div className={s.knowledgePanelHead}>
                        <span>可多选知识库</span>
                        <span>{selectedKnowledgeSpaceIds.length}/{availableSpaces.length}</span>
                      </div>
                      <div className={s.knowledgePanelActions}>
                        <button type="button" onClick={selectAllKnowledgeSpaces}>全选</button>
                        <button type="button" onClick={clearKnowledgeSpaces}>清空</button>
                      </div>
                      <div className={s.knowledgeList}>
                        {KNOWLEDGE_SPACE_GROUPS.map((group) => {
                          const groupSpaces = groupedKnowledgeSpaces[group];
                          if (!groupSpaces.length) return null;
                          return (
                            <section key={group} className={s.knowledgeGroup}>
                              <div className={s.knowledgeGroupTitle}>{group}</div>
                              {groupSpaces.map((space) => {
                                const checked = selectedKnowledgeSpaceIdSet.has(space.id);
                                return (
                                  <button
                                    key={space.id}
                                    type="button"
                                    className={`${s.knowledgeItem} ${checked ? s.knowledgeItemActive : ''}`}
                                    onClick={() => toggleKnowledgeSpace(space.id)}
                                  >
                                    <span className={`${s.knowledgeCheckbox} ${checked ? s.knowledgeCheckboxActive : ''}`}>
                                      {checked ? <Check size={13} /> : null}
                                    </span>
                                    <span className={s.knowledgeItemText}>
                                      <strong>{space.name}</strong>
                                      <span>{getKnowledgeSpaceMeta(space) || '知识空间'}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`${s.toggleButton} ${webSearchEnabled ? s.toggleButtonActive : ''}`}
                  onClick={() => setWebSearchEnabled((value) => !value)}
                >
                  <Globe2 size={15} />
                  联网搜索
                  {webSearchEnabled ? <Check size={14} /> : null}
                </button>
              </div>
              <div className={s.toolRight}>
                {composerTip ? <span className={s.composerTip}>{composerTip}</span> : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={QA_ATTACHMENT_ACCEPT}
                  className={s.hiddenFileInput}
                  onChange={handleAttachmentSelect}
                />
                <button
                  type="button"
                  className={s.iconButton}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="上传附件"
                  disabled={streaming}
                >
                  <Paperclip size={17} />
                </button>
                <button type="button" className={s.iconButton} onClick={() => showUnavailableTip('语音输入')} aria-label="语音输入">
                  <Mic size={17} />
                </button>
                <button
                  type="button"
                  className={s.sendBtn}
                  onClick={sendMessage}
                  disabled={streaming || uploadingFiles.length > 0 || (!input.trim() && !attachedFiles.length)}
                >
                  {streaming ? <Loader2 size={18} className={s.spinner} /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
