import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  CheckCircle,
  LayoutGrid,
  Leaf,
  Settings,
  Shield,
  Users,
  Wrench,
} from 'lucide-react';
import type { ExpertProfile } from '../types/expertQa';

export type ExpertDomainKey =
  | 'all'
  | 'mgmt'
  | 'safety'
  | 'env'
  | 'device'
  | 'tech'
  | 'quality'
  | 'people';

export type QuestionStatus = 'solved' | 'unsolved' | 'urgent' | 'bounty' | 'pending';

export type StatusFilterKey =
  | 'all'
  | 'unsolved'
  | 'solved'
  | 'bounty'
  | 'mine'
  | 'invited';

export interface DomainOption {
  key: ExpertDomainKey;
  label: string;
  icon: LucideIcon;
  count: number;
}


export interface AnswerComment {
  id: string;
  initial: string;
  name: string;
  text: string;
  ts: string;
}

export interface AnswerEntry {
  id: string;
  author: ExpertProfile;
  isAccepted: boolean;
  isExpert: boolean;
  votes: number;
  ts: string;
  bodyHtml: string;
  helpful: number;
  commentCount: number;
  comments?: AnswerComment[];
  showAcceptCta?: boolean;
  relatedDoc?: { label: string; href?: string };
}

export interface QuestionAsker {
  initial: string;
  name: string;
  role?: string;
}

export interface QuestionEntry {
  id: string;
  title: string;
  excerpt: string;
  domain: string;
  domainKey: ExpertDomainKey;
  status: QuestionStatus;
  bounty?: number;
  invitedSummary?: string;
  votes: number;
  answers: number;
  acceptedAnswers: number;
  views: number;
  asker: QuestionAsker;
  askedAt: string;
  tags: string[];
  acceptedPreview?: {
    author: ExpertProfile;
    excerpt: string;
    accepted: boolean;
  };
}

export interface QuestionDetail extends QuestionEntry {
  bodyParagraphs: string[];
  checkedItems: string[];
  followups: string;
  relatedDoc?: { label: string };
  followers: number;
  invitedExperts: { expert: ExpertProfile; status: 'answered' | 'pending' }[];
  answers: number;
  fullAnswers: AnswerEntry[];
  related: { id: string; title: string; meta: string }[];
}

export interface TopicChip {
  label: string;
  count: number;
}

export const DOMAINS: DomainOption[] = [
  { key: 'all', label: '全部', icon: LayoutGrid, count: 1284 },
  { key: 'mgmt', label: '管理', icon: Briefcase, count: 186 },
  { key: 'safety', label: '安全', icon: Shield, count: 214 },
  { key: 'env', label: '环保', icon: Leaf, count: 142 },
  { key: 'device', label: '设备', icon: Settings, count: 241 },
  { key: 'tech', label: '技术', icon: Wrench, count: 268 },
  { key: 'quality', label: '质量', icon: CheckCircle, count: 158 },
  { key: 'people', label: '人员', icon: Users, count: 75 },
];

export const STATUS_FILTERS: { key: StatusFilterKey; label: string; count: number }[] = [
  { key: 'unsolved', label: '未解决', count: 186 },
  { key: 'solved', label: '已解决', count: 874 },
  { key: 'bounty', label: '悬赏中', count: 42 },
  { key: 'mine', label: '我提问的', count: 7 },
  { key: 'invited', label: '邀请我的', count: 3 },
];

export const SORT_TABS: { key: 'latest' | 'hot' | 'unanswered' | 'bounty'; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '最热' },
  { key: 'unanswered', label: '未回答' },
  { key: 'bounty', label: '悬赏' },
];



export const TOPIC_CHIPS: TopicChip[] = [
  { label: '振动纹', count: 86 },
  { label: '轴承诊断', count: 62 },
  { label: '煤气平衡', count: 48 },
  { label: '表面缺陷', count: 41 },
  { label: '备件管理', count: 37 },
  { label: '能耗优化', count: 29 },
  { label: '环保监测', count: 22 },
];

export const ASK_DRAFT = {
  title: '2050mm 冷轧机出口振动纹周期性出现，停机检修后复发，可能原因？',
  body: `最近一周 2050 机组出现周期性振动纹，间距约 110mm。

【已排查】
1. 支撑辊偏心已用千分表复测，OK
2. 传动轴系动平衡复校，OK
3. 液压缸保压测试合格

【现象】
复产 36 小时后症状再次出现，凹凸条纹方向与拉坯方向一致。

请教各位专家如何系统排查，是否可能与结晶器液面控制器参数漂移有关？`,
  domainKey: 'tech' as ExpertDomainKey,
  invited:[],
  recommended: [],
  tags: ['振动纹', '2050机组'],
  bounty: 200,
  similar: [
    '连铸坯振动纹排查方法，已检修后复发',
    '2030 冷轧机轴承温升，振动谱出现边带',
    '板坯表面规律性凹坑来源判断',
  ],
};


