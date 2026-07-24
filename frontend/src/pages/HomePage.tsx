import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, type ChangeEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search, Send,
  BarChart3, Bot, ChevronLeft, ChevronRight, ChevronDown, FileText,
  Settings, Factory, Snowflake, Zap, Shield, CheckCircle,
  BriefcaseBusiness, Layers3, PenLine, MessageSquare, Globe, Network, Leaf, Truck, Wrench, GraduationCap,
  Briefcase, Users, ScrollText, Loader2, Plus, X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import ExpertQuestions from '../components/ExpertQuestions';
import QAKnowledgeTreePicker from '../components/QAKnowledgeTreePicker';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/Tooltip';
import type { DomainConfig, SectionConfig } from '../api/adminConfig';
import {
  streamHomeContent,
  fetchDomainFileCounts,
  fetchHomeStats,
  fetchHotSearches,
  fetchQaKnowledgeTreeSpaces,
  fetchQaKnowledgeTreeChildren,
  fetchQaKnowledgeFolderStats,
  searchQaKnowledgeFiles,
  uploadChatAttachment,
  recordPortalSearchEvent,
  type ChatAttachment,
  type FileItem,
  type HomeStats,
  type KnowledgeSpace,
  type PortalHotSearchItem,
  type QaKnowledgeScope,
  type RecommendationMode,
} from '../api/content';
import {
  QA_ATTACHMENT_ACCEPT,
  getAttachmentKey,
  getAttachmentName,
  isSupportedAttachment,
  type UploadingAttachment,
} from '../utils/qaAttachment';
import { saveHomeQaDraft, type HomeQaDraft } from '../utils/homeQaDraft';
import { QA_KB_HINT_TEXT, dismissQaKbHint, shouldShowQaKbHint } from '../utils/qaKbHint';
import composerModelIcon from '../assets/composer-model.svg';
import composerKnowledgeIcon from '../assets/composer-knowledge.svg';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { useAuth } from '../hooks/useAuth';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import { getEnabledCategoryCards, getEnabledDomains, getEnabledSections, resolveHomeBanners, toRuntimeDisplayConfig } from '../utils/portalConfig';
import { buildCategorySearchPath, buildDomainSearchPath } from '../utils/searchParams';
import { triggerLoginRedirect } from '../utils/loginRedirect';
import { fetchCourses } from '../api/courses';
import { formatCourseDuration, type Course } from '../types/course';
import s from './HomePage.module.css';
import navIcon from '../assets/nav-icon@2x.png';
import navTabDomainActive from '../assets/nav-tab-domain-active.png';
import navTabDomainInactive from '../assets/nav-tab-domain-inactive.png';
import navTabCategoryActive from '../assets/nav-tab-category-active.png';
import navTabCategoryInactive from '../assets/nav-tab-category-inactive.png';
import iconCourse from '../assets/icon-course@2x.png';
import iconExpert from '../assets/icon-expert@2x.png';
import iconAiqa from '../assets/icon-aiqa@2x.png';
import iconRank from '../assets/icon-rank@2x.png';
import iconRecommend from '../assets/icon-recommend@2x.png';
import iconIntel from '../assets/icon-intel@2x.png';
import iconFolder from '../assets/icon-folder@2x.png';
import iconHot from '../assets/icon-hot@2x.png';
import iconArticle from '../assets/icon-article.svg';
import iconCase from '../assets/icon-case.svg';
import iconVideo from '../assets/icon-video.svg';
import medalGold from '../assets/medal-gold@2x.png';
import medalSilver from '../assets/medal-silver@2x.png';
import medalBronze from '../assets/medal-bronze@2x.png';
import { formatDisplayDateTime } from '../utils/dateTime';

/** 积分榜单前三名(领奖台),按 展示顺序 [第二, 第一, 第三] 排列 */
const POINTS_PODIUM = [
  { rank: 2, name: '李思', dept: '炼铁作业部', score: 3850, medal: medalSilver, tone: 'silver' as const },
  { rank: 1, name: '王丽', dept: '炼钢作业部', score: 4120, medal: medalGold, tone: 'gold' as const },
  { rank: 3, name: '赵峰', dept: '热轧作业部', score: 3620, medal: medalBronze, tone: 'bronze' as const },
];

/** 积分榜单 4~10 名列表,me 标记当前登录用户所在行 */
const POINTS_ROWS = [
  { rank: 4, name: '尉仁子', dept: '首钢冷轧', score: 3280, delta: 290 },
  { rank: 5, name: '索世泽', dept: '安全部', score: 3150, delta: 260 },
  { rank: 6, name: '多琦娜(我)', dept: '采购中心', score: 3129, delta: 150 },
  { rank: 7, name: '茶慧伦', dept: '迁顺技术中心', score: 2580, delta: 156 },
  { rank: 8, name: '滑良和', dept: '设备部库', score: 2217, delta: 310 },
  { rank: 9, name: '潘世', dept: '制造部', score: 1640, delta: 124 },
  { rank: 10, name: '尹胜', dept: '炼铁作业部', score: 1500, delta: 100 },
];

/** Resolve a homepage panel header icon (PNG) from its title keywords. */
function resolveSectionIcon(title: string): string {
  if (/课程/.test(title)) return iconCourse;
  if (/专家/.test(title)) return iconExpert;
  if (/智能|问答助手|AI/i.test(title)) return iconAiqa;
  if (/百科|积分|榜|排行|排名/.test(title)) return iconRank;
  if (/情报|资讯|行业|案例|事故/.test(title)) return iconIntel;
  if (/文件|资料/.test(title)) return iconFolder;
  return iconRecommend;
}

/** 首页板块标题渐变类:情报/案例→蓝紫,其余(知识推荐)→蓝 */
function resolveSectionHeaderClass(title: string): string {
  if (/情报|资讯|行业|案例|事故|趋势/.test(title)) return s.headerIntel;
  return s.headerRecommend;
}

/** 首页板块列表项图标:情报/案例→深蓝,知识推荐→浅蓝 */
function resolveSectionItemIcon(title: string): string {
  if (/情报|资讯|行业|案例|事故|趋势/.test(title)) return iconCase;
  return iconArticle;
}

const LATEST_SELECTED_RECOMMENDATION = 'latest_selected';
const TYPICAL_CASE_SECTION_KEY = 'typical_case';

function isLatestSelectedSection(section: SectionConfig): boolean {
  return section.builtin_key === LATEST_SELECTED_RECOMMENDATION;
}

function getHomeSectionKey(section: SectionConfig): string {
  return isLatestSelectedSection(section) ? LATEST_SELECTED_RECOMMENDATION : section.tag;
}

function getHomeStreamSectionKey(tag: string, recommendationMode?: RecommendationMode): string {
  return recommendationMode ? LATEST_SELECTED_RECOMMENDATION : tag;
}

function buildSectionMoreLink(section: SectionConfig, recommendationMode?: RecommendationMode): string {
  const titleParam = `title=${encodeURIComponent(section.title)}`;
  if (isLatestSelectedSection(section)) {
    const mode = recommendationMode ?? LATEST_SELECTED_RECOMMENDATION;
    return `/list?recommendation=${mode}&${titleParam}`;
  }
  const publicScopeParam = section.builtin_key === TYPICAL_CASE_SECTION_KEY
    ? 'public_only=true&'
    : '';
  return `${section.link}${section.link.includes('?') ? '&' : '?'}${publicScopeParam}${titleParam}`;
}

function buildHomeFilePath(file: FileItem, recommendationMode?: RecommendationMode): string {
  const query = new URLSearchParams({ entry_point: 'home_recommendation' });
  if (recommendationMode) query.set('recommendation_scene', recommendationMode);
  return '/space/' + file.spaceId + '/file/' + file.id + '?' + query.toString();
}

const DOMAIN_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Settings, Factory, Snowflake, Zap, Shield, CheckCircle, Leaf, Truck, Network, Wrench, GraduationCap,
  Briefcase, Users,
};

const APP_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  PenLine, Search, MessageSquare, Globe, BarChart3, Network, FileText, Bot, BriefcaseBusiness, Layers3, ScrollText,
};

const APP_SHORTCUT_IMAGES: Record<string, string> = {
  'thought-report': '/app-shortcuts/office-writing.png',
  'work-push-plan': '/app-shortcuts/hero-semantic-search.png',
  'office-writing': '/app-shortcuts/hero-open-qa.png',
  'hero-doc-translate': '/app-shortcuts/hero-doc-translate.png',
  'hero-semantic-search': '/app-shortcuts/summary-report.png',
  'hero-open-qa': '/app-shortcuts/work-plan.png',
};

// 后台图标名 → 兜底图片(id 未命中时按图标名从 6 张图里选一张最贴切的）
const APP_ICON_IMAGES: Record<string, string> = {
  PenLine: '/app-shortcuts/office-writing.png',
  Search: '/app-shortcuts/hero-semantic-search.png',
  MessageSquare: '/app-shortcuts/hero-open-qa.png',
  Globe: '/app-shortcuts/hero-doc-translate.png',
  BarChart3: '/app-shortcuts/summary-report.png',
  FileText: '/app-shortcuts/summary-report.png',
  ScrollText: '/app-shortcuts/summary-report.png',
  Network: '/app-shortcuts/work-plan.png',
  Layers3: '/app-shortcuts/work-plan.png',
  BriefcaseBusiness: '/app-shortcuts/work-plan.png',
  Bot: '/app-shortcuts/hero-open-qa.png',
};


const MOCK_DOMAIN_NAV_ITEMS: DomainConfig[] = [
  {
    name: '营销',
    space_ids: [],
    color: '#d97706',
    bg: '#fef3c7',
    icon: 'CheckCircle',
    background_image: '/domain-covers/marketing.png',
    enabled: true,
    code: '',
  },
  {
    name: '财务',
    space_ids: [],
    color: '#2563eb',
    bg: '#eff6ff',
    icon: 'Settings',
    background_image: '/domain-covers/finance.png',
    enabled: true,
    code: '',
  },
  {
    name: '设备',
    space_ids: [],
    color: '#2563eb',
    bg: '#eff6ff',
    icon: 'Settings',
    background_image: '/domain-covers/equipment.png',
    enabled: true,
    code: '',
  },
  {
    name: '安全',
    space_ids: [],
    color: '#dc2626',
    bg: '#fee2e2',
    icon: 'Shield',
    background_image: '/domain-covers/safety.png',
    enabled: true,
    code: '',
  },
  {
    name: '环保',
    space_ids: [],
    color: '#16a34a',
    bg: '#dcfce7',
    icon: 'Leaf',
    background_image: '/domain-covers/environment.png',
    enabled: true,
    code: '',
  },
  {
    name: '人力',
    space_ids: [],
    color: '#be185d',
    bg: '#fce7f3',
    icon: 'GraduationCap',
    background_image: '/domain-covers/hr.png',
    enabled: true,
    code: '',
  },
  {
    name: '信息',
    space_ids: [],
    color: '#6366f1',
    bg: '#ede9fe',
    icon: 'Network',
    background_image: '/domain-covers/it.png',
    enabled: true,
    code: '',
  },
  {
    name: '能源',
    space_ids: [],
    color: '#d97706',
    bg: '#fef3c7',
    icon: 'Zap',
    background_image: '/domain-covers/energy.png',
    enabled: true,
    code: '',
  },
  {
    name: '质量',
    space_ids: [],
    color: '#7c3aed',
    bg: '#f5f3ff',
    icon: 'CheckCircle',
    background_image: '/domain-covers/quality.png',
    enabled: true,
    code: '',
  },
  {
    name: '管理',
    space_ids: [],
    color: '#475569',
    bg: '#e2e8f0',
    icon: 'Settings',
    background_image: '/domain-covers/management.png',
    enabled: true,
    code: '',
  },
];

const MOCK_DOMAIN_STATS = new Map([
  ['营销', 124],
  ['财务', 98],
  ['设备', 473],
  ['安全', 289],
  ['环保', 205],
  ['人力', 143],
  ['信息', 178],
  ['能源', 131],
  ['质量', 312],
  ['管理', 217],
]);

const BANNER_OVERLAY_GRADIENT =
  'linear-gradient(180deg, rgba(43, 118, 246, 0.52) 0%, rgba(59, 143, 246, 0.36) 38%, rgba(22, 98, 178, 0.34) 100%), linear-gradient(90deg, rgba(37, 99, 235, 0.18) 0%, rgba(37, 99, 235, 0.04) 46%, rgba(37, 99, 235, 0.16) 100%)';

function buildBannerBackground(imageUrl: string): string {
  return `${BANNER_OVERLAY_GRADIENT}, url("${imageUrl}")`;
}

/**
 * Strip a redundant leading "【摘要】：" prefix from summary text.
 * Some upstream data double-prefixes the label (e.g. "【摘要】：【文档类型】：...
 * 【摘要】：actual body")—drop only the leading marker so the visible label
 * remains attached to the real body.
 */
function cleanSummaryText(summary: string | null | undefined): string {
  if (!summary) return '';
  const trimmed = summary.trim();
  const leadingLabel = /^【摘要】\s*[：:]\s*/;
  const match = trimmed.match(leadingLabel);
  if (!match) return trimmed;
  const rest = trimmed.slice(match[0].length);
  // Only strip when another 【摘要】 marker remains, so we never accidentally
  // hide the label for entries that only have one.
  return /【摘要】\s*[：:]/.test(rest) ? rest : trimmed;
}

function formatCount(value: number): string {
  if (value >= 10000) {
    const wan = value / 10000;
    return `${Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1)}万`;
  }
  return String(value);
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { config, loading: configLoading, error } = usePortalConfig();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [query, setQuery] = useState('');
  const [searchTab, setSearchTab] = useState<'global' | 'qa'>('global');
  const [bannerIdx, setBannerIdx] = useState(0);
  const domainScrollRef = useRef<HTMLDivElement>(null);
  const domainDragRef = useRef({ isDown: false, startX: 0, scrollLeft: 0, moved: false, path: '' });
  const [domainScrollState, setDomainScrollState] = useState({ atStart: true, atEnd: false });
  const [navTab, setNavTab] = useState<'domain' | 'category'>('category');
  const [sectionData, setSectionData] = useState<Record<string, FileItem[]>>({});
  const [sectionRecommendationModes, setSectionRecommendationModes] = useState<Record<string, RecommendationMode>>({});
  const [loadedSectionTags, setLoadedSectionTags] = useState<Set<string>>(new Set());
  const [sectionDataLoading, setSectionDataLoading] = useState(false);
  const [showHotTagMenu, setShowHotTagMenu] = useState(false);
  const [hotSearches, setHotSearches] = useState<PortalHotSearchItem[]>([]);
  const [hotSearchesReady, setHotSearchesReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({});
  const [domainCountsLoading, setDomainCountsLoading] = useState(true);
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [homeStatsFailed, setHomeStatsFailed] = useState(false);
  const [homeCourses, setHomeCourses] = useState<Course[]>([]);
  const [homeCoursesLoading, setHomeCoursesLoading] = useState(true);
  const [welcomeToast, setWelcomeToast] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const flag = window.sessionStorage.getItem('sg_just_logged_in');
      if (!flag) return '';
      window.sessionStorage.removeItem('sg_just_logged_in');
      const raw = window.localStorage.getItem('sg_portal_user');
      if (!raw) return '';
      const parsed = JSON.parse(raw) as { name?: string };
      return parsed.name ? `欢迎回来，${parsed.name}` : '';
    } catch {
      return '';
    }
  });

  // ── 首页「智能问答」复合输入框:模型档位 / 知识库范围 / 附件上传 ──
  const [qaAnswerMode, setQaAnswerMode] = useState<'normal' | 'expert'>('normal');
  const [qaModelMenuOpen, setQaModelMenuOpen] = useState(false);
  const [qaAttachments, setQaAttachments] = useState<ChatAttachment[]>([]);
  const [qaUploading, setQaUploading] = useState<UploadingAttachment[]>([]);
  const [qaSpaces, setQaSpaces] = useState<KnowledgeSpace[]>([]);
  const [qaSpacesLoaded, setQaSpacesLoaded] = useState(false);
  const [qaSpacesLoading, setQaSpacesLoading] = useState(false);
  const [qaScope, setQaScope] = useState<QaKnowledgeScope>({ mode: 'none' });
  const [qaPickerOpen, setQaPickerOpen] = useState(false);
  const [qaTip, setQaTip] = useState('');
  const qaFileInputRef = useRef<HTMLInputElement>(null);
  const qaModelWrapRef = useRef<HTMLDivElement>(null);
  const qaPickerWrapRef = useRef<HTMLDivElement>(null);
  const qaPickerBtnRef = useRef<HTMLButtonElement>(null);
  const qaPickerPanelRef = useRef<HTMLDivElement>(null);
  const [qaPickerPos, setQaPickerPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const [qaKbHintOpen, setQaKbHintOpen] = useState(() => shouldShowQaKbHint(user?.account));
  const [qaKbHintPos, setQaKbHintPos] = useState<{ left: number; top: number } | null>(null);

  const qaGeneralLabel = config?.qa?.general_model_display_name?.trim() || '通用模型';
  const qaReasoningLabel = config?.qa?.reasoning_model_display_name?.trim() || '推理模型';
  const qaReasoningAvailable = Boolean(config?.qa?.reasoning_model);
  const qaModelLabel = qaAnswerMode === 'expert' ? qaReasoningLabel : qaGeneralLabel;
  const qaHasAttachments = qaAttachments.length > 0 || qaUploading.length > 0;
  const qaKnowledgeLabel = (() => {
    if (qaScope.mode === 'knowledge_space') {
      const ids = qaScope.knowledgeSpaceIds;
      if (ids.length === 1) return qaSpaces.find((sp) => sp.id === ids[0])?.name || '已选 1 个知识库';
      return `已选 ${ids.length} 个知识库`;
    }
    if (qaScope.mode === 'files') return `已选 ${qaScope.fileRefs.length} 个文件`;
    return '选择知识库';
  })();

  const navigateToTop = useCallback((path: string) => {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    navigate(path);
    requestAnimationFrame(() => {
      root.style.scrollBehavior = previousScrollBehavior;
    });
  }, [navigate]);

  const scrollDomains = (direction: 1 | -1) => {
    const el = domainScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const handleDomainPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = domainScrollRef.current;
    if (!el) return;
    // 记录按下时所在卡片的跳转路径:指针捕获后 click 会落到容器而非卡片,
    // 因此点击跳转改在 pointerup(未拖动时)按此路径触发。
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-domain-path]');
    domainDragRef.current = {
      isDown: true,
      startX: event.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
      path: card?.dataset.domainPath ?? '',
    };
    el.setPointerCapture(event.pointerId);
  };

  const handleDomainPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = domainDragRef.current;
    const el = domainScrollRef.current;
    if (!drag.isDown || !el) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 3) drag.moved = true;
    el.scrollLeft = drag.scrollLeft - delta;
  };

  const handleDomainPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = domainDragRef.current;
    const shouldNavigate = drag.isDown && !drag.moved && Boolean(drag.path);
    drag.isDown = false;
    domainScrollRef.current?.releasePointerCapture(event.pointerId);
    if (shouldNavigate) navigateToTop(drag.path);
  };

  // 指针移出/取消:仅结束拖动,不触发跳转
  const handleDomainPointerCancel = () => {
    domainDragRef.current.isDown = false;
  };

  const homeBanners = useMemo(() => resolveHomeBanners(config?.banners), [config?.banners]);

  const safeBannerIdx = homeBanners.length ? bannerIdx % homeBanners.length : 0;

  /* Banner auto-play */
  useEffect(() => {
    if (homeBanners.length <= 1) return;
    const timer = setInterval(() => {
      setBannerIdx((i) => (i + 1) % homeBanners.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [homeBanners.length]);

  useEffect(() => {
    if (!welcomeToast) return;
    const timer = window.setTimeout(() => setWelcomeToast(''), 1800);
    return () => window.clearTimeout(timer);
  }, [welcomeToast]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const counts = await fetchDomainFileCounts();
        if (active) setDomainCounts(counts);
      } catch {
        /* keep empty -> cards show 0; do not block the page */
      } finally {
        if (active) setDomainCountsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchCourses('home')
      .then((courses) => {
        if (active) setHomeCourses(courses);
      })
      .catch(() => {
        if (active) setHomeCourses([]);
      })
      .finally(() => {
        if (active) setHomeCoursesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setHomeStatsFailed(false);
    void (async () => {
      try {
        const stats = await fetchHomeStats();
        if (!active) return;
        setHomeStats(stats);
        setHomeStatsFailed(false);
      } catch {
        if (!active) return;
        setHomeStats(null);
        setHomeStatsFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSearch = useCallback(() => {
    const keyword = query.trim();
    if (searchTab === 'qa') {
      // 未登录:先去登录(附件/问答均需登录)。
      if (!user) {
        triggerLoginRedirect('/apps?tab=qa');
        return;
      }
      // 无问题也无附件:仅打开问答页,不自动发送。
      if (!keyword && !qaAttachments.length) {
        navigate('/apps?tab=qa');
        return;
      }
      // 附件仍在上传中:等待完成再发。
      if (qaUploading.length) {
        setQaTip('附件上传中，请稍候');
        return;
      }
      // 把首页选好的模型档位 / 知识库范围 / 附件打包成草稿,跳转后自动发送、开启新会话。
      const draft: HomeQaDraft = {
        keyword,
        answerMode: qaAnswerMode,
        scope: qaScope,
        attachments: qaAttachments,
      };
      saveHomeQaDraft(draft);
      navigate('/apps?tab=qa&autosend=1&draft=1');
      return;
    }
    if (keyword && user) {
      void recordPortalSearchEvent(keyword, 'search_page').catch(() => undefined);
    }
    navigate(keyword ? `/search?q=${encodeURIComponent(keyword)}` : '/search');
  }, [query, searchTab, navigate, user, qaAnswerMode, qaScope, qaAttachments, qaUploading.length]);

  async function ensureQaSpaces() {
    if (qaSpacesLoaded || qaSpacesLoading) return;
    setQaSpacesLoading(true);
    try {
      const { data } = await fetchQaKnowledgeTreeSpaces();
      setQaSpaces(data);
      setQaSpacesLoaded(true);
      if (!data.length) setQaTip(user ? '当前账号暂无可用知识库。' : '当前暂无可用公共知识库。');
    } catch {
      setQaTip('知识库列表加载失败，请稍后重试。');
    } finally {
      setQaSpacesLoading(false);
    }
  }

  const toggleQaPicker = () => {
    setQaModelMenuOpen(false);
    setQaPickerOpen((open) => !open);
    if (!qaPickerOpen) void ensureQaSpaces();
  };

  const chooseQaModel = (mode: 'normal' | 'expert') => {
    if (mode === 'expert' && !qaReasoningAvailable) {
      setQaTip('请先在后台配置推理模型。');
      return;
    }
    setQaAnswerMode(mode);
    setQaModelMenuOpen(false);
  };

  const handleQaFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    if (!user) {
      triggerLoginRedirect('/apps?tab=qa');
      return;
    }
    const supported = files.filter(isSupportedAttachment);
    if (supported.length !== files.length) {
      setQaTip('仅支持常见文档、表格、演示文稿、图片和文本附件。');
    }
    supported.forEach((file, index) => {
      const uploadId = `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`;
      setQaUploading((prev) => [...prev, { id: uploadId, name: file.name }]);
      void uploadChatAttachment(file)
        .then((attachment) => {
          setQaAttachments((prev) => [
            ...prev,
            { ...attachment, filename: attachment.filename || file.name, type: attachment.type || file.type },
          ]);
        })
        .catch(() => {
          setQaTip(`「${file.name}」上传失败，请重试。`);
        })
        .finally(() => {
          setQaUploading((prev) => prev.filter((item) => item.id !== uploadId));
        });
    });
  };

  const removeQaAttachment = (targetKey: string) => {
    setQaAttachments((prev) => prev.filter((file) => getAttachmentKey(file) !== targetKey));
  };

  useEffect(() => {
    if (!qaTip) return undefined;
    const timer = window.setTimeout(() => setQaTip(''), 2200);
    return () => window.clearTimeout(timer);
  }, [qaTip]);

  // 气泡按用户各自记录:切换账号(登录/退出)后按新用户重新判定是否提示。
  useEffect(() => {
    setQaKbHintOpen(shouldShowQaKbHint(user?.account));
  }, [user?.account]);

  useEffect(() => {
    if (!qaModelMenuOpen && !qaPickerOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (qaModelMenuOpen && qaModelWrapRef.current && !qaModelWrapRef.current.contains(target)) {
        setQaModelMenuOpen(false);
      }
      // 知识库面板通过 portal 挂到 body,判断点击是否在按钮或面板之外。
      if (
        qaPickerOpen
        && qaPickerWrapRef.current
        && !qaPickerWrapRef.current.contains(target)
        && (!qaPickerPanelRef.current || !qaPickerPanelRef.current.contains(target))
      ) {
        setQaPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [qaModelMenuOpen, qaPickerOpen]);

  // 知识库面板定位:锚定在知识库按钮下方,向下展开;宽度/高度按视口夹取,portal 到 body 避免被 banner 裁切。
  useLayoutEffect(() => {
    if (!qaPickerOpen) {
      setQaPickerPos(null);
      return undefined;
    }
    const compute = () => {
      const btn = qaPickerBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const margin = 16;
      const cardPadX = 30; // portal 卡片的左右内边距+边框
      const cardPadY = 30; // 卡片的上下内边距+边框
      const width = Math.min(680, window.innerWidth - margin * 2 - cardPadX);
      const cardWidth = width + cardPadX;
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - cardWidth - margin));
      const top = rect.bottom + 8;
      const maxHeight = Math.max(200, window.innerHeight - top - margin - cardPadY);
      setQaPickerPos({ left, top, width, maxHeight });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [qaPickerOpen]);

  // 气泡定位:锚在知识库按钮右侧、箭头朝左;portal 到 body 避免被 banner 裁切。
  useLayoutEffect(() => {
    if (searchTab !== 'qa' || !qaKbHintOpen || qaPickerOpen) {
      setQaKbHintPos(null);
      return undefined;
    }
    const compute = () => {
      const btn = qaPickerBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const margin = 12;
      const width = 260;
      const left = Math.max(margin, Math.min(rect.right + 12, window.innerWidth - width - margin));
      const top = rect.top + rect.height / 2;
      setQaKbHintPos({ left, top });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    // banner 轮播换到长标题会让标题换行、把按钮挤动;按钮文案变化(已选 N 个知识库)也会改变宽度。
    // 这里用 ResizeObserver 兜住尺寸变化,轮播则由依赖里的 bannerIdx 触发重算。
    const btn = qaPickerBtnRef.current;
    const observer = btn && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => compute()) : null;
    if (btn && observer) observer.observe(btn);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      observer?.disconnect();
    };
  }, [searchTab, qaKbHintOpen, qaPickerOpen, bannerIdx, qaKnowledgeLabel]);

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowHotTagMenu(false);
      return;
    }
    // Enter 检索,Shift+Enter 换行(多行输入)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const enabledDomains = useMemo(() => (config ? getEnabledDomains(config.domains) : []), [config]);
  const enabledCategoryCards = useMemo(() => (config ? getEnabledCategoryCards(config.category_cards) : []), [config]);
  const enabledSections = useMemo(() => (config ? getEnabledSections(config.sections) : []), [config]);
  const qaHotQuestions = useMemo(() => {
    const items = (config?.qa.hot_questions || []).map((question) => question.trim()).filter(Boolean);
    return items.slice(0, displayConfig.home.hotTagsCount);
  }, [config?.qa.hot_questions, displayConfig.home.hotTagsCount]);
  const displayHotQueries = useMemo(() => {
    if (!hotSearchesReady) return [];
    if (hotSearches.length > 0) return hotSearches.map((item) => item.query);
    return qaHotQuestions;
  }, [hotSearches, hotSearchesReady, qaHotQuestions]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const items = await fetchHotSearches();
        if (active) setHotSearches(items);
      } catch {
        if (active) setHotSearches([]);
      } finally {
        if (active) setHotSearchesReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!displayHotQueries.length) setShowHotTagMenu(false);
  }, [displayHotQueries.length]);

  useEffect(() => {
    let active = true;
    if (!config) return () => {
      active = false;
    };

    const controller = new AbortController();
    setSectionDataLoading(true);
    setSectionData({});
    setSectionRecommendationModes({});
    setLoadedSectionTags(new Set());
    void (async () => {
      try {
        await streamHomeContent({
          signal: controller.signal,
          onSection: (tag, items, recommendationMode) => {
            if (!active) return;
            const sectionKey = getHomeStreamSectionKey(tag, recommendationMode);
            setSectionData((prev) => ({ ...prev, [sectionKey]: items }));
            if (recommendationMode) {
              setSectionRecommendationModes((prev) => ({ ...prev, [sectionKey]: recommendationMode }));
            }
            setLoadedSectionTags((prev) => {
              const next = new Set(prev);
              next.add(sectionKey);
              return next;
            });
            setLoadError('');
          },
        });
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setSectionData({});
        setLoadError(err instanceof Error ? err.message : '首页数据加载失败');
      } finally {
        if (active) setSectionDataLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [config]);

  /* Stats */
  const activeBanner = homeBanners[safeBannerIdx] ?? homeBanners[0];
  const configuredHomeDomains = enabledDomains.slice(0, displayConfig.home.domainCount);
  const useMockShellContent = !config && !configLoading;
  const isUsingMockDomains = useMockShellContent && configuredHomeDomains.length === 0;
  const homeDomains = isUsingMockDomains ? MOCK_DOMAIN_NAV_ITEMS : configuredHomeDomains;
  const domainTotals = isUsingMockDomains ? MOCK_DOMAIN_STATS : new Map(homeDomains.map((domain) => {
    const code = (domain.code || '').trim().toUpperCase();
    return [domain.name, code ? (domainCounts[code] ?? 0) : 0] as [string, number];
  }));
  const homeCategoryCards = enabledCategoryCards.slice(0, displayConfig.home.domainCount);
  const showCategoryTab = homeCategoryCards.length > 0;
  const activeNavTab = showCategoryTab ? navTab : 'domain';
  const activeNavCardCount = activeNavTab === 'category' ? homeCategoryCards.length : homeDomains.length;
  const homeSections = enabledSections.slice(0, 3);
  const contentSections = homeSections;
  const showHotSearch = searchTab === 'global' && displayHotQueries.length > 0;

  const appEntryItems = (config?.qa.templates || []).filter((template) => template.enabled && template.show_on_home);
  const formatHomeStat = (value: number | undefined): string => {
    if (homeStatsFailed) return '--';
    if (!homeStats) return '加载中';
    return formatCount(value ?? 0);
  };
  const heroStats = [
    { value: formatHomeStat(homeStats?.totalDocuments), label: '篇文档' },
    { value: formatHomeStat(homeStats?.readCount), label: '次阅读' },
    { value: formatHomeStat(homeStats?.favoriteCount), label: '次收藏' },
    { value: formatHomeStat(homeStats?.qaCount), label: '次问答' },
  ];

  // 业务域导航滚动到头/尾时禁用对应箭头
  useEffect(() => {
    const el = domainScrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const maxScroll = Math.max(0, scrollWidth - clientWidth);
      setDomainScrollState({
        atStart: scrollLeft <= 1,
        atEnd: maxScroll <= 1 || scrollLeft >= maxScroll - 1,
      });
    };
    update();
    const onScroll = () => update();
    el.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [activeNavCardCount]);

  // 切换导航 tab 时,滚动条回到起点,箭头状态重算
  useEffect(() => {
    const el = domainScrollRef.current;
    if (el) el.scrollLeft = 0;
  }, [activeNavTab]);

  return (
    <PageShell>
      {welcomeToast ? (
        <div className={s.welcomeToast} role="status">
          <CheckCircle size={14} />
          <span>{welcomeToast}</span>
        </div>
      ) : null}

      {/* Hero */}
      <section className={s.hero}>
        <div
          className={s.heroBanner}
          style={{ cursor: activeBanner.linkUrl ? 'pointer' : 'default' }}
          onClick={() => {
            const link = activeBanner.linkUrl;
            if (!link) return;
            if (/^https?:\/\//i.test(link)) {
              window.open(link, '_blank', 'noopener,noreferrer');
            } else {
              navigate(link);
            }
          }}
        >
          <div className={s.heroSlides} aria-hidden="true">
            {homeBanners.map((banner, index) => (
              <div
                key={`${banner.imageUrl}-${index}`}
                className={`${s.heroSlide} ${index === safeBannerIdx ? s.heroSlideActive : ''}`}
                style={{ backgroundImage: buildBannerBackground(banner.imageUrl) }}
              />
            ))}
          </div>
          <div className={s.heroGlow} />
          <div key={`${safeBannerIdx}-${activeBanner.title}`} className={s.heroInner}>
            <div className={s.heroTitleRow}>
              <span className={s.bannerLabel}>{activeBanner.label}</span>
              <h1 className={s.heroTitle}>{activeBanner.title}</h1>
            </div>
            <p className={s.heroSub}>{activeBanner.desc}</p>
          </div>
          <div
            className={`${s.heroSearchPanel} ${showHotTagMenu ? s.heroSearchPanelOpen : ''}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={s.searchTabs} role="tablist" aria-label="搜索方式">
              <button
                type="button"
                role="tab"
                aria-selected={searchTab === 'global'}
                className={`${s.searchTab} ${searchTab === 'global' ? s.searchTabActive : ''}`}
                onClick={() => setSearchTab('global')}
              >
                全局检索
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={searchTab === 'qa'}
                className={`${s.searchTab} ${searchTab === 'qa' ? s.searchTabActive : ''}`}
                onClick={() => {
                  setSearchTab('qa');
                  setShowHotTagMenu(false);
                }}
              >
                小智知道
              </button>
            </div>
            <div className={s.searchBox}>
              <textarea
                className={s.searchInput}
                placeholder={searchTab === 'qa' ? '输入问题，钢小智为您解答，挑选知识库，回答精准可溯源。' : '输入关键词搜索知识文档'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                rows={2}
              />
              {searchTab === 'qa' && qaHasAttachments ? (
                <div className={s.qaAttachments}>
                  {qaUploading.map((file) => (
                    <span key={file.id} className={`${s.qaChip} ${s.qaChipUploading}`}>
                      <Loader2 size={12} className={s.qaChipSpin} />
                      <span className={s.qaChipName}>{file.name}</span>
                    </span>
                  ))}
                  {qaAttachments.map((file) => (
                    <span key={getAttachmentKey(file)} className={s.qaChip}>
                      <span className={s.qaChipName}>{getAttachmentName(file)}</span>
                      <button
                        type="button"
                        className={s.qaChipRemove}
                        onClick={() => removeQaAttachment(getAttachmentKey(file))}
                        aria-label="移除附件"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={s.searchBoxBar}>
                {showHotSearch ? (
                  <button
                    type="button"
                    className={`${s.searchModeBtn} ${showHotTagMenu ? s.searchModeBtnActive : ''}`}
                    aria-expanded={showHotTagMenu}
                    aria-controls="home-hot-tag-menu"
                    onClick={() => setShowHotTagMenu((open) => !open)}
                  >
                    <img src={iconHot} alt="" className={s.searchModeIcon} />
                    <span>热搜</span>
                    <ChevronRight size={10} className={s.searchModeCaret} />
                  </button>
                ) : searchTab === 'global' ? (
                  <span />
                ) : (
                  <div className={s.qaToolbar}>
                    <input
                      ref={qaFileInputRef}
                      type="file"
                      multiple
                      accept={QA_ATTACHMENT_ACCEPT}
                      className={s.qaHiddenFile}
                      onChange={handleQaFileSelect}
                    />
                    <button
                      type="button"
                      className={s.qaToolBtn}
                      onClick={() => (user ? qaFileInputRef.current?.click() : triggerLoginRedirect('/apps?tab=qa'))}
                      aria-label="上传附件"
                    >
                      <Plus size={16} />
                    </button>
                    <span className={s.qaToolDivider} />
                    <div className={s.qaToolWrap} ref={qaModelWrapRef}>
                      <button
                        type="button"
                        className={s.qaToolItem}
                        onClick={() => {
                          setQaPickerOpen(false);
                          setQaModelMenuOpen((open) => !open);
                        }}
                      >
                        <img src={composerModelIcon} alt="" className={s.qaToolIcon} aria-hidden="true" />
                        <span>{qaModelLabel}</span>
                        <ChevronDown size={12} className={s.qaToolCaret} />
                      </button>
                      {qaModelMenuOpen ? (
                        <div className={s.qaMenu}>
                          <button
                            type="button"
                            className={`${s.qaMenuItem} ${qaAnswerMode === 'normal' ? s.qaMenuItemActive : ''}`}
                            onClick={() => chooseQaModel('normal')}
                          >
                            {qaGeneralLabel}
                          </button>
                          <button
                            type="button"
                            className={`${s.qaMenuItem} ${qaAnswerMode === 'expert' ? s.qaMenuItemActive : ''}`}
                            onClick={() => chooseQaModel('expert')}
                            disabled={!qaReasoningAvailable}
                          >
                            {qaReasoningLabel}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <span className={s.qaToolDivider} />
                    <div className={s.qaToolWrap} ref={qaPickerWrapRef}>
                      <button
                        ref={qaPickerBtnRef}
                        type="button"
                        className={s.qaToolItem}
                        onClick={toggleQaPicker}
                        disabled={qaSpacesLoading}
                      >
                        <img src={composerKnowledgeIcon} alt="" className={s.qaToolIcon} aria-hidden="true" />
                        <span>{qaKnowledgeLabel}</span>
                        <ChevronDown size={12} className={s.qaToolCaret} />
                      </button>
                      {qaPickerOpen && qaPickerPos
                        ? createPortal(
                          <div
                            ref={qaPickerPanelRef}
                            className={s.qaPickerPortal}
                            style={{ position: 'fixed', left: qaPickerPos.left, top: qaPickerPos.top }}
                          >
                            <QAKnowledgeTreePicker
                              spaces={qaSpaces}
                              scope={qaScope}
                              loading={qaSpacesLoading}
                              onChange={setQaScope}
                              onLoadChildren={fetchQaKnowledgeTreeChildren}
                              onLoadFolderStats={fetchQaKnowledgeFolderStats}
                              onSearchFiles={searchQaKnowledgeFiles}
                              onTip={setQaTip}
                              onClose={() => setQaPickerOpen(false)}
                              maxHeight={qaPickerPos.maxHeight}
                            />
                          </div>,
                          document.body,
                        )
                        : null}
                      {qaKbHintOpen && qaKbHintPos && !qaPickerOpen
                        ? createPortal(
                          <div
                            className={s.qaKbHintBubble}
                            style={{ position: 'fixed', left: qaKbHintPos.left, top: qaKbHintPos.top } as CSSProperties}
                            role="note"
                          >
                            <span className={s.qaKbHintText}>{QA_KB_HINT_TEXT}</span>
                            <button
                              type="button"
                              className={s.qaKbHintClose}
                              onClick={() => { dismissQaKbHint(user?.account); setQaKbHintOpen(false); }}
                              aria-label="关闭提示"
                            >
                              <X size={12} />
                            </button>
                          </div>,
                          document.body,
                        )
                        : null}
                    </div>
                    {qaTip ? <span className={s.qaTip}>{qaTip}</span> : null}
                  </div>
                )}
                <button
                  type="button"
                  className={s.searchBtn}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSearch();
                  }}
                  aria-label={searchTab === 'qa' ? '发送' : '搜索'}
                >
                  {searchTab === 'qa' ? <Send size={17} /> : <Search size={18} />}
                </button>
              </div>
            </div>
            {showHotTagMenu && showHotSearch ? (
              <div id="home-hot-tag-menu" className={s.hotSearchMenu}>
                <div className={s.hotSearchTags}>
                  {displayHotQueries.map((question) => (
                    <button
                      key={question}
                      type="button"
                      className={s.hotSearchTag}
                      onClick={() => {
                        setShowHotTagMenu(false);
                        setQuery(question);
                        if (user) {
                          void recordPortalSearchEvent(question, 'home_hot_keyword').catch(() => undefined);
                        }
                        navigate(`/search?q=${encodeURIComponent(question)}`);
                      }}
                    >
                      <span className={s.hotSearchTagText}>{question}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className={s.heroBottomRow} onClick={(event) => event.stopPropagation()}>
            <div className={s.appShortcutList}>
              {appEntryItems.map((template) => {
                const iconImage =
                  template.home_icon ||
                  APP_SHORTCUT_IMAGES[template.id] ||
                  APP_ICON_IMAGES[template.icon];
                const AppIcon = APP_ICONS[template.icon] || Bot;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={s.appShortcut}
                    onClick={(event) => {
                      event.stopPropagation();
                      const path = `/apps?tab=qa&templateId=${encodeURIComponent(template.id)}`;
                      if (user) navigate(path);
                      else triggerLoginRedirect(path);
                    }}
                  >
                    <span className={s.appShortcutIcon}>
                      {iconImage ? (
                        <img src={iconImage} alt="" className={s.appShortcutImage} />
                      ) : (
                        <AppIcon size={20} />
                      )}
                    </span>
                    <span className={s.appShortcutText}>{template.name}</span>
                  </button>
                );
              })}
            </div>
            <div className={s.heroStatsPanel}>
              <div className={s.statsGrid}>
                {heroStats.map((stat) => (
                  <div key={`${stat.value}-${stat.label}`} className={s.statCard}>
                    <span className={s.statNumber}>{stat.value}</span>
                    <span className={s.statLabel}>{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className={s.bannerDots}>
            {homeBanners.map((_, i) => (
              <button
                key={i}
                className={`${s.dot} ${i === safeBannerIdx ? s.dotActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setBannerIdx(i);
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Main content */}
      <TooltipProvider delayDuration={100}>
        <div className={s.container}>
        {/* Domain navigation */}
        <div className={`${s.section} ${s.domainSection}`}>
          <div className={`${s.domainHeader} ${showCategoryTab ? s.domainHeaderWithTabs : ''}`}>
            {showCategoryTab ? (
              <div className={s.domainNavTabs} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeNavTab === 'category'}
                  className={`${s.domainNavTab} ${activeNavTab === 'category' ? s.domainNavTabActive : ''}`}
                  onClick={() => setNavTab('category')}
                >
                  <img
                    src={activeNavTab === 'category' ? navTabCategoryActive : navTabCategoryInactive}
                    alt=""
                    className={s.domainNavTabIcon}
                  />
                  <span className={s.domainNavTabText}>分类导航</span>
                </button>
                <span className={s.domainNavTabDivider} aria-hidden />
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeNavTab === 'domain'}
                  className={`${s.domainNavTab} ${activeNavTab === 'domain' ? s.domainNavTabActive : ''}`}
                  onClick={() => setNavTab('domain')}
                >
                  <img
                    src={activeNavTab === 'domain' ? navTabDomainActive : navTabDomainInactive}
                    alt=""
                    className={s.domainNavTabIcon}
                  />
                  <span className={s.domainNavTabText}>业务域导航</span>
                </button>
              </div>
            ) : (
              <>
                <img src={navIcon} alt="" className={s.domainHeaderIcon} />
                <span className={s.domainHeaderTitle}>业务域导航</span>
              </>
            )}
          </div>
          <div className={s.domainCarousel}>
            <button
              type="button"
              className={`${s.domainArrow} ${s.domainArrowLeft} ${domainScrollState.atStart ? s.domainArrowDisabled : ''}`}
              aria-label="向左滚动业务域"
              onClick={() => scrollDomains(-1)}
              disabled={domainScrollState.atStart}
            >
              <ChevronLeft size={22} />
            </button>
            <div
              ref={domainScrollRef}
              className={s.domainGrid}
              onPointerDown={handleDomainPointerDown}
              onPointerMove={handleDomainPointerMove}
              onPointerUp={handleDomainPointerUp}
              onPointerLeave={handleDomainPointerCancel}
              onPointerCancel={handleDomainPointerCancel}
            >
              {activeNavTab === 'category'
                ? homeCategoryCards.map((card) => {
                    const categoryPath = buildCategorySearchPath(card.code);
                    const usesBannerThumb = Boolean(card.image);
                    return (
                      <div
                        key={card.code}
                        className={`${s.domainCard} ${usesBannerThumb ? s.domainCardImage : ''}`}
                        style={usesBannerThumb ? { backgroundImage: `url("${card.image}")` } : undefined}
                        data-domain-path={categoryPath}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigateToTop(categoryPath);
                          }
                        }}
                      >
                        {usesBannerThumb ? null : (
                          <div className={s.domainIcon} style={{ background: '#eff6ff', color: '#2563eb' }}>
                            <Settings size={20} />
                          </div>
                        )}
                        <div className={s.domainCardContent}>
                          <div className={s.domainName}>{card.name || card.code}</div>
                        </div>
                      </div>
                    );
                  })
                : homeDomains.map((d) => {
                    const Icon = DOMAIN_ICONS[d.icon] || Settings;
                    const visualPreset = getDomainVisualPreset(d);
                    const domainBackground = visualPreset.backgroundImage;
                    const usesBannerThumb = Boolean(domainBackground);
                    const totalFiles = domainTotals.get(d.name) ?? 0;
                    return (
                      <div
                        key={d.name}
                        className={`${s.domainCard} ${usesBannerThumb ? s.domainCardImage : ''}`}
                        style={usesBannerThumb ? { backgroundImage: `url("${domainBackground}")` } : undefined}
                        data-domain-path={buildDomainSearchPath(d.name)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigateToTop(buildDomainSearchPath(d.name));
                          }
                        }}
                      >
                        {usesBannerThumb ? null : (
                          <div className={s.domainIcon} style={{ background: d.bg, color: d.color }}>
                            <Icon size={20} />
                          </div>
                        )}
                        <div className={s.domainCardContent}>
                          <div className={s.domainName}>{d.name}</div>
                          <div className={s.domainMeta}>知识数量 {domainCountsLoading ? '加载中…' : formatCount(totalFiles)}</div>
                        </div>
                      </div>
                    );
                  })}
            </div>
            <button
              type="button"
              className={`${s.domainArrow} ${s.domainArrowRight} ${domainScrollState.atEnd ? s.domainArrowDisabled : ''}`}
              aria-label="向右滚动业务域"
              onClick={() => scrollDomains(1)}
              disabled={domainScrollState.atEnd}
            >
              <ChevronRight size={22} />
            </button>
          </div>
        </div>

        {/* Two-column layout */}
        <div className={s.columns}>
          {/* Left: knowledge list panels */}
          <div className={s.leftColumn}>
            {contentSections.map((sec, index) => {
              const sectionKey = getHomeSectionKey(sec);
              const fetchedItems = sectionData[sectionKey] || [];
              const items = fetchedItems;
              const showLoading = sectionDataLoading && !loadedSectionTags.has(sectionKey);
              const recommendationMode = sectionRecommendationModes[sectionKey];
              const recommendationModePending = isLatestSelectedSection(sec) && !recommendationMode;
              const moreLink = buildSectionMoreLink(sec, recommendationMode);
              // 需要参与「左右高度补长」的左侧板块
              const isLeftFillPanel = /知识推荐|典型案例/.test(sec.title);
              // 「知识推荐」「典型案例」「行业情报」摘要开启 hover 全文提示浮窗
              const enableSummaryTooltip = /知识推荐|典型案例|行业情报/.test(sec.title);
              return (
                <div
                  key={sectionKey}
                  className={`${s.panel} ${index === 0 ? s.primarySectionPanel : s.tallSectionPanel} ${isLeftFillPanel ? s.leftFillPanel : ''}`}
                >
                  <div className={`${s.panelHeader} ${resolveSectionHeaderClass(sec.title)}`}>
                    <div className={s.panelHeaderLeft}>
                      <img src={resolveSectionIcon(sec.title)} alt="" className={s.panelIconImg} />
                      <span className={s.panelTitle}>{sec.title}</span>
                    </div>
                    {recommendationModePending ? (
                      <span className={`${s.panelMore} ${s.panelMoreDisabled}`} aria-disabled="true">
                        更多 <ChevronRight size={14} />
                      </span>
                    ) : (
                      <Link
                        to={moreLink}
                        className={s.panelMore}
                        onClick={(event) => {
                          if (user) return;
                          event.preventDefault();
                          triggerLoginRedirect(moreLink);
                        }}
                      >
                        更多 <ChevronRight size={14} />
                      </Link>
                    )}
                  </div>
                  <div className={s.sectionList}>
                    {showLoading ? (
                      <div className={s.sectionLoading} role="status" aria-live="polite">
                        <Loader2 size={18} className={s.sectionLoadingIcon} />
                        <span>加载中</span>
                      </div>
                    ) : (
                      <>
                        {items.map((f) => (
                          <div
                            key={f.id}
                            className={s.listItem}
                            onClick={() => {
                              const target = buildHomeFilePath(f, recommendationMode);
                              if (!user) {
                                triggerLoginRedirect(target);
                                return;
                              }
                              navigate(target, { state: { returnTo: moreLink } });
                            }}
                          >
                            <img src={resolveSectionItemIcon(sec.title)} alt="" className={s.itemIcon} />
                            <div className={s.itemBody}>
                              <div className={s.itemTitle}>{f.title}</div>
                              {(() => {
                                const displaySummary = cleanSummaryText(f.summary);
                                if (enableSummaryTooltip && displaySummary) {
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className={s.itemSummary}>{displaySummary}</div>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" align="start" className={s.summaryTooltip}>
                                        {displaySummary}
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                }
                                return <div className={s.itemSummary}>{displaySummary}</div>;
                              })()}
                            </div>
                            {f.date ? (
                              <span className={s.itemTime}>{formatDisplayDateTime(f.date)}</span>
                            ) : null}
                          </div>
                        ))}
                        {items.length === 0 ? (
                          <div className={s.sectionEmpty}>
                            暂无匹配内容
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

          </div>

          {/* Right column */}
          <div className={s.sideColumn}>
            {/* 专家问答 */}
            <ExpertQuestions className={s.qaPanel} count={displayConfig.home.expertQaCount} />

            {/* 专业课程 · 岗位赋能 */}
            <div className={s.panel}>
              <div className={`${s.panelHeader} ${s.headerCourse}`}>
                <div className={s.panelHeaderLeft}>
                  <img src={iconCourse} alt="" className={s.panelIconImg} />
                  <span className={s.panelTitle}>专业课程 · 岗位赋能</span>
                </div>
                <Link to="/course" className={s.panelMore}>
                  全部课程 <ChevronRight size={14} />
                </Link>
              </div>
              <div className={s.courseList}>
                {homeCourses.slice(0, displayConfig.home.courseCount).map((course) => {
                  const displayTag = course.tags.find((tag) => tag.displayType === 'domain') ?? course.tags[0];
                  return (
                    <button
                      key={course.id}
                      type="button"
                      className={s.courseRow}
                      onClick={() => navigate(`/course/${course.id}`)}
                    >
                      <img src={iconVideo} alt="" className={s.courseRowIcon} />
                      <span className={s.courseRowTitle}>{course.name}</span>
                      {displayTag ? <span className={s.courseDomainTag}>{displayTag.label}</span> : null}
                      <span className={s.courseRowDuration}>{formatCourseDuration(course.totalDurationSeconds)}</span>
                    </button>
                  );
                })}
                {!homeCoursesLoading && homeCourses.length === 0 ? (
                  <div className={s.sectionEmpty}>暂无首页课程</div>
                ) : null}
              </div>
            </div>

            <div className={s.panel}>
              <div className={`${s.panelHeader} ${s.headerRank}`}>
                <div className={s.panelHeaderLeft}>
                  <img src={iconRank} alt="" className={s.panelIconImg} />
                  <span className={s.panelTitle}>积分榜单</span>
                </div>
              </div>

              <div className={s.podium}>
                {POINTS_PODIUM.map((p) => (
                  <div
                    key={p.rank}
                    className={`${s.podiumItem} ${p.rank === 1 ? s.podiumItemFirst : ''}`}
                  >
                    <img src={p.medal} alt={`第${p.rank}名`} className={s.podiumMedal} />
                    <span className={s.podiumName}>{p.name}</span>
                    <span className={s.podiumDept}>{p.dept}</span>
                    <span className={`${s.podiumScore} ${s[`podiumScore_${p.tone}`]}`}>
                      {p.score}
                    </span>
                  </div>
                ))}
              </div>

              <div className={s.rankTable}>
                <div className={s.rankHead}>
                  <span>排名</span>
                  <span>用户</span>
                  <span>部门</span>
                  <span>当前积分</span>
                  <span>本月积分</span>
                </div>
                {POINTS_ROWS.map((r) => (
                  <div key={r.rank} className={s.rankRow}>
                    <span className={s.rankNo}>{r.rank}</span>
                    <span className={s.rankUser}>{r.name}</span>
                    <span className={s.rankDept}>{r.dept}</span>
                    <span className={s.rankScore}>{r.score}</span>
                    <span className={s.rankDelta}>+{r.delta}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {error || loadError ? <div className={s.bottomPad}>{error || loadError}</div> : null}

        <div className={s.bottomPad} />
        </div>
      </TooltipProvider>
    </PageShell>
  );
}
