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
import type { DomainOption, StatusFilterKey } from '../types/expertQa';

export const DOMAINS: DomainOption[] = [
  { key: 'all', label: '全部', icon: LayoutGrid, count: 0 },
  { key: 'mgmt', label: '管理', icon: Briefcase, count: 0 },
  { key: 'safety', label: '安全', icon: Shield, count: 0 },
  { key: 'env', label: '环保', icon: Leaf, count: 0 },
  { key: 'device', label: '设备', icon: Settings, count: 0 },
  { key: 'tech', label: '技术', icon: Wrench, count: 0 },
  { key: 'quality', label: '质量', icon: CheckCircle, count: 0 },
  { key: 'people', label: '人员', icon: Users, count: 0 },
];

export const STATUS_FILTERS: { key: StatusFilterKey; label: string;  }[] = [
  { key: 'unsolved', label: '未解决'},
  { key: 'solved', label: '已解决'},
  { key: 'mine', label: '我提问的' },
  { key: 'invited', label: '邀请我的',},
];

export const SORT_TABS: { key: 'latest' | 'hot' | 'unanswered' ; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '最热' },
  { key: 'unanswered', label: '未回答' },
];

export const HERO_STATS = [
  { value: '—', label: '问题' },
  { value: '—', label: '回答' },
  { value: '—', label: '认证专家' },
  { value: '—', label: '解决率' },
];

export const TOPIC_CHIPS = [
  { label: '振动纹', count: 0 },
  { label: '轴承诊断', count: 0 },
  { label: '煤气平衡', count: 0 },
  { label: '表面缺陷', count: 0 },
  { label: '备件管理', count: 0 },
  { label: '能耗优化', count: 0 },
  { label: '环保监测', count: 0 },
];

export const DOMAIN_OPTIONS = DOMAINS.filter((d) => d.key !== 'all');
