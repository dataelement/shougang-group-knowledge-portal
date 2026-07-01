import { useState, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search,
  ArrowUp, BarChart3, Bot, ChevronRight, FileText,
  Settings, Factory, Snowflake, Zap, Shield, CheckCircle,
  BriefcaseBusiness, Layers3, PenLine, MessageSquare, Globe, Network, User, Leaf, Truck, Wrench, GraduationCap,
  Sparkles,
  Package, Video, Flame, Briefcase, Users, ScrollText,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import ExpertQuestions from '../components/ExpertQuestions';
import type { DomainConfig, SectionConfig } from '../api/adminConfig';
import {
  fetchHomeContent,
  fetchDomainFileCounts,
  fetchHomeStats,
  streamChatCompletion,
  type FileItem,
  type HomeStats,
} from '../api/content';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import { getEnabledDomains, getEnabledSections, resolveHomeBanners, toRuntimeDisplayConfig } from '../utils/portalConfig';
import { buildDomainSearchPath } from '../utils/searchParams';
import { WIKI_LIST_ITEMS } from '../data/wikiData';
import { COURSE_LIST_ITEMS } from '../data/courseMock';
import s from './HomePage.module.css';
import navIcon from '../assets/nav-icon@2x.png';
import iconCourse from '../assets/icon-course@2x.png';
import iconExpert from '../assets/icon-expert@2x.png';
import iconAiqa from '../assets/icon-aiqa@2x.png';
import iconRank from '../assets/icon-rank@2x.png';
import iconRecommend from '../assets/icon-recommend@2x.png';
import iconIntel from '../assets/icon-intel@2x.png';
import iconFolder from '../assets/icon-folder@2x.png';
import iconHot from '../assets/icon-hot@2x.png';
import { formatDisplayDateTime } from '../utils/dateTime';

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

type HomeQaMessage = {
  role: 'bot' | 'user';
  text: string;
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

const MOCK_HOME_SECTIONS: SectionConfig[] = [
  {
    title: '最新精选',
    tag: '最新精选',
    link: '/list?tag=%E6%9C%80%E6%96%B0%E7%B2%BE%E9%80%89',
    icon: 'Star',
    color: '#2563eb',
    bg: '#eff6ff',
    enabled: true,
  },
  {
    title: '典型案例',
    tag: '典型案例',
    link: '/list?tag=%E5%85%B8%E5%9E%8B%E6%A1%88%E4%BE%8B',
    icon: 'AlertTriangle',
    color: '#dc2626',
    bg: '#fee2e2',
    enabled: true,
  },
];

const MOCK_HOME_SECTION_DATA: Record<string, FileItem[]> = {
  最新精选: [
    {
      id: 91001,
      spaceId: 9003,
      title: '热轧产线设备点检标准化操作指引',
      summary: '覆盖巡检路线、点检频次、异常记录和交接班协同要求，适合设备岗位日常执行和班组培训使用。',
      source: '设备业务域演示空间',
      date: '2026-05-13T09:20:00+08:00',
      tags: ['最新精选', '设备', '点检'],
      tag_infos: [{ tag_name: '最新精选', resource_type: 'manual_tag' }, { tag_name: '设备', resource_type: 'manual_tag' }, { tag_name: '点检', resource_type: 'manual_tag' }],
      ext: 'pdf',
      sizeLabel: '2.4 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 91002,
      spaceId: 9004,
      title: '有限空间作业风险辨识与审批要点',
      summary: '梳理作业前确认、气体检测、监护配置和应急处置的关键控制项。',
      source: '安全业务域演示空间',
      date: '2026-05-12T16:45:00+08:00',
      tags: ['最新精选', '安全生产'],
      tag_infos: [{ tag_name: '最新精选', resource_type: 'manual_tag' }, { tag_name: '安全生产', resource_type: 'manual_tag' }],
      ext: 'docx',
      sizeLabel: '1.1 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 91003,
      spaceId: 9008,
      title: '能源中心日负荷预测数据看板说明',
      summary: '说明关键指标口径、异常波动识别方式和调度联动流程。',
      source: '能源业务域演示空间',
      date: '2026-05-11T10:12:00+08:00',
      tags: ['最新精选', '能源管控'],
      tag_infos: [{ tag_name: '最新精选', resource_type: 'manual_tag' }, { tag_name: '能源管控', resource_type: 'manual_tag' }],
      ext: 'xlsx',
      sizeLabel: '860 KB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 91004,
      spaceId: 9001,
      title: '重点客户技术协议归档与检索规范',
      summary: '统一技术协议命名、版本标识和归档字段，提升营销、质量和研发协同查询效率。',
      source: '营销业务域演示空间',
      date: '2026-05-10T15:18:00+08:00',
      tags: ['最新精选', '营销'],
      tag_infos: [{ tag_name: '最新精选', resource_type: 'manual_tag' }, { tag_name: '营销', resource_type: 'manual_tag' }],
      ext: 'docx',
      sizeLabel: '1.4 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 91005,
      spaceId: 9007,
      title: '生产系统权限申请与变更流程说明',
      summary: '面向生产一线系统账号开通、权限变更和离岗回收场景，明确审批链路和安全审计要求。',
      source: '信息业务域演示空间',
      date: '2026-05-09T09:35:00+08:00',
      tags: ['最新精选', '信息'],
      tag_infos: [{ tag_name: '最新精选', resource_type: 'manual_tag' }, { tag_name: '信息', resource_type: 'manual_tag' }],
      ext: 'pdf',
      sizeLabel: '980 KB',
      fileEncoding: 'UTF-8',
    },
  ],
  典型案例: [
    {
      id: 92001,
      spaceId: 9009,
      title: '高强钢板形波动问题复盘与参数优化',
      summary: '从订单规格、轧制节奏、温控窗口和在线检测数据四个维度复盘板形波动原因，并形成参数优化建议。',
      source: '质量业务域演示空间',
      date: '2026-05-10T14:30:00+08:00',
      tags: ['典型案例', '质量'],
      tag_infos: [{ tag_name: '典型案例', resource_type: 'manual_tag' }, { tag_name: '质量', resource_type: 'manual_tag' }],
      ext: 'pdf',
      sizeLabel: '3.2 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 92002,
      spaceId: 9003,
      title: '加热炉燃烧器异响处置案例',
      summary: '记录异常发现、现场检查、备件替换和复产验证过程，为同类设备故障提供排查路径。',
      source: '设备业务域演示空间',
      date: '2026-05-09T11:05:00+08:00',
      tags: ['典型案例', '设备'],
      tag_infos: [{ tag_name: '典型案例', resource_type: 'manual_tag' }, { tag_name: '设备', resource_type: 'manual_tag' }],
      ext: 'docx',
      sizeLabel: '1.8 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 92003,
      spaceId: 9004,
      title: '检修交叉作业安全协同案例',
      summary: '围绕检修窗口压缩、外协人员交叉进入和风险告知不足等问题，沉淀班前会与现场监护改进项。',
      source: '安全业务域演示空间',
      date: '2026-05-08T08:40:00+08:00',
      tags: ['典型案例', '安全生产'],
      tag_infos: [{ tag_name: '典型案例', resource_type: 'manual_tag' }, { tag_name: '安全生产', resource_type: 'manual_tag' }],
      ext: 'pdf',
      sizeLabel: '2.0 MB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 92004,
      spaceId: 9008,
      title: '空压站能耗异常波动分析案例',
      summary: '通过分时负荷、设备启停和管网压力数据定位异常点，并形成运行策略调整建议。',
      source: '能源业务域演示空间',
      date: '2026-05-07T13:22:00+08:00',
      tags: ['典型案例', '能源管控'],
      tag_infos: [{ tag_name: '典型案例', resource_type: 'manual_tag' }, { tag_name: '能源管控', resource_type: 'manual_tag' }],
      ext: 'xlsx',
      sizeLabel: '760 KB',
      fileEncoding: 'UTF-8',
    },
    {
      id: 92005,
      spaceId: 9002,
      title: '月度成本归集口径差异处理案例',
      summary: '对比产线、班组和科目口径差异，沉淀跨部门成本归集校验清单。',
      source: '财务业务域演示空间',
      date: '2026-05-06T16:10:00+08:00',
      tags: ['典型案例', '财务'],
      tag_infos: [{ tag_name: '典型案例', resource_type: 'manual_tag' }, { tag_name: '财务', resource_type: 'manual_tag' }],
      ext: 'pdf',
      sizeLabel: '1.2 MB',
      fileEncoding: 'UTF-8',
    },
  ],
};

const BANNER_OVERLAY_GRADIENT =
  'linear-gradient(180deg, rgba(43, 118, 246, 0.52) 0%, rgba(59, 143, 246, 0.36) 38%, rgba(22, 98, 178, 0.34) 100%), linear-gradient(90deg, rgba(37, 99, 235, 0.18) 0%, rgba(37, 99, 235, 0.04) 46%, rgba(37, 99, 235, 0.16) 100%)';

function buildBannerBackground(imageUrl: string): string {
  return `${BANNER_OVERLAY_GRADIENT}, url("${imageUrl}")`;
}

function getWelcomeMessage(welcomeMessage?: string) {
  return welcomeMessage?.trim() || '你好，我是首钢股份知库智能助手，请问有什么可以帮您？';
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
  const { config, loading: configLoading, error } = usePortalConfig();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [query, setQuery] = useState('');
  const [qaDraft, setQaDraft] = useState('');
  const [qaMessages, setQaMessages] = useState<HomeQaMessage[]>([]);
  const [qaStreaming, setQaStreaming] = useState(false);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [sectionData, setSectionData] = useState<Record<string, FileItem[]>>({});
  const [sectionDataFailed, setSectionDataFailed] = useState(false);
  const [showHotTagMenu, setShowHotTagMenu] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [domainCounts, setDomainCounts] = useState<Record<string, number>>({});
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [homeStatsFailed, setHomeStatsFailed] = useState(false);
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
      }
    })();
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
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }, [query, navigate]);

  const startQaConversation = useCallback((question?: string) => {
    const text = (question ?? qaDraft).trim();
    if (!text || qaStreaming) return;

    setQaDraft('');
    setQaStreaming(true);
    setQaMessages((prev) => [...prev, { role: 'user', text }, { role: 'bot', text: '' }]);

    void streamChatCompletion({
      scene: 'qa',
      entryPoint: 'home_qa',
      text,
      knowledgeSpaceIds: config?.qa.knowledge_space_ids ?? [],
      onUpdate(currentText) {
        setQaMessages((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx < 0 || next[lastIdx].role !== 'bot') return prev;
          next[lastIdx] = { ...next[lastIdx], text: currentText };
          return next;
        });
      },
    }).catch(() => {
      setQaMessages((prev) => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (lastIdx < 0 || next[lastIdx].role !== 'bot') return prev;
        next[lastIdx] = { ...next[lastIdx], text: '问答请求失败，请稍后重试。' };
        return next;
      });
    }).finally(() => {
      setQaStreaming(false);
    });
  }, [config?.qa.knowledge_space_ids, qaDraft, qaStreaming]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowHotTagMenu(false);
      return;
    }
    if (e.key === 'Enter') handleSearch();
  };

  const enabledDomains = useMemo(() => (config ? getEnabledDomains(config.domains, config.spaces) : []), [config]);
  const enabledSections = useMemo(() => (config ? getEnabledSections(config.sections) : []), [config]);

  useEffect(() => {
    let active = true;
    if (!config) return () => {
      active = false;
    };

    setSectionDataFailed(false);
    void (async () => {
      try {
        const homeContent = await fetchHomeContent();
        if (!active) return;
        setSectionData(homeContent.sections);
        setSectionDataFailed(false);
        setLoadError('');
      } catch (err) {
        if (!active) return;
        setSectionDataFailed(true);
        setLoadError(err instanceof Error ? err.message : '首页数据加载失败');
      }
    })();

    return () => {
      active = false;
    };
  }, [config]);

  /* Stats */
  const activeBanner = homeBanners[safeBannerIdx] ?? homeBanners[0];
  const configuredHomeDomains = enabledDomains.slice(0, displayConfig.home.domainCount);
  const useMockShellContent = !config && !configLoading;
  const useMockHomeContent = useMockShellContent || sectionDataFailed;
  const isUsingMockDomains = useMockShellContent && configuredHomeDomains.length === 0;
  const homeDomains = isUsingMockDomains ? MOCK_DOMAIN_NAV_ITEMS : configuredHomeDomains;
  const domainTotals = isUsingMockDomains ? MOCK_DOMAIN_STATS : new Map(homeDomains.map((domain) => {
    const code = (domain.code || '').trim().toUpperCase();
    return [domain.name, code ? (domainCounts[code] ?? 0) : 0] as [string, number];
  }));
  const homeSections = (useMockHomeContent ? MOCK_HOME_SECTIONS : enabledSections).slice(0, 3);
  const contentSections = homeSections;
  const assistantGreeting = getWelcomeMessage(config?.qa.welcome_message);
  const qaHotQuestions = (config?.qa.hot_questions || []).map((question) => question.trim()).filter(Boolean);
  const primaryQaQuestion = qaHotQuestions[0] || '振动纹通常如何排查？';
  const qaPreviewMessages = qaMessages.length > 0
    ? qaMessages
    : [
      { role: 'bot' as const, text: assistantGreeting },
      { role: 'user' as const, text: primaryQaQuestion },
      { role: 'bot' as const, text: '建议先核对轧机、卷取机和传动系统的振动趋势，再结合钢卷位置、速度段和设备点检记录定位异常来源。' },
    ];

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
            <div className={s.searchBox}>
              <button
                type="button"
                className={`${s.searchModeBtn} ${showHotTagMenu ? s.searchModeBtnActive : ''}`}
                aria-expanded={showHotTagMenu}
                aria-controls="home-hot-tag-menu"
                onClick={() => setShowHotTagMenu((open) => !open)}
              >
                <img src={iconHot} alt="" className={s.searchModeIcon} />
                <span>热门搜索</span>
                <ChevronRight size={10} className={s.searchModeCaret} />
              </button>
              <input
                className={s.searchInput}
                placeholder="输入关键词搜索知识文档"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
              />
              <button
                type="button"
                className={s.searchBtn}
                onClick={(event) => {
                  event.stopPropagation();
                  handleSearch();
                }}
              >
                <Search size={18} />
              </button>
            </div>
            {showHotTagMenu ? (
              <div id="home-hot-tag-menu" className={s.hotSearchMenu}>
                {qaHotQuestions.length > 0 ? (
                  <div className={s.hotSearchTags}>
                    {qaHotQuestions.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className={s.hotSearchTag}
                        onClick={() => {
                          setShowHotTagMenu(false);
                          navigate(`/search?q=${encodeURIComponent(question)}`);
                        }}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={s.hotSearchEmpty}>暂无热门问题</div>
                )}
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
                      navigate(`/apps?tab=qa&templateId=${encodeURIComponent(template.id)}`);
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
      <div className={s.container}>
        {/* Domain navigation */}
        <div className={`${s.section} ${s.domainSection}`}>
          <div className={s.domainHeader}>
            <img src={navIcon} alt="" className={s.domainHeaderIcon} />
            <span className={s.domainHeaderTitle}>业务域导航</span>
          </div>
          <div className={s.domainCarousel}>
            <div
              className={s.domainGrid}
              style={homeDomains.length > 0 ? { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' } : undefined}
            >
              {homeDomains.map((d) => {
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
                    onClick={() => {
                      navigateToTop(buildDomainSearchPath(d.name));
                    }}
                  >
                    {usesBannerThumb ? null : (
                      <div className={s.domainIcon} style={{ background: d.bg, color: d.color }}>
                        <Icon size={20} />
                      </div>
                    )}
                    <div className={s.domainCardContent}>
                      <div className={s.domainName}>{d.name}</div>
                      <div className={s.domainMeta}>知识数量 {formatCount(totalFiles)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className={s.columns}>
          {/* Left: knowledge list panels */}
          <div className={s.leftColumn}>
            {contentSections.map((sec, index) => {
              const fetchedItems = sectionData[sec.tag] || [];
              const items = useMockHomeContent ? (MOCK_HOME_SECTION_DATA[sec.tag] || []) : fetchedItems;
              return (
                <div
                  key={sec.tag}
                  className={`${s.panel} ${index === 0 ? s.primarySectionPanel : s.tallSectionPanel}`}
                >
                  <div className={s.panelHeader}>
                    <div className={s.panelHeaderLeft}>
                      <img src={resolveSectionIcon(sec.title)} alt="" className={s.panelIconImg} />
                      <span className={s.panelTitle}>{sec.title}</span>
                    </div>
                    <Link
                      to={`${sec.link}${sec.link.includes('?') ? '&' : '?'}title=${encodeURIComponent(sec.title)}`}
                      className={s.panelMore}
                    >
                      更多 <ChevronRight size={14} />
                    </Link>
                  </div>
                  <div className={s.sectionList}>
                    {items.map((f) => (
                      <div
                        key={f.id}
                        className={s.listItem}
                        onClick={() =>
                          navigate(`/space/${f.spaceId}/file/${f.id}`, {
                            state: { returnTo: sec.link },
                          })}
                      >
                        <div className={s.itemTitle}>{f.title}</div>
                        <div className={s.itemSubRow}>
                          <span className={s.itemSummary}>
                            {f.summary ? `【摘要】${f.summary}` : ''}
                          </span>
                          {f.date ? (
                            <span className={s.itemTime}>{formatDisplayDateTime(f.date)}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {items.length === 0 ? (
                      <div className={s.sectionEmpty}>
                        暂无匹配内容
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* 专业课程 · 岗位赋能 */}
            <div className={s.panel}>
              <div className={s.panelHeader}>
                <div className={s.panelHeaderLeft}>
                  <img src={iconCourse} alt="" className={s.panelIconImg} />
                  <span className={s.panelTitle}>专业课程 · 岗位赋能</span>
                </div>
                <Link to="/course" className={s.panelMore}>
                  全部课程 <ChevronRight size={14} />
                </Link>
              </div>
              <div className={s.courseList}>
                {COURSE_LIST_ITEMS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={s.courseRow}
                    onClick={() => navigate(`/course/${c.id}`)}
                  >
                    <Video size={22} className={s.courseRowIcon} />
                    <span className={s.courseRowTitle}>{c.title}</span>
                    {c.hot ? (
                      <span className={s.courseHotTag}>
                        <Flame size={10} />热门
                      </span>
                    ) : c.domain ? (
                      <span className={s.courseDomainTag}>{c.domain}</span>
                    ) : null}
                    <span className={s.courseRowDuration}>{c.duration}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className={s.sideColumn}>
            {/* 智能问答 */}
            <div className={`${s.qaPanel} ${s.aiQaPanel}`}>
              <div className={s.qaHeader}>
                <div className={s.qaHeaderLeft}>
                  <img src={iconAiqa} alt="" className={s.panelIconImg} />
                  <span className={s.panelTitle}>智能问答</span>
                </div>
                <Link to="/apps?tab=qa" className={s.panelMore}>
                  进入 <ChevronRight size={14} />
                </Link>
              </div>
              <div className={s.qaComposerWrap}>
                <div className={s.qaPreview}>
                  {qaPreviewMessages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const isSuggestion = qaMessages.length === 0 && isUser;
                    const isThinking = qaStreaming && !isUser && index === qaPreviewMessages.length - 1 && !message.text.trim();
                    return (
                      <div
                        key={`${message.role}-${index}`}
                        className={`${s.qaPreviewRow} ${isUser ? s.qaPreviewRowUser : ''}`}
                      >
                        {!isUser ? (
                          <div className={s.qaComposerAvatar}>
                            <Bot size={16} />
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className={isUser ? s.qaUserBubble : s.qaComposerBubble}
                          onClick={isSuggestion ? () => startQaConversation(message.text) : undefined}
                          disabled={!isSuggestion}
                        >
                          {isThinking ? '思考中...' : message.text}
                        </button>
                        {isUser ? (
                          <div className={`${s.qaComposerAvatar} ${s.qaComposerAvatarUser}`}>
                            <User size={16} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <form
                  className={s.qaPromptBox}
                  onSubmit={(event) => {
                    event.preventDefault();
                    startQaConversation();
                  }}
                >
                  <input
                    className={s.qaPromptInput}
                    value={qaDraft}
                    onChange={(event) => setQaDraft(event.target.value)}
                    placeholder="请输入您的问题"
                    aria-label="请输入您的问题"
                    disabled={qaStreaming}
                  />
                  <button type="submit" className={s.qaPromptSend} aria-label="发送问题" disabled={qaStreaming}>
                    <ArrowUp size={14} />
                  </button>
                </form>
              </div>
              <div className={s.qaCallout}>
                <Sparkles size={13} />
                <span>支持流式回复 · 引用知识库来源 · 多轮追问</span>
              </div>
            </div>

            {/* 专家问答 */}
            <ExpertQuestions className={s.qaPanel} />

            <div className={s.panel}>
              <div className={s.panelHeader}>
                <div className={s.panelHeaderLeft}>
                  <img src={iconRank} alt="" className={s.panelIconImg} />
                  <span className={s.panelTitle}>股份百科 · 知识产品</span>
                </div>
                <Link to="/wiki" className={s.panelMore}>
                  更多词条 <ChevronRight size={14} />
                </Link>
              </div>
              <div className={s.wikiList}>
                {WIKI_LIST_ITEMS.slice(0, 5).map((item) => (
                  <Link key={item.id} to={`/wiki/${item.id}`} className={s.wikiRow}>
                    <Package size={22} className={s.wikiRowIcon} />
                    <span className={s.wikiRowName}>{item.name}</span>
                    <span className={s.wikiCatTag}>{item.domain}</span>
                  </Link>
                ))}
              </div>
            </div>

          </div>
        </div>

        {error || loadError ? <div className={s.bottomPad}>{error || loadError}</div> : null}

        <div className={s.bottomPad} />
      </div>
    </PageShell>
  );
}
