import {
  Building, CheckCircle, Factory, Settings, Shield, Snowflake, Zap, Leaf, Truck, Network, Wrench, GraduationCap, type LucideIcon,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useCallback } from 'react';
import PageShell from '../components/PageShell';
import SectionHeader from '../components/SectionHeader';
import { getDomainVisualPreset } from '../utils/domainVisualPresets';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { getEnabledDomains, getEnabledSpaces, getPrimarySpaceId } from '../utils/portalConfig';
import { buildSpaceSearchPath } from '../utils/searchParams';
import s from './DomainsPage.module.css';

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  Settings,
  Factory,
  Snowflake,
  Zap,
  Shield,
  CheckCircle,
  Leaf,
  Truck,
  Network,
  Wrench,
  GraduationCap,
};

export default function DomainsPage() {
  const navigate = useNavigate();
  const { config } = usePortalConfig();
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
  const spaces = config ? getEnabledSpaces(config.spaces) : [];
  const domains = config ? getEnabledDomains(config.domains, config.spaces) : [];

  return (
    <PageShell>
      <div className={s.container}>
        <Link to="/" className={s.backLink}>返回首页</Link>
        <SectionHeader icon={Building} title="全部业务域" size="large" />
        <p className={s.lead}>
          汇总首页业务域入口，点击后进入对应业务域的知识检索页。
        </p>
        <div className={s.grid}>
          {domains.map((domain) => {
            const Icon = DOMAIN_ICONS[domain.icon] || Settings;
            const space = spaces.find((item) => item.id === getPrimarySpaceId(domain.space_ids));
            const visualPreset = getDomainVisualPreset(domain);
            const domainBackground = visualPreset.backgroundImage;
            const usesBannerThumb = Boolean(domainBackground);

            return (
              <button
                key={domain.name}
                type="button"
                className={`${s.card} ${usesBannerThumb ? s.cardImage : ''}`}
                style={usesBannerThumb ? { backgroundImage: `url("${domainBackground}")` } : undefined}
                onClick={() => {
                  const targetSpaceId = getPrimarySpaceId(domain.space_ids);
                  if (targetSpaceId) navigateToTop(buildSpaceSearchPath(targetSpaceId));
                }}
              >
                {usesBannerThumb ? null : (
                  <div className={s.iconWrap} style={{ background: domain.bg, color: domain.color }}>
                    <Icon size={24} />
                  </div>
                )}
                <div className={s.cardBody}>
                  <div className={s.name}>{domain.name}</div>
                  <div className={s.meta}>{space?.name || `空间 ${domain.space_ids.join(', ')}`}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
