import type { LucideIcon } from 'lucide-react';

export type ExpertDomainKey =
  | 'all'
  | 'mgmt'
  | 'safety'
  | 'env'
  | 'device'
  | 'tech'
  | 'quality'
  | 'people';

export type QuestionStatus = 'solved' | 'unsolved'  | 'pending';

export type StatusFilterKey = 'all' | 'unsolved' | 'solved' | 'mine' | 'invited';

export type RawExpertData = {
  experts: {
    user_id: number;      
    expert_name: string;   
    depart_ment: string;   
    adoption_count: number;
    created_at: string;   
    id: number;           
    introduction: string;  
    answer_count: number;  
    vote_count: number;    
    updated_at: string;   
  }[];
  total: number;           
};


export interface ExpertProfile {
  user_id: number;
  expert_name: string;
  depart_ment: string;
  adoption_count: number;
  created_at: string;
  id: number;
  introduction: string;
  answer_count: number;
  vote_count: number;
  updated_at: string;
}
// --- 新增类型定义 ---
export interface ExpertProfileResponse {
  user_id: number;
  expert_name: string;
  depart_ment: string;
  adoption_count: number;
  created_at: string;
  id: number;
  introduction: string;
  answer_count: number;
  vote_count: number;
  updated_at: string;
}

export interface PagedExpertResponse {
  experts: ExpertProfileResponse[];
  total: number;
  page: number;
  limit: number;
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
  adopted: boolean;
  isExpert: boolean;
  votes: number;
  ts: string;
  bodyHtml: string;
  helpful: number;
  commentCount: number;
  comments?: AnswerComment[];
  showAcceptCta?: boolean;
  relatedDoc?: { label: string; href?: string };
  imageUrls?: string[];
  attachments?: { label: string; href: string }[];
  relatedDocs?: { label: string; href: string }[];
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
  fullAnswers: AnswerEntry[];
  related: { id: string; title: string; meta: string }[];
}

export interface TopicChip {
  label: string;
  count: number;
}

export interface DomainOption {
  key: ExpertDomainKey;
  label: string;
  icon: LucideIcon;
  count: number;
}


export interface TranslationStatistics {

  total_questions: number;

  total_experts: number;

  total_answers: number;

  solved_questions: number;

  resolution_rate: number; 
}