import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Building, Tag, Bot, Star, LayoutGrid, Plus, SlidersHorizontal, RefreshCw, ArrowUp, ArrowDown, Server, Image as ImageIcon, Upload, X, Plug, Settings,
} from 'lucide-react';
import DomainIcon from '../components/DomainIcon';
import Header from '../components/Header';
import {
  type AppConfig,
  type BannerSlide,
  type BishengRuntimeConfig,
  type DisplayConfig,
  type DomainConfig,
  fetchAdminConfig,
  fetchBishengRuntimeConfig,
  fetchQaModelOptions,
  fetchSpaceOptions,
  type IntegrationsConfig,
  type PortalConfig,
  type QAModelOption,
  type RecommendationConfig,
  type SectionConfig,
  type SiteConfig,
  type SpaceOption,
  type SpaceConfig,
  type QAConfig,
  updateAppsConfig,
  updateBannersConfig,
  updateBishengRuntimeConfig,
  updateDisplayConfig,
  updateDomainsConfig,
  updateIntegrationsConfig,
  updateQaConfig,
  updateRecommendationConfig,
  updateSectionsConfig,
  updateSiteConfig,
  updateSpacesConfig,
  uploadBannerImage,
} from '../api/adminConfig';
import {
  createDomainDraft,
  DOMAIN_COLOR_OPTIONS,
  DOMAIN_ICON_OPTIONS,
  isSelectedDomainColor,
  validateDomainDraft,
  type DomainDraft,
} from '../utils/adminDomains';
import {
  createSectionDraft,
  resolveSectionVisual,
  SECTION_ICON_OPTIONS,
  validateSectionDraft,
  type SectionDraft,
} from '../utils/adminSections';
import {
  createBannerDraft,
  validateBannerDraft,
  type BannerDraft,
} from '../utils/adminBanners';
import { formatDisplayDateTime } from '../utils/dateTime';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import { canDeleteSpace, getSpaceBindingState, getSpaceUsage, getSpaceUsageSummary, setSpaceEnabled, upsertSpace } from '../utils/adminSpaces';
import s from './AdminPage.module.css';

const APP_ICON_OPTIONS = [
  'PenLine',
  'Search',
  'MessageSquare',
  'Globe',
  'BarChart3',
  'Network',
  'Bot',
  'FileText',
] as const;

const NAV_ITEMS = [
  { key: 'spaces', label: '知识空间', icon: FolderOpen },
  { key: 'domains', label: '业务域', icon: Building },
  { key: 'sections', label: '首页分区', icon: Tag },
  { key: 'banners', label: '首页 Banner', icon: ImageIcon },
  { key: 'qa', label: '问答配置', icon: Bot },
  { key: 'recommend', label: '推荐策略', icon: Star },
  { key: 'display', label: '展示配置', icon: SlidersHorizontal },
  { key: 'apps', label: '应用市场', icon: LayoutGrid },
  { key: 'bisheng', label: '数据源配置', icon: Server },
  { key: 'integrations', label: '集成配置', icon: Plug },
  { key: 'site', label: '站点配置', icon: Settings },
];

type NavKey = typeof NAV_ITEMS[number]['key'];

type DisplayItem = {
  group: string;
  key: string;
  label: string;
  value: number;
};

type QaDialogMode =
  | 'spaces'
  | 'welcome_message'
  | 'hot_questions'
  | 'ai_search_system_prompt'
  | 'qa_system_prompt'
  | 'quick_mode_system_prompt'
  | 'normal_mode_system_prompt'
  | 'expert_mode_system_prompt'
  | null;

type RecommendationDialogKey = 'home_strategy' | 'detail_strategy' | null;

interface QaModelDraft {
  general_model: string;
  reasoning_model: string;
}

interface AppDraft {
  id: string;
  name: string;
  icon: string;
  desc: string;
  color: string;
  bg: string;
  url: string;
  enabled: boolean;
}

interface BishengDraft {
  base_url: string;
  asset_base_url: string;
  username: string;
  password: string;
  timeout_seconds: string;
}

interface IntegrationsDraft {
  bisheng_admin_entry_url: string;
  bisheng_knowledge_entry_url: string;
}

interface SiteDraft {
  header_brand_name: string;
  header_logo_url: string;
  login_brand_name: string;
  login_logo_url: string;
  browser_title: string;
  favicon_url: string;
}

export default function AdminPage() {
  const [active, setActive] = useState<NavKey>('spaces');
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [spaceOptions, setSpaceOptions] = useState<SpaceOption[]>([]);
  const [spaceOptionsLoading, setSpaceOptionsLoading] = useState(false);
  const [spaceOptionsError, setSpaceOptionsError] = useState('');
  const [spaceQuery, setSpaceQuery] = useState('');
  const [spaceDeleteIndex, setSpaceDeleteIndex] = useState<number | null>(null);
  const [domainEditorOpen, setDomainEditorOpen] = useState(false);
  const [domainEditorIndex, setDomainEditorIndex] = useState<number | null>(null);
  const [domainDraft, setDomainDraft] = useState<DomainDraft>(createDomainDraft());
  const [domainFormError, setDomainFormError] = useState('');
  const [domainDeleteIndex, setDomainDeleteIndex] = useState<number | null>(null);
  const [sectionEditorOpen, setSectionEditorOpen] = useState(false);
  const [sectionEditorIndex, setSectionEditorIndex] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft>(createSectionDraft());
  const [sectionFormError, setSectionFormError] = useState('');
  const [sectionDeleteIndex, setSectionDeleteIndex] = useState<number | null>(null);
  const [bishengConfig, setBishengConfig] = useState<BishengRuntimeConfig | null>(null);
  const [bishengEditorOpen, setBishengEditorOpen] = useState(false);
  const [bishengDraft, setBishengDraft] = useState<BishengDraft>(createBishengDraft());
  const [bishengFormError, setBishengFormError] = useState('');
  const [qaDialogMode, setQaDialogMode] = useState<QaDialogMode>(null);
  const [qaTextDraft, setQaTextDraft] = useState('');
  const [qaSpacesDraft, setQaSpacesDraft] = useState<number[]>([]);
  const [qaDialogError, setQaDialogError] = useState('');
  const [qaModelDialogOpen, setQaModelDialogOpen] = useState(false);
  const [qaModelOptions, setQaModelOptions] = useState<QAModelOption[]>([]);
  const [qaModelDraft, setQaModelDraft] = useState<QaModelDraft>({ general_model: '', reasoning_model: '' });
  const [qaModelLoading, setQaModelLoading] = useState(false);
  const [qaModelError, setQaModelError] = useState('');
  const [recommendDialogKey, setRecommendDialogKey] = useState<RecommendationDialogKey>(null);
  const [recommendDraft, setRecommendDraft] = useState('');
  const [appEditorOpen, setAppEditorOpen] = useState(false);
  const [appEditorIndex, setAppEditorIndex] = useState<number | null>(null);
  const [appDraft, setAppDraft] = useState<AppDraft>(createAppDraft());
  const [appFormError, setAppFormError] = useState('');
  const [appDeleteIndex, setAppDeleteIndex] = useState<number | null>(null);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [bannerEditorIndex, setBannerEditorIndex] = useState<number | null>(null);
  const [bannerDraft, setBannerDraft] = useState<BannerDraft>(createBannerDraft());
  const [bannerFormError, setBannerFormError] = useState('');
  const [bannerDeleteIndex, setBannerDeleteIndex] = useState<number | null>(null);
  const [integrationsDialogOpen, setIntegrationsDialogOpen] = useState(false);
  const [integrationsDraft, setIntegrationsDraft] = useState<IntegrationsDraft>(createIntegrationsDraft());
  const [integrationsDialogError, setIntegrationsDialogError] = useState('');
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [siteDraft, setSiteDraft] = useState<SiteDraft>(createSiteDraft());
  const [siteDialogError, setSiteDialogError] = useState('');

  async function loadConfig() {
    setLoading(true);
    setError('');
    try {
      const [portalResult, bishengResult] = await Promise.allSettled([
        fetchAdminConfig(),
        fetchBishengRuntimeConfig(),
      ]);

      const errors: string[] = [];
      if (portalResult.status === 'fulfilled') {
        setConfig(portalResult.value);
      } else {
        errors.push(portalResult.reason instanceof Error ? portalResult.reason.message : '门户配置加载失败');
      }

      if (bishengResult.status === 'fulfilled') {
        setBishengConfig(bishengResult.value);
      } else {
        errors.push(bishengResult.reason instanceof Error ? bishengResult.reason.message : '大模型应用平台配置加载失败');
      }

      if (errors.length) {
        setError(errors.join('；'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function runSave(task: () => Promise<void>) {
    setSaving(true);
    setError('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function openSpacePicker() {
    setSpacePickerOpen(true);
    setSpaceQuery('');
    setSpaceOptionsLoading(true);
    setSpaceOptionsError('');
    try {
      const data = await fetchSpaceOptions();
      setSpaceOptions(data.options);
    } catch (err) {
      setSpaceOptionsError(err instanceof Error ? err.message : '候选空间加载失败');
    } finally {
      setSpaceOptionsLoading(false);
    }
  }

  function openCreateDomainDialog() {
    setDomainEditorOpen(true);
    setDomainEditorIndex(null);
    setDomainDraft(createDomainDraft());
    setDomainFormError('');
  }

  function openEditDomainDialog(domain: DomainConfig, index: number) {
    setDomainEditorOpen(true);
    setDomainEditorIndex(index);
    setDomainDraft(createDomainDraft(domain));
    setDomainFormError('');
  }

  function openCreateSectionDialog() {
    setSectionEditorOpen(true);
    setSectionEditorIndex(null);
    setSectionDraft(createSectionDraft());
    setSectionFormError('');
  }

  function openEditSectionDialog(section: SectionConfig, index: number) {
    setSectionEditorOpen(true);
    setSectionEditorIndex(index);
    setSectionDraft(createSectionDraft(section));
    setSectionFormError('');
  }

  function openBishengDialog(current?: BishengRuntimeConfig | null) {
    setBishengEditorOpen(true);
    setBishengDraft(createBishengDraft(current ?? undefined));
    setBishengFormError('');
  }

  function openQaSpacesDialog(qa: QAConfig) {
    setQaDialogMode('spaces');
    setQaSpacesDraft(qa.knowledge_space_ids);
    setQaDialogError('');
  }

  async function openQaModelDialog(qa: QAConfig) {
    setQaModelDialogOpen(true);
    setQaModelDraft({
      general_model: qa.general_model || qa.selected_model || '',
      reasoning_model: qa.reasoning_model || '',
    });
    setQaModelLoading(true);
    setQaModelError('');
    try {
      const data = await fetchQaModelOptions();
      setQaModelOptions(data.models);
      setQaModelDraft({
        general_model: qa.general_model || data.general_model || data.selected_model || '',
        reasoning_model: qa.reasoning_model || data.reasoning_model || '',
      });
    } catch (err) {
      setQaModelError(err instanceof Error ? err.message : '模型列表加载失败');
    } finally {
      setQaModelLoading(false);
    }
  }

  useEffect(() => {
    if (active !== 'qa' || !config || qaModelOptions.length) return;
    let cancelled = false;
    setQaModelLoading(true);
    setQaModelError('');
    void (async () => {
      try {
        const data = await fetchQaModelOptions();
        if (cancelled) return;
        setQaModelOptions(data.models);
      } catch (err) {
        if (cancelled) return;
        setQaModelError(err instanceof Error ? err.message : '模型列表加载失败');
      } finally {
        if (!cancelled) setQaModelLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, config, qaModelOptions.length]);

  function openQaTextDialog(mode: Exclude<QaDialogMode, 'spaces' | null>, value: string) {
    setQaDialogMode(mode);
    setQaTextDraft(value);
    setQaDialogError('');
  }

  function openRecommendationDialog(key: Exclude<RecommendationDialogKey, null>, value: string) {
    setRecommendDialogKey(key);
    setRecommendDraft(value);
  }

  function openCreateAppDialog() {
    setAppEditorOpen(true);
    setAppEditorIndex(null);
    setAppDraft(createAppDraft());
    setAppFormError('');
  }

  function openEditAppDialog(app: AppConfig, index: number) {
    setAppEditorOpen(true);
    setAppEditorIndex(index);
    setAppDraft(createAppDraft(app));
    setAppFormError('');
  }

  function openCreateBannerDialog() {
    setBannerEditorOpen(true);
    setBannerEditorIndex(null);
    setBannerDraft(createBannerDraft(undefined, config?.banners ?? []));
    setBannerFormError('');
  }

  function openEditBannerDialog(banner: BannerSlide, index: number) {
    setBannerEditorOpen(true);
    setBannerEditorIndex(index);
    setBannerDraft(createBannerDraft(banner));
    setBannerFormError('');
  }

  const displayItems = config ? getDisplayItems(config.display) : [];
  const deletingSpace = config && spaceDeleteIndex !== null ? config.spaces[spaceDeleteIndex] : null;
  const deletingApp = config && appDeleteIndex !== null ? config.apps[appDeleteIndex] : null;
  const deletingBanner = config && bannerDeleteIndex !== null ? config.banners[bannerDeleteIndex] : null;

  return (
    <>
      <Header />
      <div className={s.layout}>
        {/* Left nav */}
        <nav className={s.nav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                className={`${s.navItem} ${active === item.key ? s.navItemActive : ''}`}
                onClick={() => setActive(item.key)}
              >
                <Icon size={16} />
                {item.label}
              </div>
            );
          })}
        </nav>

        {/* Main */}
        <main className={s.main}>
          <div className={s.statusRow}>
            <div className={s.statusText}>
              {loading ? '正在加载配置...' : saving ? '正在保存配置...' : '配置已加载，可直接编辑并保存。'}
            </div>
            <button className={s.subtleBtn} onClick={() => void loadConfig()} disabled={loading || saving}>
              <RefreshCw size={14} />
              刷新
            </button>
          </div>
          {error ? <div className={s.errorBox}>{error}</div> : null}
          {!config && !loading ? (
            <div className={s.emptyState}>配置暂时不可用</div>
          ) : null}
          {config && active === 'spaces' && (
            <SpacesTable
              spaces={config.spaces}
              domains={config.domains}
              qa={config.qa}
              saving={saving}
              onAdd={() => void openSpacePicker()}
              onToggleEnabled={(index, enabled) => void handleToggleSpaceEnabled(config.spaces, index, enabled, runSave, setConfig)}
              onDelete={(index) => setSpaceDeleteIndex(index)}
            />
          )}
          {config && active === 'domains' && (
            <DomainsTable
              domains={config.domains}
              spaces={config.spaces}
              saving={saving}
              onAdd={openCreateDomainDialog}
              onEdit={(index) => openEditDomainDialog(config.domains[index], index)}
              onDelete={(index) => setDomainDeleteIndex(index)}
              onMoveUp={(index) => void handleMoveDomain(config.domains, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveDomain(config.domains, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'sections' && (
            <SectionsTable
              sections={config.sections}
              saving={saving}
              onAdd={openCreateSectionDialog}
              onEdit={(index) => openEditSectionDialog(config.sections[index], index)}
              onDelete={(index) => setSectionDeleteIndex(index)}
              onMoveUp={(index) => void handleMoveSection(config.sections, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveSection(config.sections, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'qa' && (
            <QAConfigTable
              qa={config.qa}
              spaces={config.spaces}
              saving={saving}
              modelOptions={qaModelOptions}
              modelLoading={qaModelLoading}
              modelError={qaModelError}
              onEditSpaces={() => openQaSpacesDialog(config.qa)}
              onEditWelcomeMessage={() => openQaTextDialog('welcome_message', config.qa.welcome_message)}
              onEditQuestions={() => openQaTextDialog('hot_questions', config.qa.hot_questions.join('\n'))}
              onEditModel={() => void openQaModelDialog(config.qa)}
              onEditSearchPrompt={() => openQaTextDialog('ai_search_system_prompt', config.qa.ai_search_system_prompt)}
              onEditQaPrompt={() => openQaTextDialog('qa_system_prompt', config.qa.qa_system_prompt)}
              onEditQuickPrompt={() => openQaTextDialog('quick_mode_system_prompt', config.qa.quick_mode_system_prompt)}
              onEditNormalPrompt={() => openQaTextDialog('normal_mode_system_prompt', config.qa.normal_mode_system_prompt)}
              onEditExpertPrompt={() => openQaTextDialog('expert_mode_system_prompt', config.qa.expert_mode_system_prompt)}
            />
          )}
          {active === 'bisheng' && (
            <BishengConfigTable
              config={bishengConfig}
              saving={saving}
              onEdit={() => openBishengDialog(bishengConfig)}
            />
          )}
          {config && active === 'recommend' && (
            <RecommendConfigTable
              recommendation={config.recommendation}
              saving={saving}
              onEditHome={() => openRecommendationDialog('home_strategy', config.recommendation.home_strategy)}
              onEditDetail={() => openRecommendationDialog('detail_strategy', config.recommendation.detail_strategy)}
            />
          )}
          {config && active === 'display' && (
            <DisplayConfigTable
              items={displayItems}
              saving={saving}
              onAdjust={(key, delta) => void handleAdjustDisplay(config.display, key, delta, runSave, setConfig)}
            />
          )}
          {config && active === 'apps' && (
            <AppsTable
              apps={config.apps}
              saving={saving}
              onAdd={openCreateAppDialog}
              onEdit={(index) => openEditAppDialog(config.apps[index], index)}
              onDelete={(index) => setAppDeleteIndex(index)}
            />
          )}
          {config && active === 'banners' && (
            <BannersTable
              banners={config.banners}
              saving={saving}
              onAdd={openCreateBannerDialog}
              onEdit={(index) => openEditBannerDialog(config.banners[index], index)}
              onDelete={(index) => setBannerDeleteIndex(index)}
              onMoveUp={(index) => void handleMoveBanner(config.banners, index, -1, runSave, setConfig)}
              onMoveDown={(index) => void handleMoveBanner(config.banners, index, 1, runSave, setConfig)}
            />
          )}
          {config && active === 'integrations' && (
            <IntegrationsConfigTable
              integrations={config.integrations}
              saving={saving}
              onEdit={() => {
                setIntegrationsDraft(createIntegrationsDraft(config.integrations));
                setIntegrationsDialogError('');
                setIntegrationsDialogOpen(true);
              }}
            />
          )}
          {config && active === 'site' && (
            <SiteConfigTable
              site={createSiteDraft(config.site)}
              saving={saving}
              onEdit={() => {
                setSiteDraft(createSiteDraft(config.site));
                setSiteDialogError('');
                setSiteDialogOpen(true);
              }}
            />
          )}
        </main>
      </div>
      {config ? (
        <SpacePickerDialog
          open={spacePickerOpen}
          saving={saving}
          loading={spaceOptionsLoading}
          error={spaceOptionsError}
          options={spaceOptions}
          query={spaceQuery}
          onClose={() => setSpacePickerOpen(false)}
          onRefresh={() => void openSpacePicker()}
          onQueryChange={setSpaceQuery}
          spaces={config.spaces}
          onToggle={(option) => void handleAddSpace(config.spaces, option, runSave, setConfig)}
        />
      ) : null}
      {config && deletingSpace ? (
        <SpaceDeleteDialog
          open
          space={deletingSpace}
          usage={getSpaceUsage(deletingSpace.id, config.domains, config.qa)}
          saving={saving}
          onClose={() => setSpaceDeleteIndex(null)}
          onConfirm={() => {
            if (spaceDeleteIndex === null) return;
            void handleDeleteSpace(config.spaces, spaceDeleteIndex, runSave, setConfig, {
              confirm: false,
              onSuccess: () => setSpaceDeleteIndex(null),
            });
          }}
        />
      ) : null}
      {config && domainEditorOpen ? (
        <DomainEditorDialog
          open
          spaces={config.spaces}
          draft={domainDraft}
          saving={saving}
          error={domainFormError}
          onClose={() => setDomainEditorOpen(false)}
          onChange={(patch) => {
            setDomainDraft((current) => ({ ...current, ...patch }));
            setDomainFormError('');
          }}
          onSubmit={() => {
            const result = validateDomainDraft(domainDraft, config.spaces);
            if (!result.domain) {
              setDomainFormError(result.error || '业务域配置无效');
              return;
            }
            if (domainEditorIndex === null) {
              void handleAddDomain(config.domains, result.domain, runSave, setConfig, {
                onSuccess: () => setDomainEditorOpen(false),
              });
              return;
            }
            void handleEditDomain(config.domains, domainEditorIndex, result.domain, runSave, setConfig, {
              onSuccess: () => setDomainEditorOpen(false),
            });
          }}
        />
      ) : null}
      {config && domainDeleteIndex !== null ? (
        <DomainDeleteDialog
          open
          domain={config.domains[domainDeleteIndex]}
          spaceName={config.spaces.find((space) => space.id === config.domains[domainDeleteIndex].space_ids[0])?.name}
          saving={saving}
          onClose={() => setDomainDeleteIndex(null)}
          onConfirm={() => {
            void handleDeleteDomain(config.domains, domainDeleteIndex, runSave, setConfig, {
              confirm: false,
              onSuccess: () => setDomainDeleteIndex(null),
            });
          }}
        />
      ) : null}
      {config && sectionEditorOpen ? (
        <SectionEditorDialog
          open
          draft={sectionDraft}
          saving={saving}
          error={sectionFormError}
          onClose={() => setSectionEditorOpen(false)}
          onChange={(patch) => {
            setSectionDraft((current) => ({ ...current, ...patch }));
            setSectionFormError('');
          }}
          onSubmit={() => {
            const result = validateSectionDraft(sectionDraft);
            if (!result.section) {
              setSectionFormError(result.error || '首页分区配置无效');
              return;
            }
            if (sectionEditorIndex === null) {
              void handleAddSection(config.sections, result.section, runSave, setConfig, {
                onSuccess: () => setSectionEditorOpen(false),
              });
              return;
            }
            void handleEditSection(config.sections, sectionEditorIndex, result.section, runSave, setConfig, {
              onSuccess: () => setSectionEditorOpen(false),
            });
          }}
        />
      ) : null}
      {config && sectionDeleteIndex !== null ? (
        <SectionDeleteDialog
          open
          section={config.sections[sectionDeleteIndex]}
          saving={saving}
          onClose={() => setSectionDeleteIndex(null)}
          onConfirm={() => {
            void handleDeleteSection(config.sections, sectionDeleteIndex, runSave, setConfig, {
              confirm: false,
              onSuccess: () => setSectionDeleteIndex(null),
            });
          }}
        />
      ) : null}
      {bishengEditorOpen ? (
        <BishengEditorDialog
          open
          draft={bishengDraft}
          saving={saving}
          error={bishengFormError}
          hasToken={Boolean(bishengConfig?.has_token)}
          onClose={() => setBishengEditorOpen(false)}
          onChange={(patch) => {
            setBishengDraft((current) => ({ ...current, ...patch }));
            setBishengFormError('');
          }}
          onSubmit={() => {
            const result = validateBishengDraft(bishengDraft);
            if (!result.payload) {
              setBishengFormError(result.error || '大模型应用平台配置无效');
              return;
            }
            const nextPayload = result.payload;
            setSaving(true);
            setError('');
            void updateBishengRuntimeConfig(nextPayload)
              .then((updated) => {
                setBishengConfig(updated);
                setBishengEditorOpen(false);
              })
              .catch((err) => {
                const message = err instanceof Error ? err.message : '保存失败';
                setError(message);
                setBishengFormError(message);
              })
              .finally(() => setSaving(false));
          }}
        />
      ) : null}
      {config && qaDialogMode === 'spaces' ? (
        <QaSpacesDialog
          open
          spaces={config.spaces}
          selectedIds={qaSpacesDraft}
          saving={saving}
          error={qaDialogError}
          onClose={() => setQaDialogMode(null)}
          onToggle={(spaceId) => {
            setQaDialogError('');
            setQaSpacesDraft((current) => (
              current.includes(spaceId)
                ? current.filter((id) => id !== spaceId)
                : [...current, spaceId]
            ));
          }}
          onSubmit={() => {
            if (!qaSpacesDraft.length) {
              setQaDialogError('请至少选择一个知识空间');
              return;
            }
            void runSave(async () => {
              await persistQa({ ...config.qa, knowledge_space_ids: qaSpacesDraft }, setConfig);
              setQaDialogMode(null);
            });
          }}
        />
      ) : null}
      {config && qaDialogMode && qaDialogMode !== 'spaces' ? (
        <TextEditorDialog
          open
          title={getQaDialogTitle(qaDialogMode)}
          note={getQaDialogNote(qaDialogMode)}
          label={getQaDialogLabel(qaDialogMode)}
          value={qaTextDraft}
          saving={saving}
          error={qaDialogError}
          multiline
          placeholder={getQaDialogPlaceholder(qaDialogMode)}
          onClose={() => setQaDialogMode(null)}
          onChange={(value) => {
            setQaTextDraft(value);
            setQaDialogError('');
          }}
          onSubmit={() => {
            const trimmed = qaTextDraft.trim();
            if (!trimmed) {
              setQaDialogError('请输入内容');
              return;
            }
            const nextQa =
              qaDialogMode === 'hot_questions'
                ? { ...config.qa, hot_questions: qaTextDraft.split('\n').map((item) => item.trim()).filter(Boolean) }
                : { ...config.qa, [qaDialogMode]: trimmed };
            if (qaDialogMode === 'hot_questions' && !nextQa.hot_questions.length) {
              setQaDialogError('请至少保留一条热门问题');
              return;
            }
            void runSave(async () => {
              await persistQa(nextQa, setConfig);
              setQaDialogMode(null);
            });
          }}
        />
      ) : null}
      {config && qaModelDialogOpen ? (
        <QaModelDialog
          open
          models={qaModelOptions}
          selectedModels={qaModelDraft}
          loading={qaModelLoading}
          saving={saving}
          error={qaModelError}
          onClose={() => setQaModelDialogOpen(false)}
          onSelect={(field, modelId) => setQaModelDraft((current) => ({ ...current, [field]: modelId }))}
          onSubmit={() => {
            if (!qaModelDraft.general_model) {
              setQaModelError('请选择通用模型');
              return;
            }
            void runSave(async () => {
              await persistQa({
                ...config.qa,
                selected_model: qaModelDraft.general_model,
                general_model: qaModelDraft.general_model,
                reasoning_model: qaModelDraft.reasoning_model,
              }, setConfig);
              setQaModelDialogOpen(false);
            });
          }}
        />
      ) : null}
      {config && recommendDialogKey ? (
        <TextEditorDialog
          open
          title={recommendDialogKey === 'home_strategy' ? '编辑首页推荐策略' : '编辑详情页推荐策略'}
          note="这里只修改当前场景的策略描述，provider 保持现状。"
          label="策略描述"
          value={recommendDraft}
          saving={saving}
          placeholder="例如：tag+updated_at"
          onClose={() => setRecommendDialogKey(null)}
          onChange={setRecommendDraft}
          onSubmit={() => {
            const trimmed = recommendDraft.trim();
            if (!trimmed) return;
            void runSave(async () => {
              await persistRecommendation({ ...config.recommendation, [recommendDialogKey]: trimmed }, setConfig);
              setRecommendDialogKey(null);
            });
          }}
        />
      ) : null}
      {config && appEditorOpen ? (
        <AppEditorDialog
          open
          draft={appDraft}
          saving={saving}
          error={appFormError}
          onClose={() => setAppEditorOpen(false)}
          onChange={(patch) => {
            setAppDraft((current) => ({ ...current, ...patch }));
            setAppFormError('');
          }}
          onSubmit={() => {
            const result = validateAppDraft(appDraft);
            if (!result.app) {
              setAppFormError(result.error || '应用配置无效');
              return;
            }
            const nextApp = result.app;
            void runSave(async () => {
              if (appEditorIndex === null) {
                await persistApps([...config.apps, nextApp], setConfig);
              } else {
                const updated = [...config.apps];
                updated[appEditorIndex] = nextApp;
                await persistApps(updated, setConfig);
              }
              setAppEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && deletingApp ? (
        <AppDeleteDialog
          open
          app={deletingApp}
          saving={saving}
          onClose={() => setAppDeleteIndex(null)}
          onConfirm={() => {
            if (appDeleteIndex === null) return;
            void runSave(async () => {
              await persistApps(config.apps.filter((_, index) => index !== appDeleteIndex), setConfig);
              setAppDeleteIndex(null);
            });
          }}
        />
      ) : null}
      {config && bannerEditorOpen ? (
        <BannerEditorDialog
          open
          draft={bannerDraft}
          saving={saving}
          error={bannerFormError}
          onClose={() => setBannerEditorOpen(false)}
          onChange={(patch) => {
            setBannerDraft((current) => ({ ...current, ...patch }));
            setBannerFormError('');
          }}
          onSubmit={() => {
            const result = validateBannerDraft(bannerDraft);
            if (!result.banner) {
              setBannerFormError(result.error || 'Banner 配置无效');
              return;
            }
            const nextBanner = result.banner;
            void runSave(async () => {
              if (bannerEditorIndex === null) {
                await persistBanners([...config.banners, nextBanner], setConfig);
              } else {
                const updated = [...config.banners];
                updated[bannerEditorIndex] = nextBanner;
                await persistBanners(updated, setConfig);
              }
              setBannerEditorOpen(false);
            });
          }}
        />
      ) : null}
      {config && deletingBanner ? (
        <BannerDeleteDialog
          open
          banner={deletingBanner}
          saving={saving}
          onClose={() => setBannerDeleteIndex(null)}
          onConfirm={() => {
            if (bannerDeleteIndex === null) return;
            void runSave(async () => {
              await persistBanners(config.banners.filter((_, index) => index !== bannerDeleteIndex), setConfig);
              setBannerDeleteIndex(null);
            });
          }}
        />
      ) : null}
      {config && integrationsDialogOpen ? (
        <IntegrationsEditorDialog
          open
          draft={integrationsDraft}
          saving={saving}
          error={integrationsDialogError}
          onClose={() => setIntegrationsDialogOpen(false)}
          onChange={(value) => {
            setIntegrationsDraft(value);
            setIntegrationsDialogError('');
          }}
          onSubmit={() => {
            const nextIntegrations = {
              bisheng_admin_entry_url: integrationsDraft.bisheng_admin_entry_url.trim(),
              bisheng_knowledge_entry_url: integrationsDraft.bisheng_knowledge_entry_url.trim(),
            };
            const invalidField = Object.values(nextIntegrations).find((value) => value && !/^https?:\/\//i.test(value));
            if (invalidField) {
              setIntegrationsDialogError('URL 需以 http:// 或 https:// 开头；如要清空请删除全部内容。');
              return;
            }
            void runSave(async () => {
              await persistIntegrations(nextIntegrations, setConfig);
              setIntegrationsDialogOpen(false);
            });
          }}
        />
      ) : null}
      {config && siteDialogOpen ? (
        <SiteEditorDialog
          open
          draft={siteDraft}
          saving={saving}
          error={siteDialogError}
          onClose={() => setSiteDialogOpen(false)}
          onChange={(value) => {
            setSiteDraft(value);
            setSiteDialogError('');
          }}
          onSubmit={() => {
            const result = validateSiteDraft(siteDraft);
            if (result.error || !result.site) {
              setSiteDialogError(result.error || '站点配置无效');
              return;
            }
            const nextSite = result.site;
            void runSave(async () => {
              await persistSite(nextSite, setConfig);
              setSiteDialogOpen(false);
            });
          }}
        />
      ) : null}
    </>
  );
}

function SpacesTable({
  spaces,
  domains,
  qa,
  saving,
  onAdd,
  onToggleEnabled,
  onDelete,
}: {
  spaces: SpaceConfig[];
  domains: DomainConfig[];
  qa: QAConfig;
  saving: boolean;
  onAdd: () => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>知识空间管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        已绑定的空间决定门户可见范围。停用会立即从前台隐藏，删除前需要先解除业务域和问答范围里的引用。
      </p>
      <table className={s.table}>
        <colgroup>
          <col className={s.displayGroupCol} />
          <col />
          <col className={s.displayValueCol} />
        </colgroup>
        <thead>
          <tr>
            <th>空间名称</th>
            <th>状态</th>
            <th>文件数</th>
            <th>关联配置</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {spaces.map((sp, index) => {
            const usage = getSpaceUsage(sp.id, domains, qa);
            const deletable = canDeleteSpace(usage);
            return (
              <tr key={sp.id}>
                <td>
                  <div className={s.spaceNameCell}>
                    <span>{sp.name}</span>
                    <span className={s.inlineHint}>ID {sp.id}</span>
                  </div>
                </td>
                <td>
                  <span className={sp.enabled ? s.stateEnabled : s.stateDisabled}>
                    {sp.enabled ? '已启用' : '已停用'}
                  </span>
                </td>
                <td>{sp.file_count}</td>
                <td>{getSpaceUsageSummary(usage)}</td>
                <td>
                  <div className={s.actionGroup}>
                    <button
                      className={s.inlineBtn}
                      onClick={() => onToggleEnabled(index, !sp.enabled)}
                      disabled={saving}
                    >
                      {sp.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      className={deletable ? s.inlineDangerBtn : s.inlineMutedBtn}
                      onClick={() => onDelete(index)}
                      disabled={saving || !deletable}
                      title={deletable ? '删除该知识空间绑定' : '请先解除业务域和问答范围里的引用'}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function SpacePickerDialog({
  open,
  spaces,
  options,
  query,
  saving,
  loading,
  error,
  onClose,
  onRefresh,
  onQueryChange,
  onToggle,
}: {
  open: boolean;
  spaces: SpaceConfig[];
  options: SpaceOption[];
  query: string;
  saving: boolean;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onQueryChange: (value: string) => void;
  onToggle: (option: SpaceOption) => void;
}) {
  if (!open) return null;

  const filteredOptions = options.filter((option) => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
      option.name.toLowerCase().includes(keyword)
      || option.description.toLowerCase().includes(keyword)
    );
  });

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>添加知识空间</h3>
            <p className={s.modalNote}>从大模型应用平台现有知识空间里选择，不向用户展示空间 ID。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        <div className={s.modalActions}>
          <input
            className={s.optionSearch}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索知识空间名称或描述"
          />
          <button className={s.subtleBtn} onClick={onRefresh} disabled={loading || saving}>
            <RefreshCw size={14} />
            刷新候选项
          </button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        {!error && !loading ? (
          <div className={s.modalHint}>
            当前候选数：{options.length}，筛选后：{filteredOptions.length}
          </div>
        ) : null}
        <div className={s.optionList}>
          {loading ? <div className={s.emptyState}>正在加载候选空间...</div> : null}
          {!loading && !options.length ? <div className={s.emptyState}>暂未获取到候选空间</div> : null}
          {!loading && !!options.length && !filteredOptions.length ? <div className={s.emptyState}>没有匹配的知识空间</div> : null}
          {!loading && filteredOptions.map((option) => {
            const bindingState = getSpaceBindingState(spaces, option);
            return (
              <div key={option.id} className={s.optionRow}>
                <div className={s.optionMain}>
                  <div className={s.optionName}>{option.name}</div>
                  <div className={s.optionMeta}>
                    {option.description || '未配置描述'}
                  </div>
                </div>
                <div className={s.optionSide}>
                  <span className={s.optionCount}>{option.file_count} 个文件</span>
                  <button
                    className={bindingState === 'new' ? s.addBtn : s.subtleBtn}
                    onClick={() => onToggle(option)}
                    disabled={saving || bindingState === 'enabled'}
                  >
                    {bindingState === 'new' ? '添加' : bindingState === 'disabled' ? '重新启用' : '已绑定'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SpaceDeleteDialog({
  open,
  space,
  usage,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  space: SpaceConfig;
  usage: ReturnType<typeof getSpaceUsage>;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除知识空间</h3>
            <p className={s.modalNote}>这只会移除门户绑定，不会删除大模型应用平台里的原始知识空间。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>空间名称：</strong>{space.name}</div>
          <div className={s.confirmLine}><strong>文件数：</strong>{space.file_count}</div>
          <div className={s.confirmLine}><strong>关联配置：</strong>{getSpaceUsageSummary(usage)}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function DomainsTable({
  domains,
  spaces,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  domains: DomainConfig[];
  spaces: SpaceConfig[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>业务域管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      {/* TODO: Confirm with product whether domain cards should use photo backgrounds, logo/icon cards, or support both as a configurable strategy. */}
      <p className={s.pageNote}>
        待与产品确认最终卡片策略：业务域卡片是采用“图片背景卡”还是“Logo/图标卡”，后台当前同时预留背景图和 Logo/图标 配置位。首页业务域导航当前按前端数组顺序取前 N 个展示，业务域通过新增和删除管理，不单独做停用。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>业务域名称</th>
            <th>Logo/图标</th>
            <th>背景图</th>
            <th>绑定空间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d, index) => {
            const sp = spaces.find((ss) => ss.id === d.space_ids[0]);
            const visualPreset = getDomainVisualPreset(d);
            const backgroundImage = visualPreset.backgroundImage;
            return (
              <tr key={d.name}>
                <td>{d.name}</td>
                <td><AdminIconCell icon={d.icon} color={d.color} bg={d.bg} /></td>
                <td>
                  {backgroundImage ? (
                    <img src={backgroundImage} alt={`${d.name} 背景`} className={s.backgroundPreview} />
                  ) : (
                    '未配置'
                  )}
                </td>
                <td>
                  {sp?.name
                    ? sp.name
                    : d.space_ids.length > 0
                      ? d.space_ids.join(', ')
                      : <span className={s.unboundBadge} title="未绑定的业务域不会显示在前台首页">未绑定 · 待补绑定</span>}
                </td>
                <td>
                  <div className={s.actionGroup}>
                    <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                    <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                    <button
                      className={s.iconActionBtn}
                      onClick={() => onMoveUp(index)}
                      disabled={saving || index === 0}
                      aria-label={`上移${d.name}`}
                      title="上移"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className={s.iconActionBtn}
                      onClick={() => onMoveDown(index)}
                      disabled={saving || index === domains.length - 1}
                      aria-label={`下移${d.name}`}
                      title="下移"
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function AdminIconCell({
  icon,
  color,
  bg,
}: {
  icon: string;
  color: string;
  bg: string;
}) {
  return (
    <div className={s.logoCell}>
      <DomainIcon icon={icon} color={color} bg={bg} size={36} />
      <span>{icon}</span>
    </div>
  );
}

function DomainEditorDialog({
  open,
  spaces,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  spaces: SpaceConfig[];
  draft: DomainDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<DomainDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.name.trim() ? `编辑业务域 · ${draft.name}` : '新增业务域'}</h3>
            <p className={s.modalNote}>一个业务域绑定一个知识空间，前台按数组顺序展示。需要下线时直接删除该业务域。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>业务域名称</span>
            <input
              className={s.formInput}
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
              placeholder="例如：轧线"
            />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>绑定空间</span>
            <select
              className={s.formInput}
              value={draft.spaceId}
              onChange={(event) => onChange({ spaceId: event.target.value })}
            >
              <option value="">未绑定（暂不上首页）</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}{space.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
            <span className={s.fieldHint}>未绑定的业务域只在后台可见，绑定知识空间后会按数组顺序出现在首页业务域导航。</span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>首页统计口径</span>
            <div className={s.emptyState}>首页业务域卡片统一展示“知识数量”，数量来自该业务域绑定知识空间下的全部文档数。</div>
            <span className={s.fieldHint}>
              如需调整数量口径，请调整业务域绑定的知识空间；不再单独维护公共知识、专业知识或文件夹级统计。
            </span>
          </div>
          <label className={s.formField}>
            <span className={s.fieldLabel}>背景图</span>
            <input
              className={s.formInput}
              value={draft.backgroundImage}
              onChange={(event) => onChange({ backgroundImage: event.target.value })}
              placeholder="https://example.com/domain.jpg 或 /rolling-domain-bg.jpg"
            />
            <span className={s.fieldHint}>
              支持两种格式：网络图片 URL（例如 `https://example.com/domain.jpg`）或站点本地静态路径（例如 `/rolling-domain-bg.jpg`，也兼容 `rolling-domain-bg.jpg`）。
            </span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>图标</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                  onClick={() => onChange({ icon })}
                >
                  <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                  <span className={s.optionLabel}>{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>颜色</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`${s.colorOptionBtn} ${isSelectedDomainColor(draft, option) ? s.colorOptionBtnActive : ''}`}
                  onClick={() => onChange({ color: option.color, bg: option.bg })}
                >
                  <span className={s.colorPairPreview}>
                    <span className={s.colorSwatchMain} style={{ background: option.color }} />
                    <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                  </span>
                  <span className={s.optionLabel}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function DomainDeleteDialog({
  open,
  domain,
  spaceName,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  domain: DomainConfig;
  spaceName?: string;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除业务域</h3>
            <p className={s.modalNote}>删除后该业务域入口会从首页和业务域页消失，但不会影响原知识空间。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>业务域名称：</strong>{domain.name}</div>
          <div className={s.confirmLine}><strong>绑定空间：</strong>{spaceName || domain.space_ids.join(', ')}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function SectionsTable({
  sections,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  sections: SectionConfig[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>首页分区管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        首页分区按当前数组顺序展示。每个分区只需要配置标题、标签和图标；跳转地址会按标签自动生成。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分区标题</th>
            <th>关联标签</th>
            <th>Logo/图标</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, index) => {
            const visual = resolveSectionVisual(sec);
            return (
            <tr key={sec.tag}>
              <td>{sec.title}</td>
              <td>
                <span className={s.sectionTagBadge}>
                  {sec.tag}
                </span>
              </td>
              <td><AdminIconCell icon={sec.icon} color={visual.color} bg={visual.bg} /></td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                  <button
                    className={s.iconActionBtn}
                    onClick={() => onMoveUp(index)}
                    disabled={saving || index === 0}
                    aria-label={`上移${sec.title}`}
                    title="上移"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className={s.iconActionBtn}
                    onClick={() => onMoveDown(index)}
                    disabled={saving || index === sections.length - 1}
                    aria-label={`下移${sec.title}`}
                    title="下移"
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </>
  );
}

function SectionEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: SectionDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<SectionDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.title.trim() ? `编辑首页分区：${draft.title}` : '新增首页分区'}</h3>
            <p className={s.modalNote}>分区卡片会直接出现在首页。你只需要填写标签，跳转地址会按标签自动生成。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>分区标题</span>
            <input
              className={s.formInput}
              value={draft.title}
              onChange={(event) => onChange({ title: event.target.value })}
              placeholder="例如：知识推荐 · 最新精选"
            />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>关联标签</span>
            <input
              className={s.formInput}
              value={draft.tag}
              onChange={(event) => onChange({ tag: event.target.value })}
              placeholder="例如：最新精选"
            />
            <span className={s.fieldHint}>首页分区会按这个标签自动生成站内跳转，不需要单独填写链接。</span>
          </label>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>图标</span>
            <div className={s.optionPickerRow}>
              {SECTION_ICON_OPTIONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                  onClick={() => onChange({ icon })}
                >
                  <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                  <span className={s.optionLabel}>{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>颜色</span>
            <div className={s.optionPickerRow}>
              {DOMAIN_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`${s.colorOptionBtn} ${isSelectedDomainColor(draft, option) ? s.colorOptionBtnActive : ''}`}
                  onClick={() => onChange({ color: option.color, bg: option.bg })}
                >
                  <span className={s.colorPairPreview}>
                    <span className={s.colorSwatchMain} style={{ background: option.color }} />
                    <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                  </span>
                  <span className={s.optionLabel}>{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function SectionDeleteDialog({
  open,
  section,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  section: SectionConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除首页分区</h3>
            <p className={s.modalNote}>删除后首页将不再展示该分区入口，但不会影响原有标签和文档数据。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>分区标题：</strong>{section.title}</div>
          <div className={s.confirmLine}><strong>关联标签：</strong>{section.tag}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function BishengConfigTable({
  config,
  saving,
  onEdit,
}: {
  config: BishengRuntimeConfig | null;
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>数据源配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户后端使用的大模型应用平台数据源环境。密码不会回显到前端；保存成功后会立即更新运行中的连接配置。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>大模型应用平台地址</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.base_url || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>资源域名（预览代理）</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.asset_base_url || '与大模型应用平台地址相同'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>登录账号</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.username || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>连接状态</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{config?.connected ? '已连接' : '未连接'}</span>
                <span className={s.valueMeta}>{config?.auth_message || '未验证'}</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>当前登录用户</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{config?.auth_user?.name || config?.auth_user?.account || '未获取'}</span>
                {config?.auth_user?.account ? (
                  <span className={s.valueMeta}>
                    {config.auth_user.account}{config.auth_user.role ? ` · ${config.auth_user.role}` : ''}
                  </span>
                ) : null}
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>请求超时</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config ? `${config.timeout_seconds} 秒` : '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
          <tr>
            <td>最近验证时间</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{config?.last_auth_at ? formatDisplayDateTime(config.last_auth_at) : '未验证'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : config ? '编辑' : '创建'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function BishengEditorDialog({
  open,
  draft,
  saving,
  error,
  hasToken,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: BishengDraft;
  saving: boolean;
  error: string;
  hasToken: boolean;
  onClose: () => void;
  onChange: (patch: Partial<BishengDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑数据源配置</h3>
            <p className={s.modalNote}>请填大模型应用平台<strong>后端 API</strong> 地址（端口通常是 :7860/:7861/:8098），<strong>不是</strong> :4001/:3001/:3002 这种带 nginx 静态托管的浏览器入口。保存时后端会直接调用大模型应用平台登录接口验证账号密码。密码不会回显；如果只改超时，可以留空继续沿用当前登录态。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>大模型应用平台地址</span>
              <input className={s.formInput} value={draft.base_url} onChange={(event) => onChange({ base_url: event.target.value })} placeholder="例如：http://192.168.106.114:7860（大模型应用平台后端 API，不是浏览器入口）" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>资源域名（asset_base_url）</span>
              <input className={s.formInput} value={draft.asset_base_url} onChange={(event) => onChange({ asset_base_url: event.target.value })} placeholder="例如：http://192.168.106.120:3002（用于解析大模型应用平台预签名相对 URL，留空则沿用大模型应用平台地址）" />
              <span className={s.fieldHint}>大模型应用平台返回的预览/下载 URL 是相对路径，需要它指向能反代 MinIO 的 nginx 入口。若大模型应用平台后端 API 同时具备 MinIO 反代，可留空。</span>
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>登录账号</span>
              <input className={s.formInput} value={draft.username} onChange={(event) => onChange({ username: event.target.value })} placeholder="请输入服务账号用户名" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>请求超时（秒）</span>
              <input className={s.formInput} value={draft.timeout_seconds} onChange={(event) => onChange({ timeout_seconds: event.target.value })} placeholder="例如：30" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>登录密码</span>
              <input type="password" className={s.formInput} value={draft.password} onChange={(event) => onChange({ password: event.target.value })} placeholder={hasToken ? '留空则沿用当前登录态' : '首次保存必须输入密码'} />
              <span className={s.fieldHint}>为了安全，当前密码不会回显；修改地址或账号时必须重新输入密码。</span>
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存并验证</button>
        </div>
      </div>
    </div>
  );
}

function QAConfigTable({
  qa,
  spaces,
  saving,
  modelOptions,
  modelLoading,
  modelError,
  onEditSpaces,
  onEditWelcomeMessage,
  onEditQuestions,
  onEditModel,
  onEditSearchPrompt,
  onEditQaPrompt,
  onEditQuickPrompt,
  onEditNormalPrompt,
  onEditExpertPrompt,
}: {
  qa: QAConfig;
  spaces: SpaceConfig[];
  saving: boolean;
  modelOptions: QAModelOption[];
  modelLoading: boolean;
  modelError: string;
  onEditSpaces: () => void;
  onEditWelcomeMessage: () => void;
  onEditQuestions: () => void;
  onEditModel: () => void;
  onEditSearchPrompt: () => void;
  onEditQaPrompt: () => void;
  onEditQuickPrompt: () => void;
  onEditNormalPrompt: () => void;
  onEditExpertPrompt: () => void;
}) {
  const generalModelId = qa.general_model || qa.selected_model || '';
  const reasoningModelId = qa.reasoning_model || '';
  const generalModelLabel = formatQaModelLabel(modelOptions, generalModelId) || '未配置';
  const reasoningModelLabel = formatQaModelLabel(modelOptions, reasoningModelId) || '未配置';

  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>问答配置</h2>
      </div>
      <p className={s.pageNote}>
        这里统一维护欢迎语、热门问题和两个模型提示词。首页 QA 卡片与问答页会直接读取这些配置。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>知识空间范围</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.knowledge_space_ids.length ? `${qa.knowledge_space_ids.length} 个空间` : '未配置'}</span>
                {qa.knowledge_space_ids.length ? (
                  <span className={s.valueMeta}>{qa.knowledge_space_ids.map((id) => spaces.find((sp) => sp.id === id)?.name || id).join('、')}</span>
                ) : null}
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEditSpaces} disabled={saving}>{saving ? '保存中...' : '编辑'}</button>
              </div>
            </td>
          </tr>
          <tr>
            <td>欢迎语</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{qa.welcome_message || '未配置'}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditWelcomeMessage} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>热门问题</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.hot_questions.length} 条</span>
                {qa.hot_questions[0] ? <span className={s.valueMeta}>例如：{qa.hot_questions[0]}</span> : null}
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQuestions} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>问答模型</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>通用模型：{generalModelLabel}</span>
                <span className={s.valueTitle}>推理模型：{reasoningModelLabel}</span>
                <span className={s.valueMeta}>
                  {modelLoading
                    ? '正在从大模型应用平台模型管理加载模型列表...'
                    : modelError
                      ? '模型列表加载失败，当前显示的是已保存配置。'
                      : '来自大模型应用平台模型管理列表，仅用于问答页模型选择。'}
                </span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditModel} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>搜索助手</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.ai_search_system_prompt ? truncateText(qa.ai_search_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于搜索页的 搜索助手 总结。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditSearchPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>快速模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.quick_mode_system_prompt ? truncateText(qa.quick_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“快速模式”，偏向简短、直接的回答。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQuickPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>普通模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.normal_mode_system_prompt ? truncateText(qa.normal_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“普通模式”，偏向结构化、可执行的回答。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditNormalPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>专家模式 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.expert_mode_system_prompt ? truncateText(qa.expert_mode_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>用于问答页“专家模式”，发送时会使用推理模型。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditExpertPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>旧技术问答 Prompt</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{qa.qa_system_prompt ? truncateText(qa.qa_system_prompt, 72) : '未配置'}</span>
                <span className={s.valueMeta}>兼容历史配置保留，新版问答页不再读取这一项。</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditQaPrompt} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function RecommendConfigTable({
  recommendation,
  saving,
  onEditHome,
  onEditDetail,
}: {
  recommendation: RecommendationConfig;
  saving: boolean;
  onEditHome: () => void;
  onEditDetail: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>推荐策略配置</h2>
      </div>
      <p className={s.pageNote}>
        推荐策略目前按场景拆分维护：首页分区推荐和详情页相关推荐可以分别调整，但都会沿用同一个 provider。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>场景</th>
            <th>当前策略</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>首页分区推荐</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{recommendation.home_strategy}</span>
                <span className={s.valueMeta}>Provider: {recommendation.provider}</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditHome} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>详情页相关推荐</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{recommendation.detail_strategy}</span>
                <span className={s.valueMeta}>Provider: {recommendation.provider}</span>
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEditDetail} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function IntegrationsConfigTable({
  integrations,
  saving,
  onEdit,
}: {
  integrations: IntegrationsConfig;
  saving: boolean;
  onEdit: () => void;
}) {
  const adminUrl = integrations.bisheng_admin_entry_url?.trim() || '';
  const knowledgeUrl = integrations.bisheng_knowledge_entry_url?.trim() || '';
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>集成配置</h2>
      </div>
      <p className={s.pageNote}>
        门户与大模型应用平台工作台的集成入口。后台入口配置后，右上角用户菜单出现「知识管理后台」；知识空间入口用于「我的知识」页面 iframe 嵌入。大模型应用平台侧需按 docs/bisheng-portal-admin-integration.md 部署对应补丁。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>知识管理后台 URL</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{adminUrl || '（未配置 — 入口隐藏）'}</span>
                <span className={s.valueMeta}>
                  示例：http://workspace.example.com/workspace/shougang-portal-admin
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEdit} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
          <tr>
            <td>我的知识嵌入 URL</td>
            <td>
              <div className={s.valueStack}>
                <span className={s.valueTitle}>{knowledgeUrl || '（未配置 — 使用数据源前端地址推导 /workspace/knowledge）'}</span>
                <span className={s.valueMeta}>
                  示例：http://workspace.example.com/workspace/knowledge
                </span>
              </div>
            </td>
            <td>
              <div className={s.actionGroup}>
                <button className={s.inlineBtn} onClick={onEdit} disabled={saving}>
                  {saving ? '保存中...' : '编辑'}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function SiteConfigTable({
  site,
  saving,
  onEdit,
}: {
  site: SiteDraft;
  saving: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>站点配置</h2>
      </div>
      <p className={s.pageNote}>
        这里维护门户品牌展示，包括顶部品牌、登录页品牌，以及浏览器标签页标题和图标。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>配置项</th>
            <th>当前值</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>顶部品牌名</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.header_brand_name}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>顶部 Header Logo</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.header_logo_url} alt="顶部 Header Logo" className={s.siteLogoPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>登录页品牌名</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.login_brand_name}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>登录页 Logo</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.login_logo_url} alt="登录页 Logo" className={s.siteLogoPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>浏览器标签页文字</td>
            <td><div className={s.valueStack}><span className={s.valueTitle}>{site.browser_title}</span></div></td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
          <tr>
            <td>浏览器标签页图标</td>
            <td>
              <div className={s.valueStack}>
                <img src={site.favicon_url} alt="浏览器标签页图标" className={s.siteFaviconPreview} />
              </div>
            </td>
            <td><div className={s.actionGroup}><button className={s.inlineBtn} onClick={onEdit} disabled={saving}>{saving ? '保存中...' : '编辑'}</button></div></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function DisplayConfigTable({
  items,
  saving,
  onAdjust,
}: {
  items: DisplayItem[];
  saving: boolean;
  onAdjust: (key: string, delta: -1 | 1) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>展示配置</h2>
      </div>
      <p className={s.pageNote}>
        这里只控制前台各模块的展示数量，不改业务内容本身。保存后首页、列表页、搜索页和详情页会按新值渲染。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>分组</th>
            <th>配置项</th>
            <th>显示数量</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key}>
              <td>{item.group}</td>
              <td>{item.label}</td>
              <td>
                <div className={s.stepper}>
                  <button
                    type="button"
                    className={s.stepperBtn}
                    onClick={() => onAdjust(item.key, -1)}
                    disabled={saving || item.value <= 0}
                    aria-label={`减少${item.label}`}
                  >
                    -
                  </button>
                  <span className={s.stepperValue}>{item.value}</span>
                  <button
                    type="button"
                    className={s.stepperBtn}
                    onClick={() => onAdjust(item.key, 1)}
                    disabled={saving}
                    aria-label={`增加${item.label}`}
                  >
                    +
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function AppsTable({
  apps,
  saving,
  onAdd,
  onEdit,
  onDelete,
}: {
  apps: AppConfig[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>应用市场管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        应用市场和首页应用入口共用这一份配置。这里维护展示顺序、名称、描述、跳转地址和启用状态。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>应用名称</th>
            <th>图标</th>
            <th>描述</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((app, index) => (
            <tr key={app.id}>
              <td>{app.id}</td>
              <td>
                <div className={s.valueStack}>
                  <span className={s.valueTitle}>{app.name}</span>
                  <span className={s.valueMeta}>{app.enabled ? '当前已启用' : '当前已停用'}</span>
                </div>
              </td>
              <td><span className={s.keyBadge}>{app.icon}</span></td>
              <td>
                <div className={s.valueStack}>
                  <span className={s.valueTitle}>{truncateText(app.desc, 44)}</span>
                  <span className={s.valueMeta}>{app.url || '未配置跳转地址'}</span>
                </div>
              </td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TextEditorDialog({
  open,
  title,
  note,
  label,
  value,
  saving,
  error,
  multiline = false,
  placeholder,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  note?: string;
  label: string;
  value: string;
  saving: boolean;
  error?: string;
  multiline?: boolean;
  placeholder?: string;
  onClose: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{title}</h3>
            {note ? <p className={s.modalNote}>{note}</p> : null}
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>{label}</span>
            {multiline ? (
              <textarea
                className={s.formTextarea}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
            ) : (
              <input
                className={s.formInput}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
              />
            )}
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function IntegrationsEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: IntegrationsDraft;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onChange: (value: IntegrationsDraft) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑集成配置</h3>
            <p className={s.modalNote}>
              后台入口控制右上角「知识管理后台」；知识空间入口控制「我的知识」页面嵌入地址。留空表示隐藏或使用默认推导。
            </p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>知识管理后台 URL</span>
            <input
              className={s.formInput}
              value={draft.bisheng_admin_entry_url}
              onChange={(event) => onChange({ ...draft, bisheng_admin_entry_url: event.target.value })}
              placeholder="例如：http://192.168.106.120:3002/workspace/shougang-portal-admin"
            />
          </label>
          <label className={`${s.formField} ${s.formFieldWide}`}>
            <span className={s.fieldLabel}>我的知识嵌入 URL</span>
            <input
              className={s.formInput}
              value={draft.bisheng_knowledge_entry_url}
              onChange={(event) => onChange({ ...draft, bisheng_knowledge_entry_url: event.target.value })}
              placeholder="例如：http://192.168.106.120:3002/workspace/knowledge"
            />
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function SiteEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: SiteDraft;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onChange: (value: SiteDraft) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑站点配置</h3>
            <p className={s.modalNote}>
              Logo 和 favicon 支持站内本地路径（如 /site-logo-new.png 或 site-logo-new.png）和 http(s) 线上图片地址。
            </p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.formGrid}>
          <label className={s.formField}>
            <span className={s.fieldLabel}>顶部品牌名</span>
            <input className={s.formInput} value={draft.header_brand_name} onChange={(event) => onChange({ ...draft, header_brand_name: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>顶部 Header Logo</span>
            <input className={s.formInput} value={draft.header_logo_url} onChange={(event) => onChange({ ...draft, header_logo_url: event.target.value })} placeholder="例如：/site-logo-new.png 或 https://example.com/logo.png" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>登录页品牌名</span>
            <input className={s.formInput} value={draft.login_brand_name} onChange={(event) => onChange({ ...draft, login_brand_name: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>登录页 Logo</span>
            <input className={s.formInput} value={draft.login_logo_url} onChange={(event) => onChange({ ...draft, login_logo_url: event.target.value })} placeholder="例如：/shougang-stock-logo.png 或 https://example.com/login-logo.png" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>浏览器标签页文字</span>
            <input className={s.formInput} value={draft.browser_title} onChange={(event) => onChange({ ...draft, browser_title: event.target.value })} placeholder="例如：首钢股份知库" />
          </label>
          <label className={s.formField}>
            <span className={s.fieldLabel}>浏览器标签页图标</span>
            <input className={s.formInput} value={draft.favicon_url} onChange={(event) => onChange({ ...draft, favicon_url: event.target.value })} placeholder="例如：/site-favicon-horizontal-v2.png 或 https://example.com/favicon.ico" />
          </label>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function QaSpacesDialog({
  open,
  spaces,
  selectedIds,
  saving,
  error,
  onClose,
  onToggle,
  onSubmit,
}: {
  open: boolean;
  spaces: SpaceConfig[];
  selectedIds: number[];
  saving: boolean;
  error?: string;
  onClose: () => void;
  onToggle: (spaceId: number) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑知识空间范围</h3>
            <p className={s.modalNote}>勾选后会同时影响首页问答入口和问答页实际可用的知识空间。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalHint}>当前已选 {selectedIds.length} 个知识空间</div>
        <div className={s.optionList}>
          <div className={s.checkboxList}>
            {spaces.map((space) => {
              const checked = selectedIds.includes(space.id);
              return (
                <button
                  key={space.id}
                  type="button"
                  className={`${s.optionRow} ${checked ? s.optionRowActive : ''}`}
                  onClick={() => onToggle(space.id)}
                >
                  <span className={s.optionMain}>
                    <span className={s.optionName}>{space.name}</span>
                    <span className={s.optionMeta}>
                      <span className={s.optionMetaItem}>ID {space.id}</span>
                      <span className={s.optionMetaItem}>{space.file_count} 个文件</span>
                    </span>
                  </span>
                  <span className={s.optionSide}>
                    <span className={s.optionCount}>{space.enabled ? '已启用' : '已停用'}</span>
                    <span className={`${s.checkboxMark} ${checked ? s.checkboxMarkActive : ''}`}>{checked ? '已选' : '选择'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function QaModelDialog({
  open,
  models,
  selectedModels,
  loading,
  saving,
  error,
  onClose,
  onSelect,
  onSubmit,
}: {
  open: boolean;
  models: QAModelOption[];
  selectedModels: QaModelDraft;
  loading: boolean;
  saving: boolean;
  error?: string;
  onClose: () => void;
  onSelect: (field: keyof QaModelDraft, modelId: string) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>编辑问答模型</h3>
            <p className={s.modalNote}>候选项直接来自大模型应用平台的模型管理列表。通用模型必选，推理模型可选，问答页会在这里配置的模型中切换。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalHint}>当前候选数：{models.length}</div>
        <div className={s.optionList}>
          {loading ? <div className={s.emptyState}>正在加载模型列表...</div> : null}
          {!loading && !models.length ? <div className={s.emptyState}>暂未获取到模型候选项</div> : null}
          {!loading && models.length ? (
            <>
              <QaModelCascaderSelect
                title="通用模型"
                required
                models={models}
                selectedModel={selectedModels.general_model}
                onSelect={(modelId) => onSelect('general_model', modelId)}
              />
              <QaModelCascaderSelect
                title="推理模型"
                allowEmpty
                models={models}
                selectedModel={selectedModels.reasoning_model}
                onSelect={(modelId) => onSelect('reasoning_model', modelId)}
              />
            </>
          ) : null}
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving || loading}>保存</button>
        </div>
      </div>
    </div>
  );
}

interface QaModelProviderGroup {
  provider_name: string;
  models: QAModelOption[];
}

function buildQaModelProviderGroups(models: QAModelOption[]): QaModelProviderGroup[] {
  const groups = new Map<string, QaModelProviderGroup>();

  models.forEach((model) => {
    const providerName = getQaModelProviderName(model);
    if (!groups.has(providerName)) {
      groups.set(providerName, { provider_name: providerName, models: [] });
    }
    groups.get(providerName)?.models.push(model);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    models: [...group.models].sort((a, b) => getQaModelDisplayName(a).localeCompare(getQaModelDisplayName(b), 'zh-Hans-CN')),
  }));
}

function getQaModelProviderName(model: QAModelOption): string {
  return model.provider_name?.trim() || '未命名服务商';
}

function getQaModelDisplayName(model: QAModelOption): string {
  return model.display_name || model.name || model.id;
}

function getQaModelOptionLabel(model: QAModelOption): string {
  const labelParts = [getQaModelDisplayName(model)];
  if (model.name && model.name !== model.display_name) {
    labelParts.push(model.name);
  }
  labelParts.push(`ID ${model.id}`);
  if (model.key && model.key !== model.id) {
    labelParts.push(`Key ${model.key}`);
  } else if (model.key) {
    labelParts.push(`Key ${model.key}`);
  }
  return labelParts.join(' / ');
}

function QaModelCascaderSelect({
  title,
  required = false,
  allowEmpty = false,
  models,
  selectedModel,
  onSelect,
}: {
  title: string;
  required?: boolean;
  allowEmpty?: boolean;
  models: QAModelOption[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
}) {
  const groups = buildQaModelProviderGroups(models);
  const selected = models.find((model) => model.id === selectedModel);
  const selectedProvider = selected ? getQaModelProviderName(selected) : '';
  const fallbackProvider = selectedProvider || groups[0]?.provider_name || '';
  const [activeProvider, setActiveProvider] = useState(fallbackProvider);
  const providerKey = groups.map((group) => group.provider_name).join('|');

  useEffect(() => {
    if (selectedProvider && selectedProvider !== activeProvider) {
      setActiveProvider(selectedProvider);
      return;
    }
    if (!activeProvider || !groups.some((group) => group.provider_name === activeProvider)) {
      setActiveProvider(fallbackProvider);
    }
  }, [activeProvider, fallbackProvider, providerKey, selectedProvider]);

  const activeGroup = groups.find((group) => group.provider_name === activeProvider) || groups[0];
  const activeModels = activeGroup?.models ?? [];
  const selectedInActiveGroup = activeModels.some((model) => model.id === selectedModel) ? selectedModel : '';

  return (
    <div className={s.qaModelSelectorCard}>
      <div className={s.qaModelSelectorHeader}>
        <div className={s.valueStack}>
          <span className={s.valueTitle}>{title}{required ? ' *' : ''}</span>
          <span className={s.valueMeta}>
            {selected
              ? `${getQaModelProviderName(selected)} / ${getQaModelOptionLabel(selected)}`
              : allowEmpty
                ? '可不配置，问答页只展示通用模型'
                : '请选择服务商和模型'}
          </span>
        </div>
        <span className={`${s.checkboxMark} ${selected ? s.checkboxMarkActive : ''}`}>
          {selected ? '已选' : required ? '必选' : '可选'}
        </span>
      </div>

      {allowEmpty ? (
        <button
          type="button"
          className={`${s.optionRow} ${!selectedModel ? s.optionRowActive : ''}`}
          onClick={() => onSelect('')}
        >
          <span className={s.optionMain}>
            <span className={s.optionName}>不配置推理模型</span>
            <span className={s.optionMeta}>问答页只展示通用模型</span>
          </span>
          <span className={s.optionSide}>
            <span className={`${s.checkboxMark} ${!selectedModel ? s.checkboxMarkActive : ''}`}>{!selectedModel ? '已选' : '选择'}</span>
          </span>
        </button>
      ) : null}

      <div className={s.qaModelSelectGrid}>
        <label className={s.formField}>
          <span className={s.fieldLabel}>服务商</span>
          <select
            className={s.formInput}
            value={activeGroup?.provider_name || ''}
            disabled={!groups.length}
            onChange={(event) => setActiveProvider(event.target.value)}
          >
            {!groups.length ? <option value="">暂无服务商</option> : null}
            {groups.map((group) => (
              <option key={group.provider_name} value={group.provider_name}>
                {group.provider_name}（{group.models.length}）
              </option>
            ))}
          </select>
        </label>
        <label className={s.formField}>
          <span className={s.fieldLabel}>模型</span>
          <select
            className={s.formInput}
            value={selectedInActiveGroup}
            disabled={!activeModels.length}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">请选择模型</option>
            {activeModels.map((model) => (
              <option key={`${title}-${model.id}`} value={model.id}>
                {getQaModelOptionLabel(model)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <div className={s.qaModelSelectedMeta}>
          <span>ID {selected.id}</span>
          {selected.key ? <span>Key {selected.key}</span> : null}
          <span>{selected.visual ? '支持视觉' : '文本模型'}</span>
        </div>
      ) : null}
    </div>
  );
}

function AppEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: AppDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<AppDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.name.trim() ? `编辑应用 · ${draft.name}` : '新增应用'}</h3>
            <p className={s.modalNote}>统一在这里维护应用名称、图标、跳转地址和卡片颜色。</p>
          </div>
          <div className={s.modalHeaderActions}>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ enabled: !draft.enabled })}>
              <span>{draft.enabled ? '已启用' : '已停用'}</span>
              <span className={`${s.switchTrack} ${draft.enabled ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.enabled ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          </div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>应用 ID</span>
              <input className={s.formInput} value={draft.id} onChange={(event) => onChange({ id: event.target.value })} placeholder="例如：7" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>应用名称</span>
              <input className={s.formInput} value={draft.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="例如：智能问答" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>跳转 URL</span>
              <input className={s.formInput} value={draft.url} onChange={(event) => onChange({ url: event.target.value })} placeholder="例如：https://example.com/app" />
              <span className={s.fieldHint}>只接受以 `http://` 或 `https://` 开头的外链地址。</span>
            </label>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>图标</span>
              <div className={s.optionPickerRow}>
                {APP_ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`${s.iconOptionBtn} ${draft.icon === icon ? s.iconOptionBtnActive : ''}`}
                    onClick={() => onChange({ icon })}
                  >
                    <DomainIcon icon={icon} color={draft.color} bg={draft.bg} size={40} />
                    <span className={s.optionLabel}>{icon}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>颜色</span>
              <div className={s.optionPickerRow}>
                {DOMAIN_COLOR_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`${s.colorOptionBtn} ${isSelectedDomainColor(draft, option) ? s.colorOptionBtnActive : ''}`}
                    onClick={() => onChange({ color: option.color, bg: option.bg })}
                  >
                    <span className={s.colorPairPreview}>
                      <span className={s.colorSwatchMain} style={{ background: option.color }} />
                      <span className={s.colorSwatchBg} style={{ background: option.bg }} />
                    </span>
                    <span className={s.optionLabel}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>应用描述</span>
              <textarea className={s.formTextarea} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} placeholder="一句话描述应用用途" />
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function AppDeleteDialog({
  open,
  app,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  app: AppConfig;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除应用</h3>
            <p className={s.modalNote}>删除后应用市场和首页入口都会同步下线。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>应用名称：</strong>{app.name}</div>
          <div className={s.confirmLine}><strong>图标：</strong>{app.icon}</div>
          <div className={s.confirmLine}><strong>跳转地址：</strong>{app.url || '未配置'}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function getQaDialogTitle(mode: Exclude<QaDialogMode, 'spaces' | null>) {
  switch (mode) {
    case 'welcome_message':
      return '编辑欢迎语';
    case 'hot_questions':
      return '编辑热门问题';
    case 'ai_search_system_prompt':
      return '编辑 搜索助手';
    case 'qa_system_prompt':
      return '编辑旧技术问答 Prompt';
    case 'quick_mode_system_prompt':
      return '编辑快速模式 Prompt';
    case 'normal_mode_system_prompt':
      return '编辑普通模式 Prompt';
    case 'expert_mode_system_prompt':
      return '编辑专家模式 Prompt';
  }
}

function getQaDialogNote(mode: Exclude<QaDialogMode, 'spaces' | null>) {
  switch (mode) {
    case 'welcome_message':
      return '首页 QA 卡片和问答页新会话首条消息都会共用这句欢迎语。';
    case 'hot_questions':
      return '每行一条，首页问答模块会按当前展示配置截取显示。';
    case 'ai_search_system_prompt':
      return '搜索页里的 搜索助手 总结会使用这一段配置。';
    case 'qa_system_prompt':
      return '兼容历史配置保留，新版问答页不再读取这一项。';
    case 'quick_mode_system_prompt':
      return '问答页选择快速模式时使用这一段系统提示词。';
    case 'normal_mode_system_prompt':
      return '问答页选择普通模式时使用这一段系统提示词。';
    case 'expert_mode_system_prompt':
      return '问答页选择专家模式时使用这一段系统提示词，并使用推理模型。';
  }
}

function getQaDialogLabel(mode: Exclude<QaDialogMode, 'spaces' | null>) {
  switch (mode) {
    case 'welcome_message':
      return '欢迎语';
    case 'hot_questions':
      return '热门问题';
    case 'ai_search_system_prompt':
      return '搜索助手';
    case 'qa_system_prompt':
      return '旧技术问答 Prompt';
    case 'quick_mode_system_prompt':
      return '快速模式 Prompt';
    case 'normal_mode_system_prompt':
      return '普通模式 Prompt';
    case 'expert_mode_system_prompt':
      return '专家模式 Prompt';
  }
}

function getQaDialogPlaceholder(mode: Exclude<QaDialogMode, 'spaces' | null>) {
  switch (mode) {
    case 'welcome_message':
      return '例如：你好，我是首钢股份知库智能助手，请问有什么可以帮您？';
    case 'hot_questions':
      return '每行输入一条热门问题';
    default:
      return '请输入内容';
  }
}

function createAppDraft(current?: AppConfig): AppDraft {
  return {
    id: current ? String(current.id) : '',
    name: current?.name ?? '',
    icon: current?.icon ?? 'Bot',
    desc: current?.desc ?? '',
    color: current?.color ?? '#2563eb',
    bg: current?.bg ?? '#eff6ff',
    url: current?.url ?? '',
    enabled: current?.enabled ?? true,
  };
}

function validateAppDraft(draft: AppDraft): { app?: AppConfig; error?: string } {
  const id = Number(draft.id.trim());
  if (!Number.isFinite(id) || id <= 0) return { error: '请输入有效的应用 ID' };

  const name = draft.name.trim();
  if (!name) return { error: '请输入应用名称' };

  const icon = draft.icon.trim();
  if (!icon) return { error: '请输入图标名' };

  const desc = draft.desc.trim();
  if (!desc) return { error: '请输入应用描述' };

  const color = draft.color.trim();
  if (!color) return { error: '请输入主色' };

  const bg = draft.bg.trim();
  if (!bg) return { error: '请输入背景色' };

  const url = draft.url.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { error: '跳转 URL 只接受以 http:// 或 https:// 开头的地址' };
  }

  return {
    app: {
      id,
      name,
      icon,
      desc,
      color,
      bg,
      url,
      enabled: draft.enabled,
    },
  };
}

function getDisplayItems(display: DisplayConfig): DisplayItem[] {
  return [
    { group: '首页', key: 'home.section_page_size', label: '知识推荐/典型案例条数', value: display.home.section_page_size },
    { group: '首页', key: 'home.hot_tags_count', label: '热门标签条数', value: display.home.hot_tags_count },
    { group: '首页', key: 'home.qa_hot_count', label: '技术问答热门问题条数', value: display.home.qa_hot_count },
    { group: '首页', key: 'home.domain_count', label: '业务域导航条数', value: display.home.domain_count },
    { group: '首页', key: 'home.spaces_count', label: '知识广场条数', value: display.home.spaces_count },
    { group: '首页', key: 'home.apps_count', label: '应用市场条数', value: display.home.apps_count },
    { group: '列表页', key: 'list.page_size', label: '列表页每页文档数', value: display.list.page_size },
    { group: '列表页', key: 'list.visible_tag_count', label: '列表页单条标签展示数', value: display.list.visible_tag_count },
    { group: '搜索页', key: 'search.page_size', label: '搜索页每页文档数', value: display.search.page_size },
    { group: '搜索页', key: 'search.visible_tag_count', label: '搜索页单条标签展示数', value: display.search.visible_tag_count },
    { group: '详情页', key: 'detail.related_files_count', label: '相关推荐条数', value: display.detail.related_files_count },
    { group: '详情页', key: 'detail.visible_tag_count', label: '相关推荐标签展示数', value: display.detail.visible_tag_count },
  ];
}

async function persistSpaces(spaces: SpaceConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSpacesConfig(spaces);
  setConfig((current) => (current ? { ...current, spaces: data.spaces } : current));
}

async function persistDomains(domains: DomainConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateDomainsConfig(domains);
  setConfig((current) => (current ? { ...current, domains: data.domains } : current));
}

async function persistSections(sections: SectionConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSectionsConfig(sections);
  setConfig((current) => (current ? { ...current, sections: data.sections } : current));
}

async function persistQa(qa: QAConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateQaConfig(qa);
  setConfig((current) => (current ? { ...current, qa: data } : current));
}

async function persistRecommendation(recommendation: RecommendationConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateRecommendationConfig(recommendation);
  setConfig((current) => (current ? { ...current, recommendation: data } : current));
}

async function persistDisplay(display: DisplayConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateDisplayConfig(display);
  setConfig((current) => (current ? { ...current, display: data } : current));
}

async function persistApps(apps: AppConfig[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateAppsConfig(apps);
  setConfig((current) => (current ? { ...current, apps: data.apps } : current));
}

async function persistIntegrations(integrations: IntegrationsConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateIntegrationsConfig(integrations);
  setConfig((current) => (current ? { ...current, integrations: data } : current));
}

async function persistSite(site: SiteConfig, setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateSiteConfig(site);
  setConfig((current) => (current ? { ...current, site: data } : current));
}

type SaveRunner = (task: () => Promise<void>) => Promise<void>;
type ConfigSetter = Dispatch<SetStateAction<PortalConfig | null>>;

async function handleAddSpace(
  spaces: SpaceConfig[],
  option: SpaceOption,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  onSuccess?: () => void,
) {
  await runSave(async () => {
    await persistSpaces(upsertSpace(spaces, option), setConfig);
    onSuccess?.();
  });
}

async function handleToggleSpaceEnabled(
  spaces: SpaceConfig[],
  index: number,
  enabled: boolean,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  if (spaces[index]?.enabled === enabled) return;
  await runSave(() => persistSpaces(setSpaceEnabled(spaces, index, enabled), setConfig));
}

async function handleDeleteSpace(
  spaces: SpaceConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { confirm?: boolean; onSuccess?: () => void },
) {
  if (options?.confirm !== false && !window.confirm(`确定删除知识空间“${spaces[index].name}”吗？`)) return;
  await runSave(async () => {
    await persistSpaces(spaces.filter((_, i) => i !== index), setConfig);
    options?.onSuccess?.();
  });
}

async function handleAddDomain(
  domains: DomainConfig[],
  next: DomainConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  await runSave(async () => {
    await persistDomains([...domains, next], setConfig);
    options?.onSuccess?.();
  });
}

async function handleEditDomain(
  domains: DomainConfig[],
  index: number,
  next: DomainConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  const updated = [...domains];
  updated[index] = next;
  await runSave(async () => {
    await persistDomains(updated, setConfig);
    options?.onSuccess?.();
  });
}

async function handleDeleteDomain(
  domains: DomainConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { confirm?: boolean; onSuccess?: () => void },
) {
  if (options?.confirm !== false && !window.confirm(`确定删除业务域“${domains[index].name}”吗？`)) return;
  await runSave(async () => {
    await persistDomains(domains.filter((_, i) => i !== index), setConfig);
    options?.onSuccess?.();
  });
}

async function handleMoveDomain(
  domains: DomainConfig[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= domains.length) return;
  const reordered = [...domains];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistDomains(reordered, setConfig));
}

async function handleAddSection(
  sections: SectionConfig[],
  next: SectionConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  await runSave(async () => {
    await persistSections([...sections, next], setConfig);
    options?.onSuccess?.();
  });
}

async function handleEditSection(
  sections: SectionConfig[],
  index: number,
  next: SectionConfig,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { onSuccess?: () => void },
) {
  const updated = [...sections];
  updated[index] = next;
  await runSave(async () => {
    await persistSections(updated, setConfig);
    options?.onSuccess?.();
  });
}

async function handleDeleteSection(
  sections: SectionConfig[],
  index: number,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
  options?: { confirm?: boolean; onSuccess?: () => void },
) {
  if (options?.confirm !== false && !window.confirm(`确定删除分区“${sections[index].title}”吗？`)) return;
  await runSave(async () => {
    await persistSections(sections.filter((_, i) => i !== index), setConfig);
    options?.onSuccess?.();
  });
}

async function handleMoveSection(
  sections: SectionConfig[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sections.length) return;
  const reordered = [...sections];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistSections(reordered, setConfig));
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatQaModelLabel(models: QAModelOption[], modelId: string): string {
  if (!modelId) return '';
  const model = models.find((item) => item.id === modelId);
  return model ? (model.display_name || model.name || model.id) : modelId;
}


async function handleAdjustDisplay(
  display: DisplayConfig,
  key: string,
  delta: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const currentValue = getDisplayValue(display, key);
  const nextValue = Math.max(0, currentValue + delta);
  if (nextValue === currentValue) return;
  await runSave(() => persistDisplay(setDisplayValue(display, key, nextValue), setConfig));
}

function getDisplayValue(display: DisplayConfig, key: string): number {
  const [group, field] = key.split('.');
  switch (group) {
    case 'home':
      return display.home[field as keyof DisplayConfig['home']];
    case 'list':
      return display.list[field as keyof DisplayConfig['list']];
    case 'search':
      return display.search[field as keyof DisplayConfig['search']];
    case 'detail':
      return display.detail[field as keyof DisplayConfig['detail']];
    default:
      return 0;
  }
}

function setDisplayValue(display: DisplayConfig, key: string, value: number): DisplayConfig {
  const [group, field] = key.split('.');
  return {
    ...display,
    [group]: {
      ...display[group as keyof DisplayConfig],
      [field]: value,
    },
  };
}

function createBishengDraft(current?: BishengRuntimeConfig): BishengDraft {
  return {
    base_url: current?.base_url ?? '',
    asset_base_url: current?.asset_base_url ?? '',
    username: current?.username ?? '',
    password: '',
    timeout_seconds: current ? String(current.timeout_seconds) : '30',
  };
}

function createIntegrationsDraft(current?: IntegrationsConfig): IntegrationsDraft {
  return {
    bisheng_admin_entry_url: current?.bisheng_admin_entry_url ?? '',
    bisheng_knowledge_entry_url: current?.bisheng_knowledge_entry_url ?? '',
  };
}

function createSiteDraft(current?: SiteConfig): SiteDraft {
  return {
    header_brand_name: current?.header_brand_name ?? '首钢股份知库',
    header_logo_url: current?.header_logo_url ?? '/site-logo-new.png',
    login_brand_name: current?.login_brand_name ?? '首钢股份知库',
    login_logo_url: current?.login_logo_url ?? '/shougang-stock-logo.png',
    browser_title: current?.browser_title ?? '首钢股份知库',
    favicon_url: current?.favicon_url ?? '/site-favicon-horizontal-v2.png',
  };
}

function validateSiteDraft(draft: SiteDraft): { site?: SiteConfig; error?: string } {
  const site: SiteConfig = {
    header_brand_name: draft.header_brand_name.trim(),
    header_logo_url: normalizeAssetUrl(draft.header_logo_url),
    login_brand_name: draft.login_brand_name.trim(),
    login_logo_url: normalizeAssetUrl(draft.login_logo_url),
    browser_title: draft.browser_title.trim(),
    favicon_url: normalizeAssetUrl(draft.favicon_url),
  };
  if (!site.header_brand_name) return { error: '请输入顶部品牌名' };
  if (!site.login_brand_name) return { error: '请输入登录页品牌名' };
  if (!site.browser_title) return { error: '请输入浏览器标签页文字' };
  for (const [label, value] of [
    ['顶部 Header Logo', site.header_logo_url],
    ['登录页 Logo', site.login_logo_url],
    ['浏览器标签页图标', site.favicon_url],
  ] as const) {
    if (!value) return { error: `请输入${label}` };
    if (!isValidAssetUrl(value)) return { error: `${label} 需填写站内本地路径或 http(s) 线上图片地址` };
  }
  return { site };
}

function normalizeAssetUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return `/${trimmed.replace(/^\.?\//, '')}`;
}

function isValidAssetUrl(value: string): boolean {
  return value.startsWith('/') || /^https?:\/\//i.test(value);
}

function validateBishengDraft(draft: BishengDraft): {
  payload?: {
    base_url: string;
    asset_base_url: string;
    username: string;
    password: string;
    timeout_seconds: number;
  };
  error?: string;
} {
  const base_url = draft.base_url.trim();
  if (!/^https?:\/\//i.test(base_url)) return { error: '请输入有效的大模型应用平台地址，必须以 http:// 或 https:// 开头' };

  const asset_base_url = draft.asset_base_url.trim();
  if (asset_base_url && !/^https?:\/\//i.test(asset_base_url)) {
    return { error: '资源域名（asset_base_url）必须以 http:// 或 https:// 开头，留空则与大模型应用平台地址相同' };
  }

  const timeout_seconds = Number(draft.timeout_seconds.trim());
  if (!Number.isFinite(timeout_seconds) || timeout_seconds <= 0) {
    return { error: '请输入有效的超时时间（秒）' };
  }

  return {
    payload: {
      base_url,
      asset_base_url,
      username: draft.username.trim(),
      password: draft.password,
      timeout_seconds,
    },
  };
}

async function persistBanners(banners: BannerSlide[], setConfig: Dispatch<SetStateAction<PortalConfig | null>>) {
  const data = await updateBannersConfig(banners);
  setConfig((current) => (current ? { ...current, banners: data.banners } : current));
}

async function handleMoveBanner(
  banners: BannerSlide[],
  index: number,
  direction: -1 | 1,
  runSave: SaveRunner,
  setConfig: ConfigSetter,
) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= banners.length) return;
  const reordered = [...banners];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(nextIndex, 0, moved);
  await runSave(() => persistBanners(reordered, setConfig));
}

function BannersTable({
  banners,
  saving,
  onAdd,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  banners: BannerSlide[];
  saving: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) {
  return (
    <>
      <div className={s.titleBar}>
        <h2 className={s.pageTitle}>首页 Banner 管理</h2>
        <button className={s.addBtn} onClick={onAdd} disabled={saving}><Plus size={14} /> 添加</button>
      </div>
      <p className={s.pageNote}>
        管理首页顶部轮播 Banner。可上传本地图片或填写外部图片地址；列表顺序即轮播顺序，停用后该 Banner 不会出现在前台。
      </p>
      <table className={s.table}>
        <thead>
          <tr>
            <th>顺序</th>
            <th>预览</th>
            <th>标题 / 副标题</th>
            <th>跳转</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {banners.map((banner, index) => (
            <tr key={banner.id}>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onMoveUp(index)} disabled={saving || index === 0} aria-label="上移"><ArrowUp size={14} /></button>
                  <button className={s.inlineBtn} onClick={() => onMoveDown(index)} disabled={saving || index === banners.length - 1} aria-label="下移"><ArrowDown size={14} /></button>
                </div>
              </td>
              <td>
                {banner.image_url ? (
                  <img
                    src={banner.image_url}
                    alt={banner.title}
                    style={{ width: 120, height: 60, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                  />
                ) : (
                  <span className={s.inlineHint}>无图片</span>
                )}
              </td>
              <td>
                <div className={s.valueStack}>
                  {banner.label ? <span className={s.valueMeta}>{banner.label}</span> : null}
                  <span className={s.valueTitle}>{banner.title}</span>
                  {banner.desc ? <span className={s.valueMeta}>{truncateText(banner.desc, 48)}</span> : null}
                </div>
              </td>
              <td>{banner.link_url ? <span className={s.valueMeta}>{truncateText(banner.link_url, 36)}</span> : <span className={s.inlineHint}>不可点击</span>}</td>
              <td>
                <span className={banner.enabled ? s.stateEnabled : s.stateDisabled}>
                  {banner.enabled ? '已启用' : '已停用'}
                </span>
              </td>
              <td>
                <div className={s.actionGroup}>
                  <button className={s.inlineBtn} onClick={() => onEdit(index)} disabled={saving}>编辑</button>
                  <button className={s.inlineDangerBtn} onClick={() => onDelete(index)} disabled={saving}>删除</button>
                </div>
              </td>
            </tr>
          ))}
          {!banners.length ? (
            <tr><td colSpan={6}><div className={s.emptyState}>暂无 Banner，点击右上角「添加」创建一条。</div></td></tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}

const BANNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const BANNER_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

function ImageUploadField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > BANNER_IMAGE_MAX_BYTES) {
      setError('图片不得超过 5MB');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const data = await uploadBannerImage(file);
      onChange(data.image_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={s.subtleBtn}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          <Upload size={14} />
          {uploading ? '上传中…' : '上传图片'}
        </button>
        <span className={s.fieldHint}>支持 JPEG / PNG / WebP，最大 5MB</span>
        <input
          ref={inputRef}
          type="file"
          accept={BANNER_IMAGE_ACCEPT}
          style={{ display: 'none' }}
          onChange={handleSelect}
        />
      </div>
      {value ? (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <img
            src={value}
            alt="预览"
            style={{ maxWidth: 240, maxHeight: 120, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--neutral-200)' }}
          />
          <button
            type="button"
            className={s.subtleBtn}
            onClick={() => onChange('')}
            disabled={disabled || uploading}
            aria-label="移除图片"
          >
            <X size={14} /> 移除
          </button>
        </div>
      ) : null}
      {error ? <div className={s.errorBox} style={{ marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}

function BannerEditorDialog({
  open,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  draft: BannerDraft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (patch: Partial<BannerDraft>) => void;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>{draft.title.trim() ? `编辑 Banner · ${draft.title}` : '新增 Banner'}</h3>
            <p className={s.modalNote}>统一在这里维护首页轮播 Banner 的图片、文案和跳转地址。</p>
          </div>
          <div className={s.modalHeaderActions}>
            <button type="button" className={s.headerSwitch} onClick={() => onChange({ enabled: !draft.enabled })}>
              <span>{draft.enabled ? '已启用' : '已停用'}</span>
              <span className={`${s.switchTrack} ${draft.enabled ? s.switchTrackActive : ''}`}>
                <span className={`${s.switchThumb} ${draft.enabled ? s.switchThumbActive : ''}`} />
              </span>
            </button>
            <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          </div>
        </div>
        {error ? <div className={s.errorBox}>{error}</div> : null}
        <div className={s.modalScrollBody}>
          <div className={s.formGrid}>
            <label className={s.formField}>
              <span className={s.fieldLabel}>Banner ID</span>
              <input className={s.formInput} value={draft.id} onChange={(event) => onChange({ id: event.target.value })} placeholder="例如：4" />
            </label>
            <label className={s.formField}>
              <span className={s.fieldLabel}>左上角小标签</span>
              <input className={s.formInput} value={draft.label} onChange={(event) => onChange({ label: event.target.value })} placeholder="例如：平台概览" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>主标题</span>
              <input className={s.formInput} value={draft.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="例如：首钢股份知库 — 钢铁行业知识共享平台" />
            </label>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>副标题</span>
              <textarea className={s.formTextarea} value={draft.desc} onChange={(event) => onChange({ desc: event.target.value })} placeholder="一句话描述 Banner 主题" />
            </label>
            <div className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>图片</span>
              <ImageUploadField
                value={draft.image_url}
                onChange={(next) => onChange({ image_url: next })}
                disabled={saving}
              />
              <input
                className={s.formInput}
                value={draft.image_url}
                onChange={(event) => onChange({ image_url: event.target.value })}
                placeholder="或填写图片地址：/banner-hero-1.jpg 或 https://…"
                style={{ marginTop: 8 }}
              />
            </div>
            <label className={`${s.formField} ${s.formFieldWide}`}>
              <span className={s.fieldLabel}>跳转 URL</span>
              <input className={s.formInput} value={draft.link_url} onChange={(event) => onChange({ link_url: event.target.value })} placeholder="留空则 Banner 不可点击" />
              <span className={s.fieldHint}>填写后整张 Banner 可点击，跳转到此地址（http(s):// 开头）。</span>
            </label>
          </div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
          <button className={s.addBtn} onClick={onSubmit} disabled={saving}>保存</button>
        </div>
      </div>
    </div>
  );
}

function BannerDeleteDialog({
  open,
  banner,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  banner: BannerSlide;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.confirmCard} onClick={(event) => event.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <h3 className={s.modalTitle}>删除 Banner</h3>
            <p className={s.modalNote}>删除后首页该 Banner 立即下线。已上传到服务器的图片文件不会被自动清理。</p>
          </div>
          <button className={s.subtleBtn} onClick={onClose}>取消</button>
        </div>
        <div className={s.confirmBody}>
          <div className={s.confirmLine}><strong>主标题：</strong>{banner.title}</div>
          {banner.label ? <div className={s.confirmLine}><strong>小标签：</strong>{banner.label}</div> : null}
          <div className={s.confirmLine}><strong>图片：</strong>{banner.image_url}</div>
        </div>
        <div className={s.confirmActions}>
          <button className={s.subtleBtn} onClick={onClose}>关闭</button>
          <button className={s.dangerBtn} onClick={onConfirm} disabled={saving}>确认删除</button>
        </div>
      </div>
    </div>
  );
}
