import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  FileText,
  Globe2,
  Layers3,
  Loader2,
  Mic,
  Paperclip,
  PenLine,
  Plus,
  ScrollText,
  Search,
  Send,
  Sparkles,
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
import { fetchQaModelOptions, type QAConfig, type QAModelOption } from '../api/adminConfig';
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

type TemplateCategory = '全部' | '工作汇报' | '方案策划' | '研究报告' | '政务公文';
type AnswerMode = 'quick' | 'normal' | 'expert';

interface AnswerModeOption {
  id: AnswerMode;
  label: string;
  desc: string;
}

interface WritingTemplate {
  id: string;
  title: string;
  desc: string;
  category: Exclude<TemplateCategory, '全部'>;
  prompt: string;
  tone: 'blue' | 'green' | 'orange' | 'purple' | 'rose';
}

type KnowledgeSpaceGroupLabel = '个人知识库' | '团队知识库' | '部门知识库' | '公共知识库' | '其他知识库';

const TEMPLATE_CATEGORIES: TemplateCategory[] = ['全部', '工作汇报', '方案策划', '研究报告', '政务公文'];

const WRITING_TEMPLATES: WritingTemplate[] = [
  {
    id: 'thought-report',
    title: '思想汇报',
    desc: '深度反思梳理，提升理论联系实际能力',
    category: '政务公文',
    prompt: '请帮我起草一份思想汇报，要求结构规范、表达稳重，并结合实际工作认识。',
    tone: 'green',
  },
  {
    id: 'experience-note',
    title: '心得体会',
    desc: '提炼归纳感悟，形成规范心得文稿',
    category: '工作汇报',
    prompt: '请帮我写一份心得体会，突出学习收获、实践启发和后续改进方向。',
    tone: 'purple',
  },
  {
    id: 'work-plan',
    title: '工作计划',
    desc: '明确目标方向，生成执行路线图',
    category: '方案策划',
    prompt: '请帮我制定一份工作计划，包含目标、重点任务、时间节点、责任分工和风险保障。',
    tone: 'orange',
  },
  {
    id: 'debriefing-report',
    title: '述职报告',
    desc: '回顾履职成效，展现专业岗位贡献',
    category: '工作汇报',
    prompt: '请帮我写一份述职报告，围绕岗位职责、履职成效、能力提升和不足改进展开。',
    tone: 'rose',
  },
  {
    id: 'office-writing',
    title: '办公材料撰写',
    desc: '多场景办公材料智能生成',
    category: '政务公文',
    prompt: '请帮我撰写一份办公材料，要求条理清晰、语言规范，适合企业内部流转。',
    tone: 'blue',
  },
  {
    id: 'project-impl-plan',
    title: '项目实施方案',
    desc: '明确路径、责任与节点，保障项目落地',
    category: '方案策划',
    prompt: '请帮我生成项目实施方案，包含背景目标、实施路径、组织分工、里程碑和保障措施。',
    tone: 'green',
  },
  {
    id: 'work-push-plan',
    title: '工作推进方案',
    desc: '压实责任分工，推动任务高效完成',
    category: '方案策划',
    prompt: '请帮我写一份工作推进方案，重点说明任务拆解、推进机制、责任分工和验收标准。',
    tone: 'purple',
  },
  {
    id: 'special-action-plan',
    title: '专项行动方案',
    desc: '集中资源攻坚，形成阶段性突破',
    category: '方案策划',
    prompt: '请帮我起草专项行动方案，要求目标明确、措施具体、节奏清晰、风险可控。',
    tone: 'orange',
  },
  {
    id: 'ops-plan',
    title: '运营策划方案',
    desc: '提升运营效率，驱动业务增长',
    category: '方案策划',
    prompt: '请帮我写一份运营策划方案，包含用户洞察、运营目标、活动机制和数据复盘。',
    tone: 'rose',
  },
  {
    id: 'topic-research-report',
    title: '课题研究报告',
    desc: '结构化呈现成果，提升学术规范',
    category: '研究报告',
    prompt: '请帮我生成课题研究报告大纲，并围绕研究背景、方法、发现和建议展开正文。',
    tone: 'blue',
  },
  {
    id: 'tech-whitepaper',
    title: '技术白皮书',
    desc: '解析技术逻辑，建立行业专业标准',
    category: '研究报告',
    prompt: '请帮我写一份技术白皮书，说明技术背景、架构设计、关键能力、应用价值和落地路径。',
    tone: 'green',
  },
  {
    id: 'product-prd',
    title: '产品需求说明书',
    desc: '逻辑清晰无歧义，直接对接研发',
    category: '研究报告',
    prompt: '请帮我写一份产品需求说明书，包含背景、用户场景、功能需求、非功能需求和验收标准。',
    tone: 'purple',
  },
  {
    id: 'talent-dev-report',
    title: '人才培养发展报告',
    desc: '体系化培育员工，提升组织核心能力',
    category: '研究报告',
    prompt: '请帮我写一份人才培养发展报告，分析现状、问题、培养体系和阶段性推进建议。',
    tone: 'orange',
  },
  {
    id: 'party-speech',
    title: '党建专题讲话',
    desc: '强化政治引领，输出高站位讲话稿',
    category: '政务公文',
    prompt: '请帮我起草一份党建专题讲话稿，要求主题鲜明、结构稳健、语言庄重。',
    tone: 'rose',
  },
  {
    id: 'gov-summary',
    title: '政务工作总结',
    desc: '数据支撑、成效凝练，生成规范总结',
    category: '政务公文',
    prompt: '请帮我写一份政务工作总结，突出主要做法、工作成效、存在问题和下一步安排。',
    tone: 'blue',
  },
  {
    id: 'hero-semantic-search',
    title: '语义搜索',
    desc: '面向知识库的语义检索与要点汇总',
    category: '研究报告',
    prompt: '请基于知识库进行语义搜索，汇总与该主题相关的核心资料、关键观点和引用来源。',
    tone: 'green',
  },
  {
    id: 'hero-open-qa',
    title: '智能问答',
    desc: '结合知识库的开放式问答',
    category: '研究报告',
    prompt: '请结合知识库回答我的问题，并给出依据、引用来源和可执行建议。',
    tone: 'purple',
  },
  {
    id: 'hero-doc-translate',
    title: '文档翻译',
    desc: '多语言文档翻译辅助',
    category: '研究报告',
    prompt: '请将下列文本或段落翻译为[目标语言，如：英文]，保持术语与公文风格一致，专有名词首次出现可附原文括号备注。\n\n【原文】\n[粘贴待译内容]',
    tone: 'orange',
  },
];

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

function getTemplateIcon(category: WritingTemplate['category']) {
  if (category === '工作汇报') return BriefcaseBusiness;
  if (category === '方案策划') return Layers3;
  if (category === '研究报告') return FileText;
  return ScrollText;
}

function findWritingTemplateById(templateId: string): WritingTemplate | undefined {
  return WRITING_TEMPLATES.find((template) => template.id === templateId);
}

const INITIAL_DRAFT_SESSION = createDraftSession();

export default function QAPage() {
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
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('全部');
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

  const activeSession = sessions.find((ss) => ss.id === activeId) ?? sessions[0];
  const visibleTemplates = templateCategory === '全部'
    ? WRITING_TEMPLATES
    : WRITING_TEMPLATES.filter((item) => item.category === templateCategory);
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

  const applyWritingTemplate = (template: WritingTemplate) => {
    setTemplateCategory(template.category);
    setInput(template.prompt);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get('templateId')?.trim();
    if (!templateId) return;
    const template = findWritingTemplateById(templateId);
    if (!template) return;

    applyWritingTemplate(template);
    params.delete('templateId');
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession.messages, streaming]);

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
        setModelChoices(choices);
      } catch {
        // 配置失败时保留页面本地默认值，保证问答页可用。
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
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
  }, []);

  useEffect(() => {
    let active = true;
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
  }, []);

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
    if (!selectedKnowledgeSpaceIds.length && !messageFiles.length) {
      setComposerTip('请至少选择一个知识库。');
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
      const text = error instanceof ApiRequestError && error.status === 401
        ? '请先登录后再使用智能问答。'
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

  const chooseTemplate = (template: WritingTemplate) => {
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
            <div className={s.modelWrap}>
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
                <div className={s.templateHeading}>
                  <div className={s.templateTitle}>
                    <Sparkles size={18} />
                    AI 帮我写
                  </div>
                </div>
                <div className={s.templateTabs} role="tablist" aria-label="写作模板分类">
                  {TEMPLATE_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      role="tab"
                      aria-selected={templateCategory === category}
                      className={`${s.templateTab} ${templateCategory === category ? s.templateTabActive : ''}`}
                      onClick={() => setTemplateCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <div className={s.templateGrid}>
                  {visibleTemplates.map((template) => {
                    const TemplateIcon = getTemplateIcon(template.category);
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={s.templateCard}
                        onClick={() => chooseTemplate(template)}
                      >
                        <span className={`${s.templateIcon} ${s[`templateIcon_${template.tone}`]}`}>
                          <TemplateIcon size={17} />
                        </span>
                        <span className={s.templateText}>
                          <strong>{template.title}</strong>
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
                <div className={s.knowledgePicker}>
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
