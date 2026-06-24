import { useMemo, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Eye,
  FileText,
  Globe,
  PenLine,
  Search,
  Send,
  Server,
  Star,
  Upload,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import s from './AppsPage.module.css';

type Category = '全部' | '收藏' | 'AI问答' | 'AI写作' | 'AI识别' | 'AI审核';
type AgentCategory = Exclude<Category, '全部' | '收藏'>;
type ColorKey = 'teal' | 'blue' | 'amber' | 'indigo' | 'cyan' | 'emerald' | 'orange' | 'rose' | 'violet' | 'sky';
type CategoryStyle = 'qa' | 'write' | 'detect' | 'review';

interface Agent {
  id: number;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  color: ColorKey;
  name: string;
  desc: string;
  cat: AgentCategory;
  catStyle: CategoryStyle;
  tags: string[];
  fav: boolean;
}

const HISTORY_GROUPS = [
  {
    label: '今天',
    items: ['季度销售数据分析报告', '新员工入职流程优化', 'API 接口文档整理'],
  },
  {
    label: '昨天',
    items: ['竞品调研与功能对比', '客户投诉处理方案', '周报自动生成模板'],
  },
  {
    label: '更早',
    items: ['产品需求文档撰写', '运营活动策划方案', '代码 Review 建议', '用户调研问卷设计'],
  },
];

const CATEGORIES: Category[] = ['全部', '收藏', 'AI问答', 'AI写作', 'AI识别', 'AI审核'];

const AGENTS: Agent[] = [
  { id: 0, icon: BookOpen, color: 'teal', name: '制度专家', desc: '解读企业内部制度文件，快速定位制度条款与执行要求', cat: 'AI问答', catStyle: 'qa', tags: ['制度解读', '规章', '内控'], fav: true },
  { id: 1, icon: CheckCircle2, color: 'blue', name: '安全法律法规', desc: '快速检索安全生产相关法律法规条文，精准定位合规依据', cat: 'AI问答', catStyle: 'qa', tags: ['法规查询', '合规', '安全生产'], fav: false },
  { id: 2, icon: Globe, color: 'amber', name: '差旅问答助手', desc: '针对差旅报销政策进行智能问答，快速解答出行相关疑问', cat: 'AI问答', catStyle: 'qa', tags: ['差旅', '报销', '政策问答'], fav: false },
  { id: 3, icon: FileText, color: 'indigo', name: '总结报告', desc: '自动整理工作内容，生成结构清晰的总结汇报材料', cat: 'AI写作', catStyle: 'write', tags: ['工作总结', '汇报', 'PPT大纲'], fav: true },
  { id: 4, icon: Send, color: 'blue', name: '工作推进方案', desc: '根据目标拆解任务，生成可落地的工作推进计划', cat: 'AI写作', catStyle: 'write', tags: ['计划制定', '任务拆解', '推进'], fav: false },
  { id: 5, icon: BarChart3, color: 'cyan', name: '行业洞察简报', desc: '聚合行业动态，自动生成简报，助力管理层决策', cat: 'AI写作', catStyle: 'write', tags: ['行业分析', '简报', '决策支持'], fav: false },
  { id: 6, icon: PenLine, color: 'emerald', name: '办公材料撰写', desc: '一键生成通知、报告、方案等各类办公文档', cat: 'AI写作', catStyle: 'write', tags: ['文档生成', '公文', '效率'], fav: false },
  { id: 7, icon: Search, color: 'orange', name: '项目查重', desc: '对比项目文件与历史档案，识别重复立项与资源冲突', cat: 'AI识别', catStyle: 'detect', tags: ['查重', '项目管理', '去重'], fav: false },
  { id: 8, icon: Eye, color: 'rose', name: 'AI识隐患', desc: '智能识别作业现场安全隐患，生成隐患报告与整改建议', cat: 'AI识别', catStyle: 'detect', tags: ['隐患识别', '现场安全', 'AI检测'], fav: false },
  { id: 9, icon: AlertCircle, color: 'violet', name: '安全重大火灾隐患', desc: '专项排查重大火灾隐患，提供标准化整改处置方案', cat: 'AI识别', catStyle: 'detect', tags: ['火灾隐患', '消防', '整改'], fav: false },
  { id: 10, icon: ClipboardList, color: 'sky', name: '合同审核', desc: '智能审查合同条款风险，标注异常条款并给出修改建议', cat: 'AI审核', catStyle: 'review', tags: ['合同', '风险审查', '法务'], fav: false },
];

export default function AppsPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('全部');
  const [activeHistory, setActiveHistory] = useState('季度销售数据分析报告');
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(
    () => new Set(AGENTS.filter((agent) => agent.fav).map((agent) => agent.id)),
  );

  const visibleAgents = useMemo(() => {
    if (activeCategory === '全部') return AGENTS;
    if (activeCategory === '收藏') return AGENTS.filter((agent) => favoriteIds.has(agent.id));
    return AGENTS.filter((agent) => agent.cat === activeCategory);
  }, [activeCategory, favoriteIds]);

  const toggleFavorite = (id: number) => {
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <PageShell>
      <div className={s.page}>
        <div className={s.shell}>
          <aside className={s.sidebar}>
            <div className={s.logoRow}>
              <div className={s.logoIcon}>
                <Bot size={17} strokeWidth={2} />
              </div>
            </div>
            <div className={s.sidebarBody}>
              <button className={s.newButton} type="button">
                <PenLine size={14} strokeWidth={2} />
                发起新对话
              </button>
              <button className={s.searchButton} type="button">
                <Search size={14} strokeWidth={2} />
                搜索对话内容
              </button>
            </div>
            <div className={s.sidebarSection}>最近</div>
            <div className={s.historyList}>
              {HISTORY_GROUPS.map((group) => (
                <div className={s.historyGroup} key={group.label}>
                  <div className={s.historyGroupLabel}>{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      className={`${s.historyItem} ${activeHistory === item ? s.historyItemActive : ''}`}
                      key={item}
                      onClick={() => setActiveHistory(item)}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <section className={s.mainPanel}>
            <div className={s.topbar} />

            <div className={s.mainBody}>
              <div className={s.inputWrap}>
                <div className={s.inputBox}>
                  <div className={s.inputRow}>
                    <textarea aria-label="开始提问" placeholder="开始提问..." />
                    <div className={s.inputRowActions}>
                      <button className={s.modelButton} type="button">
                        <Server size={12} strokeWidth={2} />
                        选择模型
                        <ChevronDown size={12} strokeWidth={2} />
                      </button>
                      <div className={s.separator} />
                      <button className={s.toolButton} title="上传文件" type="button">
                        <Upload size={16} strokeWidth={2} />
                      </button>
                      <button className={s.sendButton} title="发送" type="button">
                        <Send size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  <div className={s.inputFooter}>
                    <span className={s.footerHint}>支持上传单文档和图片</span>
                    <button className={s.footerLink} type="button">
                      <Server size={12} strokeWidth={2} />
                      选择知识空间
                    </button>
                  </div>
                </div>
              </div>

              <div className={s.agentZone}>
                <div className={s.agentHeader}>
                  <div className={s.agentTitle}>
                    <span className={s.agentTitleBar} />
                    Agent 智能体
                  </div>
                </div>

                <div className={s.tabs} role="tablist" aria-label="智能体分类">
                  {CATEGORIES.map((category) => (
                    <button
                      aria-selected={activeCategory === category}
                      className={`${s.tab} ${category === '收藏' ? s.favoriteTab : ''} ${activeCategory === category ? s.tabActive : ''}`}
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      role="tab"
                      type="button"
                    >
                      {category === '收藏' ? <Star size={12} strokeWidth={2} /> : null}
                      {category}
                    </button>
                  ))}
                </div>

                <div className={s.agentGrid}>
                  {activeCategory === '收藏' && visibleAgents.length === 0 ? (
                    <div className={s.emptyFavorite}>
                      <Star className={s.emptyFavoriteIcon} size={32} strokeWidth={2} />
                      <div className={s.emptyFavoriteText}>暂无收藏的智能体</div>
                      <div className={s.emptyFavoriteSub}>点击卡片右上角星标即可收藏</div>
                    </div>
                  ) : (
                    visibleAgents.map((agent) => {
                      const Icon = agent.icon;
                      const isFavorite = favoriteIds.has(agent.id);
                      return (
                        <article className={s.agentCard} key={agent.id}>
                          <div className={s.agentCardTop}>
                            <div className={`${s.agentIcon} ${s[agent.color]}`}>
                              <Icon size={16} strokeWidth={2} />
                            </div>
                            <div className={s.agentCardMeta}>
                              <div className={`${s.agentCategory} ${s[agent.catStyle]}`}>{agent.cat}</div>
                              <button
                                aria-label={isFavorite ? `取消收藏${agent.name}` : `收藏${agent.name}`}
                                className={`${s.favoriteButton} ${isFavorite ? s.favoriteButtonActive : ''}`}
                                onClick={() => toggleFavorite(agent.id)}
                                title={isFavorite ? '取消收藏' : '收藏'}
                                type="button"
                              >
                                <Star size={14} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                          <div className={s.agentName}>{agent.name}</div>
                          <div className={s.agentDesc}>{agent.desc}</div>
                          <div className={s.agentTags}>
                            {agent.tags.map((tag) => (
                              <span className={s.agentTag} key={tag}>{tag}</span>
                            ))}
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
