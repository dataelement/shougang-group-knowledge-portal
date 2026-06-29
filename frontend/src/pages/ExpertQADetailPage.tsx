import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowUp,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  ThumbsUp,
  User,
  UserCheck,
  X,
} from 'lucide-react';
import CommonFileUploadModal, {
  type CommonUploadedFile,
} from '../components/CommonFileUploadModal';
import PageShell from '../components/PageShell';
import {
  acceptAnswer,
  createAnswer,
  createComment,
  // deleteExpertQuestion,
  fetchAnswersPaged,
  fetchCommentsPaged,
  fetchExpertAnswerDetail,
  fetchExpertInfoDetail,
  fetchExpertQuestionDetail,
  fetchSimilarExpertQuestions,
  markAnswerUseful,
  // updateExpertQuestion,
  uploadQaImage,
  type ApiAnswer,
  type ApiComment,
  type ApiQuestion,
  type CreateAnswerPayload,
  type ExpertProfileResponse,
  type PagedAnswerResponse,
  type SimilarQuestionItem,
} from '../api/expertQa';
import { useAuth } from '../hooks/useAuth';
import {
  type AnswerEntry,
  type ExpertProfile,
  type QuestionDetail,
  type QuestionStatus,
} from '../types/expertQa';
import s from './ExpertQADetailPage.module.css';

const ANSWERS_PAGE_SIZE = 10;
const COMMENTS_PAGE_SIZE = 20;
const QUESTION_FOLLOWUP_ANSWER_ID = 0;
const QUESTION_FOLLOWUP_THREAD_ID = String(QUESTION_FOLLOWUP_ANSWER_ID);
const MAX_ANSWER_IMAGE_COUNT = 3;
const MAX_ANSWER_DOCUMENT_COUNT = 3;
const EMPTY_TEXT = '未知';
const ATTACHMENT_FALLBACK_PREFIX = '附件';
const DOCUMENT_FALLBACK_PREFIX = '知识库文档';
const ASSET_LIST_SEPARATOR = ';';
const ASSET_PART_SEPARATOR = '|';
const LINK_LIST_SPLIT_PATTERN = /[;；,\n\r]+/;
const INVITED_NAME_SPLIT_PATTERN = /[;；,，\n\r]+/;
const TECH_TOKEN_PATTERN = /[A-Za-z0-9]+(?:mm|MM)?|[\u4e00-\u9fa5]{2,}/g;
const IGNORED_TAGS = new Set([
  '可能原因',
  '如何处理',
  '为什么',
  '问题',
  '出现',
  '进行',
  '根据',
  '当前',
]);
const NUMERIC_ATTACHMENT_PATTERN = /^\d+$/;
const SOLVED_QUESTION_STATUS = 1;
const DEFAULT_AVATAR_COLORS = [
  '#0EA5E9',
  '#10B981',
  '#6366F1',
  '#F97316',
  '#EF4444',
  '#14B8A6',
  '#8B5CF6',
];
const BOUNTY_FIELD_KEYS = [
  'bounty',
  'reward_points',
  'rewardPoints',
  'points',
  'score',
  'bounty_points',
];
const FOLLOWER_FIELD_KEYS = [
  'followers',
  'follower_count',
  'follow_count',
  'watch_count',
];
const VOTED_STORAGE_PREFIX = 'sg_expert_qa_voted';

interface DetailAttachment {
  label: string;
  href: string;
}

type KnowledgeAttachment = CommonUploadedFile;

type DetailAnswerEntry = AnswerEntry & {
  createdAtMs: number;
};

type DetailQuestion = QuestionDetail & {
  imageUrls: string[];
  attachments: DetailAttachment[];
  relatedDocs: DetailAttachment[];
  bounty: number;
  ownerUserId: number;
  createdBy: string | null;
};

type SortMode = 'top' | 'latest';

interface CommentState {
  items: ApiComment[];
  total: number;
  page: number;
  loading: boolean;
  hasMore: boolean;
  draft: string;
  submitting: boolean;
  error: string | null;
}

interface CommentThreadProps {
  answerId: number;
  questionId: number;
  initialCount: number;
  onCommentCreated?: () => void;
  onTotalChange?: (total: number) => void;
}

interface AnswerCardProps {
  answer: DetailAnswerEntry;
  questionId: number;
  showComments: boolean;
  onToggleComments: (event?: MouseEvent<HTMLButtonElement>) => void;
  onUseful: () => void;
  onAccept: () => void;
  onCommentTotalChange?: (total: number) => void;
  usefulDisabled?: boolean;
}

function mergeUniqueComments(current: ApiComment[], incoming: ApiComment[]): ApiComment[] {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  incoming.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });
  return merged;
}

function buildVoteKey(userKey: string, targetType: string, targetId: string | number): string {
  return `${VOTED_STORAGE_PREFIX}:${userKey}:${targetType}:${targetId}`;
}

function hasStoredVote(userKey: string, targetType: string, targetId: string | number): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(buildVoteKey(userKey, targetType, targetId)) === '1';
}

function storeVote(userKey: string, targetType: string, targetId: string | number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(buildVoteKey(userKey, targetType, targetId), '1');
}

function removeStoredVote(userKey: string, targetType: string, targetId: string | number) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(buildVoteKey(userKey, targetType, targetId));
}

function getAvatarInitial(name?: string | null): string {
  const value = name?.trim();
  return value ? value.charAt(0).toUpperCase() : '?';
}

function getAvatarColor(name?: string | null): string {
  const value = name?.trim();
  if (!value) return DEFAULT_AVATAR_COLORS[0];
  const index =
    [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
    DEFAULT_AVATAR_COLORS.length;
  return DEFAULT_AVATAR_COLORS[index];
}

function formatDateOnly(value?: string | null): string {
  if (!value) return EMPTY_TEXT;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_TEXT;
  return date.toLocaleDateString('zh-CN');
}

function formatDateTime(value?: string | null): string {
  if (!value) return EMPTY_TEXT;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_TEXT;
  return date.toLocaleString('zh-CN');
}

function formatQuestionStatus(
  status: number,
  answerCount: number,
  adoptedAnswerId?: number | null,
): QuestionStatus {
  if (status === SOLVED_QUESTION_STATUS || adoptedAnswerId) return 'solved';
  if (answerCount > 0) return 'unsolved';
  return 'pending';
}

function splitStoredList(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(LINK_LIST_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitInvitedNames(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(INVITED_NAME_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}


function serializeKnowledgeDocumentIds(
  items: KnowledgeAttachment[],
): string | undefined {
  const validItems = items.filter(
    (item) => item.id.trim(),
  );

  return validItems.length
    ? validItems
        .map(
          (item) =>
            `${item.id.trim()}`,
        )
        .join(ASSET_LIST_SEPARATOR)
    : undefined;
}


function serializeKnowledgeDocumentNames(items: KnowledgeAttachment[]): string | null {
  const documentNames = items
    .slice(0, MAX_ANSWER_DOCUMENT_COUNT)
    .map((item) => item.title.trim())
    .filter(Boolean);

  return documentNames.length ? documentNames.join(ASSET_LIST_SEPARATOR) : null;
}

function parseUnknownLinks(value: string | null): string[] {
  // const rawValue = stringifyAssetValue(value);
  return splitStoredList(value);
}

function parseUnknownAttachments(value?: string | null, 
  relatedDocs?: string | null): DetailAttachment[] {
  // const rawValue = stringifyAssetValue(value);
  return parseAttachments(value, relatedDocs);
}



async function mapQuestionDetail(
  question: ApiQuestion,
  relatedQuestions: SimilarQuestionItem[] = [],
): Promise<DetailQuestion> {
  const relatedDocs = parseAttachments(question.attachments,question.related_docs);
  const bodyParagraphs = splitParagraphs(question.description);
  const invitedNames = splitInvitedNames(
    question.experts_names || question.invited_experts,
  );
  const results = await Promise.allSettled(
    invitedNames.map(async (name, index) => {
      // 1. 去掉多余的 await
      const expert = buildInvitedExpert(name, index, question.created_at);
      
      let status: 'answered' | 'pending' = 'pending';
      try {
        const res = await fetchExpertAnswerDetail(question.id, name);
        status = res ? ('answered' as const) : ('pending' as const);
      } catch (err) {
        console.error(`查询专家 ${name} 状态失败:`, err);
      }

      return { expert, status };
    })
  );

  const invitedExperts = results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map((r) => r.value);


  return {
    id: String(question.id),
    title: question.title,
    excerpt: bodyParagraphs[0] ?? '',
    domain: question.business_domain || EMPTY_TEXT,
    domainKey: 'all',
    status: formatQuestionStatus(
      question.status,
      question.answer_count,
      question.adopted_answer_id,
    ),
    invitedSummary: formatInvitedSummary(invitedNames),
    votes: question.vote_count ?? 0,
    answers: question.answer_count ?? 0,
    acceptedAnswers: question.adopted_answer_id ? 1 : 0,
    views: question.view_count ?? 0,
    asker: {
      initial: getAvatarInitial(question.created_by || `U${question.user_id}`),
      name: question.created_by || `用户${question.user_id}`,
    },
    askedAt: formatDateOnly(question.created_at),
    tags: extractQuestionTags(question.title, question.business_domain),
    bodyParagraphs,
    checkedItems: [],
    followups: '',
    relatedDoc: relatedDocs[0]
      ? { label: relatedDocs[0].label }
      : undefined,
    followers: readNumberField(question, FOLLOWER_FIELD_KEYS) ?? 0,
    invitedExperts,
    fullAnswers: [],
    related: relatedQuestions
      .filter((item) => item.id !== question.id)
      .map((item) => ({
        id: String(item.id),
        title: item.title,
        meta: `${item.answer_count ?? 0} 个回答 · ${item.view_count ?? 0} 次浏览`,
      })),
    imageUrls: splitStoredList(question.image_url),
    attachments: parseAttachments(question.attachments, question.related_docs),
    relatedDocs,
    bounty: readNumberField(question, BOUNTY_FIELD_KEYS) ?? 0,
    ownerUserId: question.user_id,
    createdBy: question.created_by,
  };
}

function buildAnswerEntry(
  answer: ApiAnswer,
  fallbackExpert?: ExpertProfileResponse | null,
): DetailAnswerEntry {
  const relatedDocs = parseUnknownAttachments(answer.attachments,answer.related_docs);
  const createdAtMs = toTimestamp(answer.created_at);

  return {
    id: String(answer.id),
    author: buildExpertProfile(answer, fallbackExpert),
    adopted: answer.adopted ?? false,
    isExpert: Boolean(
      answer.expert_id ||
        answer.expert ||
        answer.isExpert ||
        (fallbackExpert && answer.expert_id === fallbackExpert.id),
    ),
    votes: answer.vote_count ?? 0,
    ts: formatDateTime(answer.created_at),
    createdAtMs,
    bodyHtml: formatAnswerBody(answer.content),
    helpful: answer.vote_count ?? 0,
    commentCount: answer.comment_count ?? 0,
    relatedDoc: relatedDocs[0],
    imageUrls: parseUnknownLinks(answer.images_url),
    attachments: parseUnknownAttachments(answer.attachments,answer.related_docs),
    relatedDocs,
  };
}

function markAnsweredInvitedExperts(
  question: DetailQuestion,
  answers: DetailAnswerEntry[],
): DetailQuestion {
  if (question.invitedExperts.length === 0) return question;
  const answeredNames = new Set(
    answers.map((answer) => answer.author.expert_name.trim()).filter(Boolean),
  );

  return {
    ...question,
    invitedExperts: question.invitedExperts.map((item) => ({
      ...item,
      status: answeredNames.has(item.expert.expert_name) ? 'answered' : item.status,
    })),
  };
}

function buildExpertProfile(
  answer: ApiAnswer,
  fallbackExpert?: ExpertProfileResponse | null,
): ExpertProfile {
  const matchedFallback =
    fallbackExpert &&
    (answer.expert_id === fallbackExpert.id ||
      answer.expert_name === fallbackExpert.expert_name)
      ? fallbackExpert
      : null;
  const name =
    answer.expert_name ||
    answer.expert?.expert_name ||
    matchedFallback?.expert_name ||
    '匿名用户';

  return {
    id: answer.expert?.id ?? answer.expert_id ?? matchedFallback?.id ?? 0,
    user_id: answer.expert?.user_id ?? matchedFallback?.user_id ?? 0,
    expert_name: name,
    depart_ment: answer.expert?.depart_ment ?? matchedFallback?.depart_ment ?? EMPTY_TEXT,
    adoption_count: answer.expert?.adoption_count ?? matchedFallback?.adoption_count ?? 0,
    answer_count: answer.expert?.answer_count ?? matchedFallback?.answer_count ?? 0,
    vote_count: answer.expert?.vote_count ?? matchedFallback?.vote_count ?? answer.vote_count ?? 0,
    introduction: answer.expert?.introduction ?? matchedFallback?.introduction ?? '',
    created_at: answer.expert?.created_at ?? matchedFallback?.created_at ?? answer.created_at,
    updated_at: answer.expert?.updated_at ?? matchedFallback?.updated_at ?? answer.updated_at,
  };
}

async function buildInvitedExpert(
  name: string,
  index: number,
  createdAt: string,
): Promise<ExpertProfile> {
  try {
    // 等待异步数据获取完成
    const rawValue = await fetchExpertInfoDetail(name);

    return {
      id: index + 1,
      user_id: rawValue.user_id || 0,
      expert_name: name,
      depart_ment: rawValue.depart_ment || '受邀专家',
      adoption_count: 0,
      answer_count: 0,
      vote_count: 0,
      introduction: '',
      created_at: createdAt,
      updated_at: createdAt,
    };
  } catch (error) {
    console.warn(`Failed to fetch expert info for ${name}:`, error);
    // 失败时返回默认结构，防止程序崩溃
    return {
      id: index + 1,
      user_id: 0,
      expert_name: name,
      depart_ment: '受邀专家',
      adoption_count: 0,
      answer_count: 0,
      vote_count: 0,
      introduction: '',
      created_at: createdAt,
      updated_at: createdAt,
    };
  }
}

function formatInvitedSummary(invitedNames: string[]): string | undefined {
  if (invitedNames.length === 0) return undefined;
  const visibleNames = invitedNames.slice(0, 2).join('、');
  return `邀请：${visibleNames}${invitedNames.length > 2 ? ` 等 ${invitedNames.length} 人` : ''}`;
}

function formatAnswerBody(content: string): string {
  return escapeHtml(content || '')
    .split(/\r?\n/)
    .map((line) => `<p>${line || '&nbsp;'}</p>`)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitParagraphs(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function extractQuestionTags(title: string, domain: string): string[] {
  const tags = new Set<string>();
  if (domain?.trim()) tags.add(domain.trim());

  const matches = title.match(TECH_TOKEN_PATTERN) ?? [];
  for (const token of matches) {
    const normalizedToken = token.trim();
    if (
      normalizedToken.length < 2 ||
      IGNORED_TAGS.has(normalizedToken) ||
      tags.has(normalizedToken)
    ) {
      continue;
    }
    tags.add(normalizedToken);
    if (tags.size >= 4) break;
  }

  return Array.from(tags).slice(0, 4);
}

function parseAttachments(
  value?: string | null, 
  relatedDocs?: string | null 
): DetailAttachment[] {
  const names = splitStoredList(value);
  // 👇 将 attachments(value) 也传入，用于提取文件名和后缀
  const hrefs = parseRelatedDocs(relatedDocs, value); 

  return names.map((raw, index) => {
    const [maybeLabel] = raw.split(ASSET_PART_SEPARATOR).map((part) => part.trim());
    const href = hrefs[index] || maybeLabel; 

    return {
      label: getAttachmentLabel(maybeLabel, hrefs[index], index),
      href,
    };
  });
}
/**
 * 将 related_docs 和 attachments 解析为完整的下载链接数组
 */
function parseRelatedDocs(relatedDocs?: string | null, attachments?: string | null): string[] {
  if (!relatedDocs || typeof relatedDocs !== 'string') return [];

  const API_BASE_PATH = '/workspace/knowledge/file';
  const pairs = relatedDocs.replace(/;/g, '；').split('；').map(str => str.trim());
  const fileNames = attachments ? attachments.replace(/;/g, '；').split('；').map(str => str.trim()) : [];

  return pairs.reduce<string[]>((acc, pair, index) => {
    if (!pair || !pair.includes('-')) return acc;
    const [docId, fileId] = pair.split('-');
    
    if (docId && fileId) {
      // 获取对应的文件名，如果没有则默认为 'file'
      const fileName = fileNames[index] || 'file'; 
      
      const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
      
      const encodedName = encodeURIComponent(fileName);
      
      // 拼接目标格式的 URL
      acc.push(`${API_BASE_PATH}/${fileId}?name=${encodedName}&type=${ext}&spaceId=${docId}`);
    }
    return acc;
  }, []);
}

function getAttachmentLabel(
  maybeLabel: string,
  maybeHref: string | undefined,
  index: number,
): string {
  if (maybeHref && maybeLabel) return maybeLabel;

  const decodedName = decodeURIComponent(
    maybeLabel.split('?')[0].split('/').filter(Boolean).pop() || '',
  );

  if (NUMERIC_ATTACHMENT_PATTERN.test(decodedName)) {
    return `${DOCUMENT_FALLBACK_PREFIX}${decodedName}`;
  }

  return decodedName || `${ATTACHMENT_FALLBACK_PREFIX} ${index + 1}`;
}




function readNumberField(source: object, keys: string[]): number | undefined {
  const record = source as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsedValue = Number(value);
      if (Number.isFinite(parsedValue)) return parsedValue;
    }
  }

  return undefined;
}

function toTimestamp(value?: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

const STATUS_LABEL: Record<QuestionStatus, { text: string; cls: string }> = {
  solved: { text: '已解决', cls: s.solved },
  unsolved: { text: '待采纳', cls: s.unsolved },
  pending: { text: '未回答', cls: s.urgent },
};

const QUESTION_FALLBACK_TEXT = '暂无问题描述';
const ANSWER_PLACEHOLDER =
  '结合你的经验给出排查思路、判断依据或处理建议，发布后将展示在回答列表中。';

function StatusPill({ status }: { status: QuestionStatus }) {
  const meta = STATUS_LABEL[status];
  const Icon = status === 'solved' ? CheckCircle : null;

  return (
    <span className={`${s.statusPill} ${meta.cls}`}>
      {Icon ? <Icon size={11} /> : null}
      {meta.text}
    </span>
  );
}

function isCommentVisibleInThread(
  comment: ApiComment,
  answerId: number,
): boolean {
  if (answerId === QUESTION_FOLLOWUP_ANSWER_ID) {
    return comment.is_follow_up || comment.answer_id === QUESTION_FOLLOWUP_ANSWER_ID;
  }

  return comment.answer_id === answerId;
}

function CommentThread({
  answerId,
  questionId,
  initialCount,
  onCommentCreated,
  onTotalChange,
}: CommentThreadProps) {
  const [state, setState] = useState<CommentState>({
    items: [],
    total: initialCount,
    page: 0,
    loading: false,
    hasMore: initialCount > 0,
    draft: '',
    submitting: false,
    error: null,
  });

  const isFollowUpThread = answerId === QUESTION_FOLLOWUP_ANSWER_ID;
  const threadItemLabel = isFollowUpThread ? '追问' : '评论';
  const threadTitle = isFollowUpThread ? '问题追问' : '回答评论';
  const visibleComments = useMemo(
    () => state.items.filter((item) => isCommentVisibleInThread(item, answerId)),
    [answerId, state.items],
  );
  const totalCount = Math.max(state.total, visibleComments.length);
  const hasMore = state.hasMore && visibleComments.length < totalCount;
  const notLoaded = state.page === 0;
  const hasDraftContent = Boolean(state.draft.trim());

  const loadMore = useCallback(async () => {
    if (state.loading) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const nextPage = state.page + 1;
      const res = await fetchCommentsPaged(
        answerId,
        questionId,
        nextPage,
        COMMENTS_PAGE_SIZE,
      );
     
      const rawItems = Array.isArray(res.data) ? res.data : [];
      const nextItems = rawItems.filter((item) => isCommentVisibleInThread(item, answerId));
      const mergedItems = mergeUniqueComments(state.items, nextItems);
      const nextVisibleCount = mergedItems.filter((item) => isCommentVisibleInThread(item, answerId)).length;
      const nextTotal =
        typeof res.total === 'number' && !isFollowUpThread
          ? res.total
          : Math.max(state.total, nextVisibleCount);
      const nextHasMore =
        rawItems.length >= COMMENTS_PAGE_SIZE &&
        (typeof res.total !== 'number' || nextPage * COMMENTS_PAGE_SIZE < res.total);

      setState((prev) => ({
        ...prev,
        items: mergeUniqueComments(prev.items, nextItems),
        total: nextTotal,
        page: nextPage,
        loading: false,
        hasMore: nextHasMore,
      }));
      onTotalChange?.(nextTotal);
    } catch (err) {
      console.error('评论加载失败:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: '评论加载失败，请稍后重试',
      }));
    }
  }, [
    answerId,
    onTotalChange,
    questionId,
    state.items,
    isFollowUpThread,
    state.loading,
    state.page,
    state.total,
  ]);

  useEffect(() => {
    if (!notLoaded || (!isFollowUpThread && initialCount === 0)) return;
    const timer = window.setTimeout(() => {
      void loadMore();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialCount, isFollowUpThread, loadMore, notLoaded]);

  async function handleSubmit() {
    const content = state.draft.trim();
    if (!content || state.submitting) return;

    setState((prev) => ({ ...prev, submitting: true, error: null }));

    try {
      const createdComment = await createComment({
        answer_id: answerId,
        question_id: questionId,
        content,
        is_follow_up: isFollowUpThread,
      });

      const newComment: ApiComment = {
        ...createdComment,
        id: createdComment.id ?? Date.now(),
        answer_id: answerId,
        user_id: createdComment.user_id ?? 0,
        user_name: createdComment.user_name?.trim() || '我',
        content: createdComment.content || content,
        is_follow_up: isFollowUpThread,
        vote_count: createdComment.vote_count ?? 0,
        created_at: createdComment.created_at || new Date().toISOString(),
      };
      const nextTotal = totalCount + 1;

      const latest = await fetchCommentsPaged(
        answerId,
        questionId,
        1,
        COMMENTS_PAGE_SIZE,
      ).catch(() => null);
      const latestItems = latest && Array.isArray(latest.data)
        ? latest.data.filter((item) => isCommentVisibleInThread(item, answerId))
        : [];
      const nextItems = latestItems.length ? latestItems : [...state.items, newComment];
      const refreshedTotal =
        typeof latest?.total === 'number' && !isFollowUpThread
          ? Math.max(latest.total, nextItems.length, nextTotal)
          : Math.max(nextItems.length, nextTotal);

      setState((prev) => ({
        ...prev,
        items: nextItems,
        total: refreshedTotal,
        page: latestItems.length ? 1 : prev.page,
        hasMore: Boolean(latestItems.length && latestItems.length >= COMMENTS_PAGE_SIZE),
        draft: '',
        submitting: false,
      }));
      onCommentCreated?.();
      onTotalChange?.(refreshedTotal);
    } catch (err) {
      console.error('评论发布失败:', err);
      setState((prev) => ({
        ...prev,
        submitting: false,
        error: '评论发布失败，请稍后重试',
      }));
    }
  }

  // function handleCommentUseful(commentId: number) {
  //   setState((prev) => ({
  //     ...prev,
  //     items: prev.items.map((item) =>
  //       item.id === commentId
  //         ? { ...item, vote_count: item.vote_count + 1 }
  //         : item,
  //     ),
  //   }));
  //   void likeComment({ target_id: commentId, target_type: 'answer' });
  // }

  return (
    <div className={s.commentSection}>
      <div className={s.commentSectionTitle}>
        <span>{threadTitle}</span>
        <span>{totalCount} 条{threadItemLabel}</span>
      </div>

      {visibleComments.map((comment) => (
        <div key={comment.id} className={s.comment}>
          <div className={s.commentHead}>
            <span
              className={s.commentAv}
              style={{ backgroundColor: getAvatarColor(comment.user_name) }}
            >
              {getAvatarInitial(comment.user_name)}
            </span>
            <span className={s.commentName}>{comment.user_name}</span>
            <span className={s.commentTs}>
              {formatDateTime(comment.created_at)}
            </span>
          </div>
          <div className={s.commentBody}>{comment.content}</div>
        </div>
      ))}

      {(notLoaded && initialCount > 0) || (!notLoaded && hasMore) ? (
        <button
          type="button"
          className={s.loadMoreComments}
          onClick={() => void loadMore()}
          disabled={state.loading}
        >
          {state.loading ? (
            <>
              <Loader2 size={12} className={s.spin} />
              加载中...
            </>
          ) : notLoaded ? (
            `查看 ${totalCount} 条${threadItemLabel}`
          ) : (
            `加载更多${threadItemLabel}`
          )}
        </button>
      ) : null}

      {state.error ? <p className={s.commentError}>{state.error}</p> : null}

      <div className={s.commentComposer}>
        <textarea
          placeholder={isFollowUpThread ? '发起追问...' : '添加评论...'}
          value={state.draft}
          onChange={(event) =>
            setState((prev) => ({ ...prev, draft: event.target.value }))
          }
          disabled={state.submitting}
        />
        <div className={s.commentComposerFoot}>
          <span />
          <button
            type="button"
            className={s.sendRoundBtn}
            onClick={() => void handleSubmit()}
            disabled={state.submitting || !hasDraftContent}
            aria-label="发布"
          >
            {state.submitting ? (
              <Loader2 size={14} className={s.spin} />
            ) : (
              <ArrowUp size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnswerCard({
  answer,
  questionId,
  showComments,
  onToggleComments,
  onUseful,
  onAccept,
  onCommentTotalChange,
  usefulDisabled = false,
}: AnswerCardProps) {
  const commentThreadRef = useRef<HTMLDivElement>(null);
  const wrapClass = [
    s.answer,
    answer.isExpert ? s.answerExpert : '',
    answer.adopted ? s.answerAccepted : '',
  ]
    .filter(Boolean)
    .join(' ');
  const answerRate =
    answer.author.answer_count > 0
      ? Math.round(
          (answer.author.adoption_count / answer.author.answer_count) * 100,
        )
      : 0;

  useEffect(() => {
    if (!showComments) return;
    commentThreadRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [showComments]);

  return (
    <article className={wrapClass}>
      <div className={s.answerMain}>
        {answer.adopted ? (
          <div className={s.acceptedBanner}>
            <Check size={13} />
            已采纳为最佳回答
          </div>
        ) : null}

        <div className={s.answerHead}>
          <div
            className={`${s.avatar} ${s.avatarLg} ${
              answer.isExpert ? s.avatarExpert : ''
            }`}
            style={{ backgroundColor: getAvatarColor(answer.author.expert_name) }}
          >
            {getAvatarInitial(answer.author.expert_name)}
          </div>
          <div className={s.answerAuthor}>
            <div className={s.answerName}>
              {answer.author.expert_name}
              {answer.isExpert ? (
                <span className={s.expBadge}>
                  <BadgeCheck size={12} />
                </span>
              ) : null}
            </div>
            <div className={s.answerRole}>
              {[
                answer.author.depart_ment,
                answer.author.answer_count
                  ? `回答 ${answer.author.answer_count}`
                  : null,
                answer.author.answer_count ? `解决率 ${answerRate}%` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <span className={s.answerTs}>回答于 {answer.ts}</span>
        </div>

        <div
          className={s.answerBody}
          dangerouslySetInnerHTML={{ __html: answer.bodyHtml }}
        />

        {answer.imageUrls?.length ? (
          <div className={s.questionImages}>
            {answer.imageUrls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt="回答图片" />
              </a>
            ))}
          </div>
        ) : null}

        {answer.relatedDocs?.length ? (
          <div className={s.attachmentPanel}>
            <div className={s.attachmentTitle}>关联文档</div>
            <div className={s.attachmentList}>
              {answer.relatedDocs.map((item) => (
                <a
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={s.attachmentItem}
                >
                  <FileText size={14} />
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {!answer.adopted ? (
          <button type="button" className={s.acceptCta} onClick={onAccept}>
            <Check size={13} />
            采纳为最佳回答
          </button>
        ) : null}

        <div className={s.answerFoot}>
          <div className={s.answerActions}>
            <button type="button" onClick={onUseful} disabled={usefulDisabled}>
              <ThumbsUp size={13} />
              有用 ({answer.helpful})
            </button>
            <button type="button" onClick={onToggleComments}>
              <MessageCircle size={13} />
              评论 {answer.commentCount > 0 ? `(${answer.commentCount})` : ''}
            </button>
          </div>
        </div>

        {showComments ? (
          <div ref={commentThreadRef}>
            <CommentThread
              answerId={Number(answer.id)}
              questionId={questionId}
              initialCount={answer.commentCount}
              onTotalChange={onCommentTotalChange}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function ExpertQADetailPage() {
  const params = useParams<{ questionId?: string }>();
  // const navigate = useNavigate();
  const { user } = useAuth();
  const routeQuestionId = params.questionId;
  const [question, setQuestion] = useState<DetailQuestion | null>(null);
  const [qLoading, setQLoading] = useState(true);
  const [qError, setQError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<DetailAnswerEntry[]>([]);
  const [answerTotal, setAnswerTotal] = useState(0);
  const [answerPage, setAnswerPage] = useState(0);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const [sortMode, setSortMode] = useState<SortMode>('top');
  const [openComments, setOpenComments] = useState<Set<string>>(
    new Set([QUESTION_FOLLOWUP_THREAD_ID]),
  );
  const [followupCount, setFollowupCount] = useState(0);

  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [answerImageUrls, setAnswerImageUrls] = useState<string[]>([]);
  const [answerUploadingImages, setAnswerUploadingImages] = useState(false);
  const [answerRelatedDocs, setAnswerRelatedDocs] = useState<KnowledgeAttachment[]>([]);
  const [answerUploadError, setAnswerUploadError] = useState<string | null>(null);
  const [answerKnowledgeDialogOpen, setAnswerKnowledgeDialogOpen] = useState(false);
  const [answerToolMenuOpen, setAnswerToolMenuOpen] = useState(false);
  const [votedTargets, setVotedTargets] = useState<Set<string>>(new Set());
  const [currentExpert, setCurrentExpert] = useState<ExpertProfileResponse | null>(null);
  const answerImageInputRef = useRef<HTMLInputElement>(null);
  const answerLoadingRef = useRef(false);
  const activeQuestionIdRef = useRef<number | null>(null);
  const followupThreadRef = useRef<HTMLDivElement>(null);

  const questionNumericId = question ? Number(question.id) : null;
  const currentUserKey = user?.externalId || user?.account || user?.name || 'anonymous';
  // const canManageQuestion = Boolean(
  //   user &&
  //     question &&
  //     (question.createdBy === user.name ||
  //       question.createdBy === user.account ||
  //       String(question.ownerUserId) === user.externalId ||
  //       String(question.ownerUserId) === user.account),
  // );
  const answerHasMore = answers.length < answerTotal;
  const answeredInvitedCount = question
    ? question.invitedExperts.filter((item) => item.status === 'answered').length
    : 0;
  const sortedAnswers = useMemo(
    () =>
      [...answers].sort((a, b) =>
        sortMode === 'top'
          ? b.helpful - a.helpful || b.createdAtMs - a.createdAtMs
          : b.createdAtMs - a.createdAtMs,
      ),
    [answers, sortMode],
  );
  const followupsOpen = openComments.has(QUESTION_FOLLOWUP_THREAD_ID);

  useEffect(() => {
    let active = true;
    const candidates = [user?.name, user?.account]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));

    if (!candidates.length) {
      setCurrentExpert(null);
      return;
    }

    void (async () => {
      for (const name of candidates) {
        try {
          const expert = await fetchExpertInfoDetail(name);
          if (active) setCurrentExpert(expert);
          return;
        } catch {
         
        }
      }
      if (active) setCurrentExpert(null);
    })();

    return () => {
      active = false;
    };
  }, [user?.account, user?.name]);

  const loadAnswers = useCallback(
    async (targetQuestionId: number, page: number, replace = false) => {
      if (answerLoadingRef.current) return;
      answerLoadingRef.current = true;
      setAnswerLoading(true);
      setAnswerError(null);

      try {
        const res: PagedAnswerResponse = await fetchAnswersPaged(
          targetQuestionId,
          page,
          ANSWERS_PAGE_SIZE,
        );
        const entries = (res.answers ?? []).map((answer) =>
          buildAnswerEntry(answer, currentExpert),
        );
        if (activeQuestionIdRef.current !== targetQuestionId) return;

        setAnswers((prev) => {
          if (replace) return entries;

          const existingIds = new Set(prev.map((item) => item.id));
          const newEntries = entries.filter((item) => !existingIds.has(item.id));
          return [...prev, ...newEntries];
        });
         
        const nextTotal = typeof res.total === 'number' ? res.total : entries.length;
        setAnswerTotal(nextTotal);
        setQuestion((prev) =>
          prev
            ? {
                ...prev,
                answers: nextTotal,
                status: formatQuestionStatus(
                  prev.acceptedAnswers > 0 ? SOLVED_QUESTION_STATUS : 0,
                  nextTotal,
                  prev.acceptedAnswers > 0 ? 1 : null,
                ),
              }
            : prev,
        );
        setAnswerPage(page);
      } catch (err) {
        console.error('回答列表加载失败:', err);
        setAnswerError(err instanceof Error ? err.message : '回答列表加载失败');
      } finally {
        answerLoadingRef.current = false;
        setAnswerLoading(false);
      }
    },
    [currentExpert],
  );

  const refreshQuestionAndAnswers = useCallback(
    async (targetQuestionId: number) => {
      if (!routeQuestionId) return;

      const detail = await fetchExpertQuestionDetail(routeQuestionId);
      const related = await fetchSimilarExpertQuestions(detail.title, 5).catch(
        (err) => {
          console.error('相关问答加载失败:', err);
          return [];
        },
      );
      if (activeQuestionIdRef.current !== targetQuestionId) return;

      const mappedQuestion = await mapQuestionDetail(detail, related);
      setQuestion(mappedQuestion);
      setAnswerTotal(detail.answer_count ?? 0);
      setFollowupCount(detail.comment_count ?? 0);
      await loadAnswers(targetQuestionId, 1, true);
    },
    [loadAnswers, routeQuestionId],
  );

  useEffect(() => {
    let active = true;

    if (!routeQuestionId) {
      setQError('问题ID不存在');
      setQLoading(false);
      return;
    }

    setQLoading(true);
    setQError(null);
    setAnswers([]);
    setAnswerTotal(0);
    setAnswerPage(0);
    setOpenComments(new Set([QUESTION_FOLLOWUP_THREAD_ID]));
  
    activeQuestionIdRef.current = null;

    void (async () => {
      try {
        const detail = await fetchExpertQuestionDetail(routeQuestionId);
        const related = await fetchSimilarExpertQuestions(detail.title, 5).catch(
          (err) => {
            console.error('相关问答加载失败:', err);
            return [];
          },
        );

        if (!active) return;

        const mappedQuestion = await mapQuestionDetail(detail, related);
        activeQuestionIdRef.current = detail.id;
        setQuestion(mappedQuestion);
        setAnswerTotal(detail.answer_count ?? 0);
        setQLoading(false);
        setFollowupCount(detail.comment_count ?? 0);
        await loadAnswers(detail.id, 1, true);

      } catch (err) {
        if (!active) return;
        setQError(err instanceof Error ? err.message : '加载问题详情失败');
        setQLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadAnswers, routeQuestionId]);

  useEffect(() => {
    setQuestion((prev) =>
      prev ? markAnsweredInvitedExperts(prev, answers) : prev,
    );
  }, [answers, question?.id]);

  useEffect(() => {
    if (!questionNumericId) return;
    const next = new Set<string>();
    if (hasStoredVote(currentUserKey, 'question', questionNumericId)) {
      next.add(`question:${questionNumericId}`);
    }
    answers.forEach((answer) => {
      if (hasStoredVote(currentUserKey, 'answer-helpful', answer.id)) {
        next.add(`answer-helpful:${answer.id}`);
      }
    });
    setVotedTargets(next);
  }, [answers, currentUserKey, questionNumericId]);

  useEffect(() => {
    if (!openComments.has(QUESTION_FOLLOWUP_THREAD_ID)) return;
    followupThreadRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [openComments]);

  async function handleAnswerImageUpload(files: File[]) {
    const availableSlots = MAX_ANSWER_IMAGE_COUNT - answerImageUrls.length;
    if (availableSlots <= 0) {
      setAnswerUploadError(`图片最多上传 ${MAX_ANSWER_IMAGE_COUNT} 张`);
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);
    setAnswerUploadError(
      selectedFiles.length < files.length
        ? `图片最多上传 ${MAX_ANSWER_IMAGE_COUNT} 张，已保留前 ${availableSlots} 张`
        : null,
    );
    setAnswerUploadingImages(true);

    try {
      const uploaded = await Promise.all(
        selectedFiles.map((file) => uploadQaImage(file)),
      );
      const urls = uploaded.map((item) => item.image_url).filter(Boolean);
      if (!urls.length) throw new Error('上传响应缺少图片地址');
      setAnswerImageUrls((current) =>
        [...current, ...urls].slice(0, MAX_ANSWER_IMAGE_COUNT),
      );
    } catch (err) {
      console.error('回答图片上传失败:', err);
      setAnswerUploadError('图片上传失败，请重试');
    } finally {
      setAnswerUploadingImages(false);
    }
  }

  async function handleSubmitAnswer() {
    const content = draft.trim();
    if (!content || !questionNumericId || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload: CreateAnswerPayload = {
        question_id: questionNumericId,
        content,
        expert_id: currentExpert?.id,
        images_url: answerImageUrls.length ? answerImageUrls.join(';') : null,
        attachments: serializeKnowledgeDocumentNames(answerRelatedDocs),
        related_docs: serializeKnowledgeDocumentIds(answerRelatedDocs),
      };
      const newAnswer = await createAnswer(payload);
      const answerWithExpert: ApiAnswer = {
        ...newAnswer,
        expert_id: newAnswer.expert_id ?? currentExpert?.id ?? null,
        expert_name: newAnswer.expert_name ?? currentExpert?.expert_name ?? null,
        expert: newAnswer.expert ?? currentExpert ?? undefined,
      };

      if (typeof answerWithExpert.id === 'number') {
        const newEntry = buildAnswerEntry(answerWithExpert, currentExpert);
        setAnswers((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== newEntry.id);
          return [newEntry, ...withoutDuplicate];
        });
        setAnswerTotal((prev) => Math.max(prev + 1, 1));
        setQuestion((prev) =>
          prev
            ? markAnsweredInvitedExperts(
                {
                  ...prev,
                  answers: Math.max(prev.answers + 1, 1),
                  status: prev.status === 'pending' ? 'unsolved' : prev.status,
                },
                [newEntry],
              )
            : prev,
        );
      }
      setDraft('');
      setAnswerImageUrls([]);
      setAnswerRelatedDocs([]);
      setAnswerUploadError(null);
      await refreshQuestionAndAnswers(questionNumericId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '发布失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  function toggleComments(id: string, event?: MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();

    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }



  async function handleAnswerUseful(answerId: string) {
    const voteKey = `answer-helpful:${answerId}`;
    if (votedTargets.has(voteKey)) {
      setAnswerError('你已经点过有用了');
      return;
    }

    storeVote(currentUserKey, 'answer-helpful', answerId);
    setVotedTargets((prev) => new Set(prev).add(voteKey));
    setAnswers((prev) =>
      prev.map((answer) =>
        answer.id === answerId
          ? { ...answer, helpful: answer.helpful + 1 }
          : answer,
      ),
    );
    try {
      await markAnswerUseful({ target_id: Number(answerId), target_type: 'helpful' });
    } catch (err) {
      removeStoredVote(currentUserKey, 'answer-helpful', answerId);
      setVotedTargets((prev) => {
        const next = new Set(prev);
        next.delete(voteKey);
        return next;
      });
      setAnswers((prev) =>
        prev.map((answer) =>
          answer.id === answerId
            ? { ...answer, helpful: Math.max(answer.helpful - 1, 0) }
            : answer,
        ),
      );
      setAnswerError(err instanceof Error ? err.message : '投票失败，请稍后重试');
    }
  }

  async function handleAcceptAnswer(answerId: string) {
    if (!questionNumericId) return;

    setAnswers((prev) =>
      prev.map((answer) => ({
        ...answer,
        adopted: answer.id === answerId,
      })),
    );
    setQuestion((prev) =>
      prev ? { ...prev, status: 'solved', acceptedAnswers: 1 } : prev,
    );
    try {
      await acceptAnswer(questionNumericId, Number(answerId));
      await refreshQuestionAndAnswers(questionNumericId);
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : '采纳失败，请稍后重试');
      await refreshQuestionAndAnswers(questionNumericId);
    }
  }

  function removeAnswerImage(url: string) {
    setAnswerImageUrls((current) => current.filter((item) => item !== url));
  }

  function openAnswerKnowledgeDialog() {
    setAnswerKnowledgeDialogOpen(true);
  }

  function closeAnswerKnowledgeDialog() {
    setAnswerKnowledgeDialogOpen(false);
  }

  function handleSelectAnswerKnowledgeFiles(files: CommonUploadedFile[]) {
    setAnswerRelatedDocs(files.slice(0, MAX_ANSWER_DOCUMENT_COUNT));
  }

  function removeAnswerRelatedDoc(target: KnowledgeAttachment) {
    setAnswerRelatedDocs((current) =>
      current.filter(
        (item) =>
          !(item.spaceId === target.spaceId && item.fileId === target.fileId),
      ),
    );
  }


  if (qLoading) {
    return (
      <PageShell>
        <div className={s.container}>
          <p className={s.pageState}>
            <Loader2 size={16} className={s.spin} />
            正在加载问题详情...
          </p>
        </div>
      </PageShell>
    );
  }

  if (qError || !question || !questionNumericId) {
    return (
      <PageShell>
        <div className={s.container}>
          <p className={s.pageState}>{qError || '问题不存在'}</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className={s.container}>
        <div className={s.crumbs}>
          <Link to="/expert-qa">专家问答</Link>
          <ChevronRight size={14} className={s.crumbChevron} />
          <span>{question.domain} · 问题详情</span>
        </div>

        <div className={s.layout}>
          <main>
            <div className={s.qCard}>
              <div className={s.askerRow}>
                <span className={s.askerAvatar}>
                  {question.asker?.name.charAt(0) || '?'}
                </span>
                <span className={s.askerName}>{question.asker.name}</span>
                <span className={s.askerDate}>{question.askedAt}</span>
              </div>

              <h1 className={s.qTitle}>
                <span className={s.askBadge}>问</span>
                {question.title}
              </h1>

              <div className={s.qBodyText}>
                {question.bodyParagraphs.length > 0 ? (
                  question.bodyParagraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))
                ) : (
                  <p>{QUESTION_FALLBACK_TEXT}</p>
                )}
                {question.imageUrls.length > 0 ? (
                  <div className={s.questionImages}>
                    {question.imageUrls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img src={url} alt="问题图片" />
                      </a>
                    ))}
                  </div>
                ) : null}

                {question.attachments.length > 0 ? (
                  <div className={s.attachmentPanel}>
                    <div className={s.attachmentTitle}>关联文档</div>
                    <div className={s.attachmentList}>
                      {question.attachments.map((item) => (
                        <a
                          key={`${item.label}-${item.href}`}
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={s.attachmentItem}
                        >
                          <FileText size={14} />
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={s.qTagsRow}>
                <div className={s.qTags}>
                  <span className={s.domainPill}>{question.domain}</span>
                  <StatusPill status={question.status} />
                  {question.invitedSummary ? (
                    <span className={s.targetExpert}>
                      <User size={11} />
                      {question.invitedSummary}
                    </span>
                  ) : null}
                </div>
                <span className={s.qViews}>
                  <Eye size={14} />
                  {question.views} 浏览
                </span>
              </div>

              <div className={s.questionFollowupCard} ref={followupThreadRef}>
                <div className={s.followupHead}>
                  <button
                    type="button"
                    className={s.followupTitleBtn}
                    onClick={(event) =>
                      toggleComments(QUESTION_FOLLOWUP_THREAD_ID, event)
                    }
                  >
                    <span className={s.followupTitle}>问题追问</span>
                    {followupsOpen ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                  <span className={s.followupCount}>共{followupCount}条追问</span>
                </div>
                {followupsOpen ? (
                  <div className={s.followupThreadWrap}>
                    <CommentThread
                      answerId={QUESTION_FOLLOWUP_ANSWER_ID}
                      questionId={questionNumericId}
                      initialCount={followupCount}
                      onTotalChange={setFollowupCount}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className={s.answersCard}>
            <div className={s.answersHeader}>
              <h2>共 <strong>{answerTotal}</strong> 个回答</h2>
              <div className={s.sortToggle}>
                <button
                  type="button"
                  className={sortMode === 'top' ? s.sortActive : ''}
                  onClick={() => setSortMode('top')}
                >
                  最高赞
                </button>
                <button
                  type="button"
                  className={sortMode === 'latest' ? s.sortActive : ''}
                  onClick={() => setSortMode('latest')}
                >
                  最新
                </button>
              </div>
            </div>

            {answerError ? <p className={s.answerError}>{answerError}</p> : null}

            {sortedAnswers.map((answer) => (
              <AnswerCard
                key={answer.id}
                answer={answer}
                questionId={questionNumericId}
                showComments={openComments.has(answer.id)}
                onToggleComments={(event) => toggleComments(answer.id, event)}
                onUseful={() => void handleAnswerUseful(answer.id)}
                onAccept={() => void handleAcceptAnswer(answer.id)}
                onCommentTotalChange={(total) =>
                  setAnswers((prev) =>
                    prev.map((item) =>
                      item.id === answer.id ? { ...item, commentCount: total } : item,
                    ),
                  )
                }
                usefulDisabled={votedTargets.has(`answer-helpful:${answer.id}`)}
              />
            ))}

            {answerLoading && answers.length === 0 ? (
              <div className={s.emptyAnswers}>
                <Loader2 size={16} className={s.spin} />
                正在加载回答...
              </div>
            ) : null}

            {!answerLoading && answerTotal === 0 ? (
              <div className={s.emptyAnswers}>
                <div className={s.emptyAnswersInner}>
                  暂无回答，你可以率先作答，或点击“追问”补充信息。
                </div>
              </div>
            ) : null}

            {answerHasMore ? (
              <div className={s.loadMoreWrap}>
                <button
                  type="button"
                  className={s.btnGhost}
                  disabled={answerLoading}
                  onClick={() => void loadAnswers(questionNumericId, answerPage + 1)}
                >
                  {answerLoading ? (
                    <>
                      <Loader2 size={14} className={s.spin} />
                      加载中...
                    </>
                  ) : (
                    `加载更多回答（还剩 ${answerTotal - answers.length} 个）`
                  )}
                </button>
              </div>
            ) : null}

            <div className={s.yourAnswerCard}>
              <h3 className={s.yourAnswerTitle}>发布回答</h3>
              <input
                ref={answerImageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length) void handleAnswerImageUpload(files);
                  event.target.value = '';
                }}
              />
              <div className={s.answerComposerBox}>
                <textarea
                  className={s.yourAnswerInput}
                  placeholder={ANSWER_PLACEHOLDER}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={submitting}
                />

                {answerImageUrls.length > 0 || answerUploadingImages ? (
                  <div className={s.commentPreviewGrid}>
                    {answerImageUrls.map((url) => (
                      <div key={url} className={s.commentImagePreview}>
                        <img src={url} alt="已上传回答图片" />
                        <button
                          type="button"
                          onClick={() => removeAnswerImage(url)}
                          aria-label="移除图片"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {answerUploadingImages ? (
                      <div className={`${s.commentImagePreview} ${s.commentUploading}`}>
                        <Loader2 size={16} className={s.spin} />
                        <span>上传中</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {answerRelatedDocs.length > 0 ? (
                  <div className={s.commentAttachmentList}>
                    {answerRelatedDocs.map((item) => (
                      <span
                        key={`${item.spaceId}-${item.id}`}
                        className={s.commentAttachmentChip}
                      >
                        <FileText size={13} />
                        <span>{item.title}</span>
                        <button
                          type="button"
                          onClick={() => removeAnswerRelatedDoc(item)}
                          aria-label="移除关联文档"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className={s.answerComposerToolbar}>
                  <div className={s.answerPlusWrap}>
                    <button
                      type="button"
                      className={s.composerPlusBtn}
                      disabled={submitting}
                      onClick={() => setAnswerToolMenuOpen((prev) => !prev)}
                      aria-label="添加附件"
                    >
                      <Plus size={18} />
                    </button>
                    {answerToolMenuOpen ? (
                      <>
                        <div
                          className={s.composerMenuMask}
                          onClick={() => setAnswerToolMenuOpen(false)}
                        />
                        <div className={s.composerMenu}>
                          <button
                            type="button"
                            disabled={submitting || answerUploadingImages}
                            onClick={() => {
                              setAnswerToolMenuOpen(false);
                              answerImageInputRef.current?.click();
                            }}
                          >
                            <ImageIcon size={15} />
                            图片
                          </button>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => {
                              setAnswerToolMenuOpen(false);
                              openAnswerKnowledgeDialog();
                            }}
                          >
                            <FileText size={15} />
                            选择文档
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={s.sendRoundBtn}
                    disabled={submitting || answerUploadingImages || !draft.trim()}
                    onClick={() => void handleSubmitAnswer()}
                    aria-label="发布回答"
                  >
                    {submitting ? (
                      <Loader2 size={14} className={s.spin} />
                    ) : (
                      <ArrowUp size={16} />
                    )}
                  </button>
                </div>
              </div>

              {answerUploadError ? (
                <p className={s.answerError}>{answerUploadError}</p>
              ) : null}
              {submitError ? <p className={s.answerError}>{submitError}</p> : null}

              <p className={s.yourAnswerHint}>
                支持图片和知识库文档，回答可被采纳为最佳答案
              </p>
            </div>
            </div>
          </main>

          <aside className={s.right}>
            <div className={s.sideCard}>
              <div className={s.sideTitle}>
                <BarChart3 size={15} className={s.sideTitleIco} />
                问题概况
              </div>
              <div className={s.qStat}>
                <span>状态</span>
                <span
                  className={`${s.qStatVal} ${
                    question.status === 'solved' ? s.qStatSolved : s.qStatPending
                  }`}
                >
                  {STATUS_LABEL[question.status]?.text ?? '未知'}
                </span>
              </div>
              <div className={s.qStat}>
                <span>邀请专家</span>
                <span className={s.qStatVal}>
                  {question.invitedExperts.length} 人
                </span>
              </div>
              <div className={s.qStat}>
                <span>专家回答</span>
                <span className={s.qStatVal}>
                  {answeredInvitedCount} / {question.invitedExperts.length}
                </span>
              </div>
              <div className={s.qStat}>
                <span>关注者</span>
                <span className={s.qStatVal}>{question.followers}</span>
              </div>
            </div>

            {question.invitedExperts.length ? (
              <div className={s.sideCard}>
                <div className={s.sideTitle}>
                  <UserCheck size={15} className={s.sideTitleIco} />
                  受邀专家
                </div>
                {question.invitedExperts.map(({ expert, status }) => (
                  <div key={`${expert.id}-${expert.expert_name}`} className={s.invitedRow}>
                    <div
                      className={`${s.avatar} ${s.avatarExpert}`}
                      style={{ backgroundColor: getAvatarColor(expert.expert_name) }}
                    >
                      {getAvatarInitial(expert.expert_name)}
                    </div>
                    <div className={s.invitedInfo}>
                      <div className={s.invitedName}>
                        {expert.expert_name}
                        <span className={s.expBadge}>
                          <BadgeCheck size={12} />
                        </span>
                      </div>
                      <div className={s.invitedRole}>{expert.depart_ment}</div>
                    </div>
                    <span
                      className={`${s.invitedStatus} ${
                        status === 'answered'
                          ? s.invitedAnswered
                          : s.invitedPending
                      }`}
                    >
  
                      {status === 'answered' ? '已回答' : '待回答'}
                    </span> 
                  </div>
                ))}
              </div>
            ) : null}

            {question.related.length ? (
              <div className={s.sideCard}>
                <div className={s.sideTitle}>
                  <Link2 size={15} className={s.sideTitleIco} />
                  相关问答
                </div>
                {question.related.map((item) => (
                  <Link
                    key={item.id}
                    to={`/expert-qa/${item.id}`}
                    className={s.relQa}
                  >
                    {item.title}
                    <div className={s.relQaMeta}>{item.meta}</div>
                  </Link>
                ))}
              </div>
            ) : null}

          </aside>
        </div>

        <CommonFileUploadModal
          visible={answerKnowledgeDialogOpen}
          selectedFiles={answerRelatedDocs}
          maxSelectCount={MAX_ANSWER_DOCUMENT_COUNT}
          title="选择回答文档"
          description={`从公开知识空间中选择文档，最多 ${MAX_ANSWER_DOCUMENT_COUNT} 个`}
          onClose={closeAnswerKnowledgeDialog}
          onSelectFiles={handleSelectAnswerKnowledgeFiles}
        />
      </div>
    </PageShell>
  );
}
