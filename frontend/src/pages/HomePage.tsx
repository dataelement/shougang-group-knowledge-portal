import { useState, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Search, Building, Star, AlertTriangle, LayoutGrid,
  ArrowUp, BarChart3, Bot, ChevronLeft, ChevronRight, FileText, Tag,
  Settings, Factory, Snowflake, Zap, Shield, CheckCircle,
  PenLine, MessageSquare, Globe, Network, User, Leaf, Truck, Wrench, GraduationCap,
  Award, MessageSquarePlus, Sparkles,
  BookOpen, Package, Video, Flame, Briefcase, Users,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import SectionHeader from '../components/SectionHeader';
import TagPill from '../components/TagPill';
import type { DomainConfig, SectionConfig } from '../api/adminConfig';
import { fetchAggregatedTags, searchFiles, type FileItem } from '../api/content';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { resolveSectionVisual } from '../utils/adminSections';
import { formatDisplayDateTime } from '../utils/dateTime';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import { getEnabledApps, getEnabledDomains, getEnabledSections, getEnabledSpaces, resolveHomeBanners, toRuntimeDisplayConfig } from '../utils/portalConfig';
import { WIKI_LIST_ITEMS } from '../data/wikiData';
import { COURSE_LIST_ITEMS } from '../data/courseMock';
import s from './HomePage.module.css';

const DOMAIN_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Settings, Factory, Snowflake, Zap, Shield, CheckCircle, Leaf, Truck, Network, Wrench, GraduationCap,
  Briefcase, Users,
};

const APP_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  PenLine, Search, MessageSquare, Globe, BarChart3, Network, FileText, Bot,
};

const SECTION_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Star, AlertTriangle, BarChart3, LayoutGrid,
};

const DOMAIN_PAGE_SIZE = 4;

const MOCK_HOT_TAGS = [
  '安全生产',
  '设备点检',
  '环保排放',
  '炼铁工艺',
  '质量事故',
  '能源管控',
  '制度规范',
  '典型案例',
];

const MOCK_DOMAIN_NAV_ITEMS: DomainConfig[] = [
  {
    name: '钢铁智造',
    space_ids: [],
    color: '#2563eb',
    bg: '#eff6ff',
    icon: 'Factory',
    background_image: '/production-domain-bg.jpg',
    enabled: true,
  },
  {
    name: '设备工程',
    space_ids: [],
    color: '#0891b2',
    bg: '#ecfeff',
    icon: 'Wrench',
    background_image: '/device-domain-bg.png',
    enabled: true,
  },
  {
    name: '安全环保',
    space_ids: [],
    color: '#059669',
    bg: '#ecfdf5',
    icon: 'Shield',
    background_image: '/safety-domain-bg.png',
    enabled: true,
  },
  {
    name: '经营管理',
    space_ids: [],
    color: '#7c3aed',
    bg: '#f5f3ff',
    icon: 'Briefcase',
    background_image: '/management-domain-bg.png',
    enabled: true,
  },
  {
    name: '能源动力',
    space_ids: [],
    color: '#d97706',
    bg: '#fffbeb',
    icon: 'Zap',
    background_image: '/energy-domain-bg.jpg',
    enabled: true,
  },
];

const MOCK_DOMAIN_STATS = new Map([
  ['钢铁智造', { files: 236, tags: 38 }],
  ['设备工程', { files: 184, tags: 27 }],
  ['安全环保', { files: 156, tags: 24 }],
  ['经营管理', { files: 128, tags: 19 }],
  ['能源动力', { files: 92, tags: 16 }],
]);

const MOCK_HOME_SECTIONS: SectionConfig[] = [
  {
    title: '知识推荐 · 最新精选',
    tag: '知识推荐',
    link: '/list?tag=%E7%9F%A5%E8%AF%86%E6%8E%A8%E8%8D%90',
    icon: 'BarChart3',
    color: '#2563eb',
    bg: '#eff6ff',
    enabled: true,
  },
  {
    title: '行业情报 · 趋势分析',
    tag: '行业情报',
    link: '/list?tag=%E8%A1%8C%E4%B8%9A%E6%83%85%E6%8A%A5',
    icon: 'LayoutGrid',
    color: '#2563eb',
    bg: '#eff6ff',
    enabled: true,
  },
];

const MOCK_SECTION_DATA: Record<string, FileItem[]> = {
  知识推荐: Array.from({ length: 4 }, (_, index) => ({
    id: 9000 + index,
    spaceId: 0,
    title: '固体废物鉴别标准 通则',
    summary: '',
    source: 'mock',
    date: '2026-05-05T14:36:00+08:00',
    tags: index % 2 === 0 ? ['知识推荐', '热门'] : ['知识推荐'],
    ext: 'pdf',
    sizeLabel: '',
    fileEncoding: '',
  })),
  行业情报: Array.from({ length: 4 }, (_, index) => ({
    id: 9100 + index,
    spaceId: 0,
    title: '钢铁工业烧结废气超低排放治理工程技术规范',
    summary: '【文档类型】：规范制度  【摘要】：本标准《钢铁工业烧结废气超低排放治理工程技术规范》（HJ 1408-2024）由生态环境部发布，旨在规范钢铁工业烧结废气超低排放治理工程的设计、施工、验收和运行维护，以达到环保要求。标准详细规定了烧结废气污染物的来源、分级治理路径与运行维护要点。',
    source: 'mock',
    date: '2026-05-05T14:40:00+08:00',
    tags: ['行业情报'],
    ext: 'pdf',
    sizeLabel: '',
    fileEncoding: '',
  })),
};

const BANNER_OVERLAY_GRADIENT =
  'linear-gradient(180deg, rgba(43, 118, 246, 0.52) 0%, rgba(59, 143, 246, 0.36) 38%, rgba(22, 98, 178, 0.34) 100%), linear-gradient(90deg, rgba(37, 99, 235, 0.18) 0%, rgba(37, 99, 235, 0.04) 46%, rgba(37, 99, 235, 0.16) 100%)';

function buildBannerBackground(imageUrl: string): string {
  return `${BANNER_OVERLAY_GRADIENT}, url("${imageUrl}")`;
}

const APP_ENTRY_DEFAULTS = [
  { id: 'app-write', name: '智能写作', desc: '辅助生成报告', iconBg: '#eff6ff', iconColor: '#2563eb', icon: 'PenLine' as const },
  { id: 'app-search', name: '全域检索', desc: '跨空间定位', iconBg: '#ecfeff', iconColor: '#0891b2', icon: 'Search' as const },
  { id: 'app-qa', name: '智能问答', desc: 'AI 即时解答', iconBg: '#f5f3ff', iconColor: '#7c3aed', icon: 'MessageSquare' as const },
  { id: 'app-bi', name: '数据看板', desc: '关键指标可视化', iconBg: '#ecfdf5', iconColor: '#059669', icon: 'BarChart3' as const },
];

function getPrimaryTag(file: FileItem) {
  return file.tags.find((t) => t !== '最新精选' && t !== '典型案例');
}

function getWelcomeMessage(welcomeMessage?: string) {
  return welcomeMessage?.trim() || '你好，我是首钢知库智能助手，请问有什么可以帮您？';
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
  const { config, error } = usePortalConfig();
  const displayConfig = toRuntimeDisplayConfig(config?.display);
  const [query, setQuery] = useState('');
  const [bannerIdx, setBannerIdx] = useState(0);
  const [domainPage, setDomainPage] = useState(0);
  const [sectionData, setSectionData] = useState<Record<string, FileItem[]>>({});
  const [hotTags, setHotTags] = useState<string[]>([]);
  const [showHotTagMenu, setShowHotTagMenu] = useState(false);
  const [loadError, setLoadError] = useState('');
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

  const handleSearch = useCallback(() => {
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }, [query, navigate]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowHotTagMenu(false);
      return;
    }
    if (e.key === 'Enter') handleSearch();
  };

  const enabledSpaces = useMemo(() => (config ? getEnabledSpaces(config.spaces) : []), [config]);
  const enabledDomains = useMemo(() => (config ? getEnabledDomains(config.domains, config.spaces) : []), [config]);
  const enabledSections = useMemo(() => (config ? getEnabledSections(config.sections) : []), [config]);
  const enabledApps = useMemo(() => (config ? getEnabledApps(config.apps) : []), [config]);
  const enabledSpaceIds = useMemo(() => enabledSpaces.map((space) => space.id), [enabledSpaces]);

  useEffect(() => {
    let active = true;
    if (!config) return () => {
      active = false;
    };

    void (async () => {
      try {
        const [sectionResults, tagResults] = await Promise.all([
          Promise.all(
            enabledSections.map(async (section) => [
              section.tag,
              await searchFiles({
                tag: section.tag,
                spaceIds: enabledSpaceIds,
                pageSize: displayConfig.home.sectionPageSize,
              }),
            ] as const),
          ),
          fetchAggregatedTags(enabledSpaceIds),
        ]);
        if (!active) return;
        setSectionData(
          Object.fromEntries(sectionResults.map(([tag, result]) => [tag, result.data])),
        );
        setHotTags(tagResults);
        setLoadError('');
      } catch (err) {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : '首页数据加载失败');
      }
    })();

    return () => {
      active = false;
    };
  }, [config, displayConfig.home.sectionPageSize, enabledSections, enabledSpaceIds]);

  /* Stats */
  const totalFiles = enabledSpaces.reduce((total, space) => total + space.file_count, 0);
  const activeBanner = homeBanners[safeBannerIdx] ?? homeBanners[0];
  const configuredHomeDomains = enabledDomains.slice(0, displayConfig.home.domainCount);
  const isUsingMockDomains = configuredHomeDomains.length === 0;
  const homeDomains = isUsingMockDomains ? MOCK_DOMAIN_NAV_ITEMS : configuredHomeDomains;
  const domainPageCount = Math.max(1, Math.ceil(homeDomains.length / DOMAIN_PAGE_SIZE));
  const safeDomainPage = domainPage % domainPageCount;
  const visibleDomains = homeDomains.slice(safeDomainPage * DOMAIN_PAGE_SIZE, safeDomainPage * DOMAIN_PAGE_SIZE + DOMAIN_PAGE_SIZE);
  const spaceById = new Map(enabledSpaces.map((space) => [space.id, space]));
  const domainStats = isUsingMockDomains ? MOCK_DOMAIN_STATS : new Map(homeDomains.map((domain) => {
    const spaces = domain.space_ids.flatMap((spaceId) => {
      const space = spaceById.get(spaceId);
      return space ? [space] : [];
    });
    return [
      domain.name,
      {
        files: spaces.reduce((total, space) => total + space.file_count, 0),
        tags: spaces.reduce((total, space) => total + space.tag_count, 0),
      },
    ];
  }));
  const rankedHotTags = (hotTags.length > 0 ? hotTags : MOCK_HOT_TAGS).slice(0, displayConfig.home.hotTagsCount);
  const tagRankList = rankedHotTags.slice(0, 6);
  const homeSections = enabledSections.slice(0, 3);
  const hasSectionContent = homeSections.some((section) => (sectionData[section.tag] || []).length > 0);
  const isUsingMockSections = homeSections.length === 0 || !hasSectionContent;
  const contentSections = isUsingMockSections ? MOCK_HOME_SECTIONS : homeSections;
  const homeApps = enabledApps.slice(0, displayConfig.home.appsCount);
  const assistantGreeting = getWelcomeMessage(config?.qa.welcome_message);
  const qaHotQuestions = (config?.qa.hot_questions || []).map((question) => question.trim()).filter(Boolean);
  const primaryQaQuestion = qaHotQuestions[0] || '振动纹通常如何排查？';

  const expertQuestionFallbacks = [
    '振动纹通常如何排查？',
    '热轧精轧机轴承维护周期是多久？',
    '冷轧板面缺陷有哪些常见类型？',
    '振动纹通常如何排查？',
    '热轧精轧机轴承维护周期是多久？',
    '冷轧板面缺陷有哪些常见类型？',
    '振动纹通常如何排查？',
  ];
  const expertHotQuestions = [...qaHotQuestions, ...expertQuestionFallbacks].slice(0, 7);

  const appEntryItems = homeApps.length > 0
    ? homeApps.slice(0, 4).map((app) => ({
      id: String(app.id),
      name: app.name,
      desc: app.desc,
      iconKey: app.icon,
      iconBg: app.color,
      iconColor: '#fff',
      url: app.url,
    }))
    : APP_ENTRY_DEFAULTS.map((entry) => ({
      id: entry.id,
      name: entry.name,
      desc: entry.desc,
      iconKey: entry.icon,
      iconBg: entry.iconBg,
      iconColor: entry.iconColor,
      url: undefined as string | undefined,
    }));
  const heroStats = [
    { value: formatCount(totalFiles), label: '篇文档' },
    { value: '1.17亿', label: '次阅读' },
    { value: '163万', label: '次点赞' },
    { value: '1101万', label: '条评论' },
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
                <Flame size={13} />
                <span>热门搜索</span>
                <ChevronRight size={12} className={s.searchModeCaret} />
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
                {rankedHotTags.length > 0 ? (
                  <div className={s.hotSearchTags}>
                    {rankedHotTags.map((tagName) => (
                      <button
                        key={tagName}
                        type="button"
                        className={s.hotSearchTag}
                        onClick={() => {
                          setShowHotTagMenu(false);
                          navigate(`/list?tag=${encodeURIComponent(tagName)}`);
                        }}
                      >
                        {tagName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={s.hotSearchEmpty}>暂无热门标签</div>
                )}
              </div>
            ) : null}
          </div>
          <div className={s.heroBottomRow} onClick={(event) => event.stopPropagation()}>
            <div className={s.appShortcutList}>
              {appEntryItems.map((app) => {
                const AppIcon = APP_ICONS[app.iconKey] || Bot;
                return (
                  <button
                    key={app.id}
                    type="button"
                    className={s.appShortcut}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (app.url) {
                        window.open(app.url, '_blank', 'noopener,noreferrer');
                      } else {
                        navigate('/apps');
                      }
                    }}
                  >
                    <span className={s.appShortcutIcon}>
                      <AppIcon size={13} />
                    </span>
                    <span className={s.appShortcutText}>{app.name}</span>
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
          <SectionHeader icon={Building} title="业务域导航" size="large" />
          <div className={s.domainCarousel}>
            {homeDomains.length > DOMAIN_PAGE_SIZE && (
              <button
                type="button"
                className={`${s.domainArrow} ${s.domainArrowLeft}`}
                aria-label="上一组业务域"
                onClick={() => setDomainPage((current) => (current + domainPageCount - 1) % domainPageCount)}
              >
                <ChevronLeft size={22} />
              </button>
            )}
            <div className={s.domainGrid}>
              {visibleDomains.map((d) => {
                const Icon = DOMAIN_ICONS[d.icon] || Settings;
                const visualPreset = getDomainVisualPreset(d);
                const domainBackground = visualPreset.backgroundImage;
                const usesBannerThumb = Boolean(domainBackground);
                const stats = domainStats.get(d.name) ?? { files: 0, tags: 0 };
                return (
                  <div
                    key={d.name}
                    className={`${s.domainCard} ${usesBannerThumb ? s.domainCardImage : ''}`}
                    style={usesBannerThumb ? { backgroundImage: `url("${domainBackground}")` } : undefined}
                    onClick={() => navigateToTop(`/domain/${encodeURIComponent(d.name)}`)}
                  >
                    {usesBannerThumb ? null : (
                      <div className={s.domainIcon} style={{ background: d.bg, color: d.color }}>
                        <Icon size={20} />
                      </div>
                    )}
                    <div className={s.domainCardContent}>
                      <div className={s.domainName}>{d.name}</div>
                      <div className={s.domainMeta}>{stats.files} 公共知识</div>
                      <div className={s.domainMeta}>{stats.tags} 专业知识</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {homeDomains.length > DOMAIN_PAGE_SIZE && (
              <button
                type="button"
                className={`${s.domainArrow} ${s.domainArrowRight}`}
                aria-label="下一组业务域"
                onClick={() => setDomainPage((current) => (current + 1) % domainPageCount)}
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>
        </div>

        {/* Two-column layout */}
        <div className={s.columns}>
          {/* Left: knowledge list panels */}
          <div className={s.leftColumn}>
            {contentSections.map((sec) => {
              const Icon = SECTION_ICONS[sec.icon] || Star;
              const visual = resolveSectionVisual(sec);
              const items = isUsingMockSections ? (MOCK_SECTION_DATA[sec.tag] || []) : (sectionData[sec.tag] || []);
              const showSummary = sec.tag === '行业情报' || sec.tag === '典型案例';
              const featuredItem = !isUsingMockSections && sec.tag === '最新精选' ? items[0] : null;
              const listItems = featuredItem ? items.slice(1) : items;
              return (
                <div key={sec.tag} className={s.panel}>
                  <div className={s.panelHeader}>
                    <div className={s.panelHeaderLeft}>
                      <div className={s.panelIcon} style={{ background: visual.bg, color: visual.color }}><Icon size={14} /></div>
                      <span className={s.panelTitle}>{sec.title}</span>
                    </div>
                    <Link
                      to={`${sec.link}${sec.link.includes('?') ? '&' : '?'}title=${encodeURIComponent(sec.title)}`}
                      className={s.panelMore}
                    >
                      更多 <ChevronRight size={14} />
                    </Link>
                  </div>
                  {featuredItem ? (
                    <div
                      className={s.featuredItem}
                      onClick={() =>
                        navigate(`/space/${featuredItem.spaceId}/file/${featuredItem.id}`, {
                          state: { returnTo: sec.link },
                        })}
                    >
                      <div className={s.featuredTitle}>{featuredItem.title}</div>
                      <div className={s.featuredSummary}>{featuredItem.summary}</div>
                      <div className={s.featuredMeta}>
                        {getPrimaryTag(featuredItem) ? (
                          <TagPill name={getPrimaryTag(featuredItem)!} neutral />
                        ) : null}
                        <span className={s.featuredDate}>{formatDisplayDateTime(featuredItem.date)}</span>
                      </div>
                    </div>
                  ) : null}
                  {listItems.map((f) => (
                    <div
                      key={f.id}
                      className={s.listItem}
                      onClick={() =>
                        navigate(`/space/${f.spaceId}/file/${f.id}`, {
                          state: { returnTo: sec.link },
                        })}
                    >
                      <div className={s.itemBody}>
                        <span className={s.itemTitle}>{f.title}</span>
                        {showSummary ? (
                          <div className={s.itemSummary}>{f.summary}</div>
                        ) : null}
                        <div className={s.itemMeta}>
                          {getPrimaryTag(f) ? (
                            <TagPill name={getPrimaryTag(f)!} neutral />
                          ) : null}
                          <span className={s.itemDate}>{formatDisplayDateTime(f.date)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* 专业课程 · 岗位赋能 */}
            <div className={s.panel}>
              <div className={s.panelHeader}>
                <div className={s.panelHeaderLeft}>
                  <div className={`${s.panelIcon} ${s.panelIconCourse}`}>
                    <GraduationCap size={14} />
                  </div>
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
            <div className={s.qaPanel}>
              <div className={s.qaHeader}>
                <div className={s.qaHeaderLeft}>
                  <div className={s.panelIcon}><Bot size={14} /></div>
                  <span className={s.panelTitle}>智能问答</span>
                </div>
                <Link to="/qa" className={s.panelMore}>
                  进入 <ChevronRight size={14} />
                </Link>
              </div>
              <div className={s.qaComposerWrap}>
                <div className={s.qaPreview} onClick={() => navigate('/qa')}>
                  <div className={s.qaPreviewRow}>
                    <div className={s.qaComposerAvatar}>
                      <Bot size={16} />
                    </div>
                    <div className={s.qaComposerBubble}>
                      {assistantGreeting}
                    </div>
                  </div>
                  <div className={`${s.qaPreviewRow} ${s.qaPreviewRowUser}`}>
                    <div className={s.qaUserBubble}>{primaryQaQuestion}</div>
                    <div className={`${s.qaComposerAvatar} ${s.qaComposerAvatarUser}`}>
                      <User size={16} />
                    </div>
                  </div>
                </div>
                <div className={s.qaPromptBox} onClick={() => navigate('/qa')}>
                  <span>请输入您的问题</span>
                  <button type="button" className={s.qaPromptSend} aria-label="发送问题">
                    <ArrowUp size={14} />
                  </button>
                </div>
              </div>
              <div className={s.qaCallout}>
                <Sparkles size={13} />
                <span>支持流式回复 · 引用知识库来源 · 多轮追问</span>
              </div>
            </div>

            {/* 专家问答 */}
            <div className={s.qaPanel}>
              <div className={s.qaHeader}>
                <div className={s.qaHeaderLeft}>
                  <div className={`${s.panelIcon} ${s.panelIconExpert}`}><Award size={14} /></div>
                  <span className={s.panelTitle}>专家问答</span>
                </div>
                <Link to="/expert-qa" className={s.panelMore}>
                  更多 <ChevronRight size={14} />
                </Link>
              </div>
              <Link to="/expert-qa" className={s.expertCta}>
                <MessageSquarePlus size={22} />
                <div className={s.expertCtaBody}>
                  <div className={s.expertCtaTitle}>向专家提问</div>
                  <div className={s.expertCtaDesc}>126 位认证专家在线 · 平均 4 小时响应</div>
                </div>
                <ChevronRight size={16} className={s.expertCtaCaret} />
              </Link>
              {expertHotQuestions.map((question, index) => (
                <div
                  key={index}
                  className={s.expertItem}
                  onClick={() => navigate('/expert-qa')}
                >
                  <span className={s.expertBadge}>Q</span>
                  <span className={s.expertText}>{question}</span>
                </div>
              ))}
              <div className={s.qaFooter}>本周活跃专家：12人</div>
            </div>

            {/* 股份百科 · 知识产品 */}
            <div className={s.panel}>
              <div className={s.panelHeader}>
                <div className={s.panelHeaderLeft}>
                  <div className={`${s.panelIcon} ${s.panelIconWiki}`}>
                    <BookOpen size={14} />
                  </div>
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

            {/* 热门标签 */}
            {tagRankList.length > 0 ? (
              <div className={`${s.qaPanel} ${s.rankPanel}`}>
                <div className={s.qaHeader}>
                  <div className={s.qaHeaderLeft}>
                    <div className={s.panelIcon}><Tag size={14} /></div>
                    <span className={s.panelTitle}>热门标签</span>
                  </div>
                </div>
                <div className={s.tagRankGrid}>
                  {tagRankList.map((tagName, index) => (
                    <button
                      key={tagName}
                      type="button"
                      className={s.tagRankItem}
                      onClick={() => navigate(`/list?tag=${encodeURIComponent(tagName)}`)}
                    >
                      <span className={s.tagRankIndex}>#{index + 1}</span>
                      <span className={s.tagRankName}>{tagName}</span>
                      <span className={s.tagRankCount}>标签</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

          </div>
        </div>

        {error || loadError ? <div className={s.bottomPad}>{error || loadError}</div> : null}

        <div className={s.bottomPad} />
      </div>
    </PageShell>
  );
}
