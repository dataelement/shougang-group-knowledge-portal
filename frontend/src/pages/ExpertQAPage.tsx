import { useState, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BadgeCheck,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Edit3,
  PenLine,
  Tag,
  Trash2,
  User,
  Settings, Shield, Leaf, GraduationCap, Network, Zap, Factory,
  type LucideIcon,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import {
  deleteExpertQuestion,
  fetchAnswersPaged,
  fetchConfigData,
  fetchExpertProfiles,
  fetchExpertQuestions,
  statistics,
  updateExpertQuestion,
  type ApiAnswer,
  type ApiQuestion,
  type ExpertProfileResponse,
} from '../api/expertQa';
import { SORT_TABS, STATUS_FILTERS } from '../data/expertQaData';
import type { StatusFilterKey, TranslationStatistics } from '../types/expertQa';
import s from './ExpertQAPage.module.css';
import type { DomainConfig } from '../api/adminConfig';
import { useAuth } from '../hooks/useAuth';

type SortKey = 'latest' | 'hot' | 'unanswered';

const iconMap: Record<string, LucideIcon> = {
  CheckCircle: CheckCircle,
  Settings: Settings,
  Shield: Shield,
  Leaf: Leaf,
  GraduationCap: GraduationCap,
  Network: Network,
  Zap: Zap,
  Factory: Factory,
};

type QuestionEntry = {
  id: number;
  title: string;
  body: string;
  excerpt: string;
  votes: number;
  views: number;
  answers: number;
  acceptedAnswers: number;
  domain: string;
  statusMeta: { text: string; cls: string };
  asker: { name: string; initial: string };
  bounty?: number;
  invitedSummary?: string;
  acceptedPreview?: {
    author: { expert_name: string; depart_ment: string };
    excerpt: string;
    accepted: boolean;
  };
  askedAt: string;
};

function getStatusFromApi(status: number, answerCount: number): { text: string; cls: string } {
  if (answerCount === 0) return { text: 'unanswered', cls: s.urgent };
  if (status === 1) return { text: 'solved', cls: s.solved };
  return { text: 'unsolved', cls: s.unsolved };
}

function textExcerpt(text: string | null | undefined, max = 96): string {
  const value = (text ?? '').trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function buildAnswerPreview(answer: ApiAnswer): QuestionEntry['acceptedPreview'] {
  const expert = answer.expert;
  return {
    author: {
      expert_name: answer.expert_name || expert?.expert_name || '专家回答',
      depart_ment: expert?.depart_ment || '',
    },
    excerpt: textExcerpt(answer.content, 120),
    accepted: answer.status === 2 || Boolean(answer.adopted),
  };
}

function getInvitedSummary(question: ApiQuestion): string | undefined {
  const names = question.experts_names || question.invited_experts;
  if (!names?.trim()) return undefined;
  const list = names
    .split(/[;,，；]/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (list.length === 0) return undefined;
  return `邀请：${list.slice(0, 2).join('、')}${list.length > 2 ? ` 等 ${list.length} 人` : ''}`;
}

const stringToColor = (str: string | null | undefined): string => {
  if (!str) return '#cccccc';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = Math.abs(hash).toString(16).padStart(6, '0');
  return `#${color}`;
};

function QuestionCard({
  q,
  showOwnerActions,
  onOpen,
  onEdit,
  onDelete,
}: {
  q: QuestionEntry;
  showOwnerActions: boolean;
  onOpen: (id: number) => void;
  onEdit: (q: QuestionEntry) => void;
  onDelete: (q: QuestionEntry) => void;
}) {
  const accepted = q.acceptedPreview;
  const handleOpen = () => onOpen(q.id);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') handleOpen();
  };

  return (
    <article
      className={s.qCard}
      role="link"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      <div className={s.qStatsCol}>
        <div className={s.statBlock}>
          <span className={s.statNum}>{q.votes}</span>
          <span className={s.statLb}>投票</span>
        </div>
        <div
          className={`${s.statBlock} ${s.statAns} ${q.acceptedAnswers > 0 ? s.statSolved : ''}`}
        >
          <span className={s.statNum}>{q.answers}</span>
          <span className={s.statLb}>{q.acceptedAnswers > 0 ? '已采纳' : '回答'}</span>
        </div>
        <div className={`${s.statBlock} ${s.statViews}`}>
          <span className={s.statNum}>{q.views}</span>
          <span className={s.statLb}>浏览</span>
        </div>
      </div>
      <div className={s.qBody}>
        <div className={s.qMeta}>
          <span className={s.domainPill}>{q.domain}</span>
          <StatusPill status={q.statusMeta.text} />
          {q.invitedSummary ? (
            <span className={s.targetExpert}>
              <User size={11} />
              {q.invitedSummary}
            </span>
          ) : q.statusMeta.text === 'unanswered' ? (
            <span className={`${s.statusPill} ${s.unsolved}`}>未回答</span>
          ) : null}
        </div>
        <h3 className={s.qTitle}>{q.title}</h3>
        <p className={s.qExcerpt}>{q.excerpt}</p>
        {accepted ? (
          <div className={s.answerPreview}>
            <div className={s.answerPreviewHead}>
              <span className={s.answerPreviewName}>
                <span className={s.expBadge}>
                  <BadgeCheck size={12} />
                </span>
                {accepted.author.expert_name}
                {accepted.author.depart_ment ? ` · ${accepted.author.depart_ment}` : ''}
              </span>
              {accepted.accepted ? (
                <span className={s.acceptedFlag}>
                  <CheckCircle size={12} />
                  已采纳
                </span>
              ) : null}
            </div>
            <p className={s.answerPreviewText}>{accepted.excerpt}</p>
          </div>
        ) : null}
        <div className={s.qFooter}>
          <div className={s.askedBy}>
            <span className={s.askedAv}>{q.asker.initial}</span>
            <span className={s.askedName}>{q.asker.name}</span>
            <span className={s.askedAt}>{q.askedAt}</span>
          </div>
          {showOwnerActions ? (
            <div className={s.ownerActions}>
              <button
                type="button"
                className={s.ownerActionBtn}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onEdit(q);
                }}
              >
                <Edit3 size={13} />
                编辑
              </button>
              <button
                type="button"
                className={`${s.ownerActionBtn} ${s.ownerDangerBtn}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete(q);
                }}
              >
                <Trash2 size={13} />
                删除
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_LABEL[status as keyof typeof STATUS_LABEL] || { text: status, cls: '' };
  const Icon = meta.icon;
  return (
    <span className={`${s.statusPill} ${meta.cls}`}>
      {Icon ? <Icon size={11} /> : null} {meta.text}
    </span>
  );
}

const STATUS_LABEL: Record<string, { text: string; cls: string; icon?: typeof CheckCircle }> = {
  solved: { text: '已解决', cls: s.solved, icon: CheckCircle },
  unsolved: { text: '待采纳', cls: s.unsolved },
  unanswered: { text: '未回答', cls: s.urgent },
  urgent: { text: '紧急', cls: s.urgent, icon: AlertTriangle },
};

const INITIAL_STATS = [
  { value: '—', label: '问题' },
  { value: '—', label: '回答' },
  { value: '—', label: '认证专家' },
  { value: '—', label: '解决率' },
];

// ─── Modal 组件 ───────────────────────────────────────────────────────────────

function EditModal({
  title,
  body,
  onTitleChange,
  onBodyChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={s.modalBox} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalTitle}>编辑问题</div>
        <label className={s.modalLabel}>标题</label>
        <input
          className={s.modalInput}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <label className={s.modalLabel}>描述</label>
        <textarea
          className={s.modalTextarea}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
        />
        <div className={s.modalActions}>
          <button type="button" className={s.modalBtn} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`${s.modalBtn} ${s.modalBtnPrimary}`}
            onClick={onConfirm}
            disabled={!title.trim() || !body.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={s.modalOverlay} onClick={onCancel}>
      <div className={`${s.modalBox} ${s.modalBoxCenter}`} onClick={(e) => e.stopPropagation()}>
        <AlertTriangle size={32} className={s.modalWarnIcon} />
        <div className={s.modalTitle}>确认删除问题？</div>
        <p className={s.modalWarnText}>删除后不可恢复，该问题下的所有回答也将一并删除。</p>
        <div className={`${s.modalActions} ${s.modalActionsCenter}`}>
          <button type="button" className={s.modalBtn} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`${s.modalBtn} ${s.modalBtnDanger}`}
            onClick={onConfirm}
          >
            <Trash2 size={13} />
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function ExpertQAPage() {
  const navigate = useNavigate();
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<StatusFilterKey | null>(null);
  const [sort, setSort] = useState<SortKey>('latest');
  const [questions, setQuestions] = useState<QuestionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sidebarLoading, setSidebarLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);

  const [experts, setExperts] = useState<ExpertProfileResponse[]>([]);
  const [domains, setDomains] = useState<DomainConfig[]>([]);
  const { user } = useAuth();
  const [heroStats, setHeroStats] = useState(INITIAL_STATS);
  const showOwnerActions = activeStatus === 'my_question';

  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  // 编辑弹窗状态
  const [editModal, setEditModal] = useState<{
    open: boolean;
    q: QuestionEntry | null;
    title: string;
    body: string;
  }>({ open: false, q: null, title: '', body: '' });

  // 删除确认弹窗状态
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    q: QuestionEntry | null;
  }>({ open: false, q: null });

  // 获取问题列表
  useEffect(() => {
    let active = true;
    window.setTimeout(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
    }, 0);

    const statusMap: Record<string, number> = {
      unsolved: 0,
      solved: 1,
      my_question: 2,
      invited: 3,
    };

    fetchExpertQuestions({
      domain: activeDomain ?? undefined,
      status: activeStatus ? statusMap[activeStatus] : undefined,
      sort: sort,
      page: page,
      pageSize: pageSize,
    })
      .then(async (res) => {
        if (!active) return;
        const mappedQuestions: QuestionEntry[] = (res.questions || []).map((q: ApiQuestion) => ({
          id: q.id,
          title: q.title,
          body: q.description ?? '',
          excerpt: textExcerpt(q.description, 120),
          votes: q.vote_count ?? 0,
          views: q.view_count ?? 0,
          answers: q.answer_count ?? 0,
          acceptedAnswers: q.adopted_answer_id ? 1 : 0,
          domain: q.business_domain,
          statusMeta: getStatusFromApi(q.status, q.answer_count),
          invitedSummary: getInvitedSummary(q),
          asker: {
            name: q.created_by || `用户${q.user_id}`,
            initial: (q.created_by || `U${q.user_id}`)[0],
          },
          askedAt: new Date(q.created_at).toLocaleDateString('zh-CN'),
        }));

        const questionsWithAnswers = await Promise.all(
          mappedQuestions.map(async (question) => {
            try {
              const answerRes = await fetchAnswersPaged(question.id, 1, 1);
              const answer = answerRes.answers?.[0];
              const answerTotal = answerRes.total ?? answerRes.answers?.length ?? question.answers;
              const acceptedAnswers =
                question.acceptedAnswers > 0 || answer?.status === 2 || answer?.adopted ? 1 : 0;
              return {
                ...question,
                answers: Math.max(question.answers, answerTotal),
                acceptedAnswers,
                statusMeta: getStatusFromApi(
                  acceptedAnswers ? 1 : 0,
                  Math.max(question.answers, answerTotal),
                ),
                acceptedPreview: answer ? buildAnswerPreview(answer) : undefined,
              };
            } catch (err) {
              console.error(`获取问题 ${question.id} 的专家回答失败:`, err);
              return question;
            }
          }),
        );

        if (!active) return;
        setQuestions(questionsWithAnswers);
        setTotal(res.total || questionsWithAnswers.length);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '加载问题失败');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeDomain, activeStatus, sort, page, pageSize]);

  // 获取侧边栏数据
  useEffect(() => {
    let active = true;
    window.setTimeout(() => {
      if (!active) return;
      setSidebarLoading(true);
      setSidebarError(null);
    }, 0);

    const tasks = [
      fetchConfigData()
        .then((data) => {
          if (!active) return;
          setDomains(data);
        })
        .catch((err) => {
          if (!active) return;
          setDomains([]);
          setSidebarError(
            `获取业务领域配置失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),

      fetchExpertProfiles(1, 8)
        .then((res) => {
          if (!active) return;
          setExperts(res.experts?.slice(0, 12) || []);
        })
        .catch((err) => {
          if (!active) return;
          console.error('获取专家列表失败:', err);
          setSidebarError('获取专家列表失败');
        }),

      statistics()
        .then((res: TranslationStatistics) => {
          if (!active) return;
          setHeroStats([
            { value: String(res.total_questions), label: '问题' },
            { value: String(res.total_answers), label: '回答' },
            { value: String(res.total_experts), label: '认证专家' },
            { value: `${(res.resolution_rate * 100).toFixed(1)}%`, label: '解决率' },
          ]);
        })
        .catch((err) => {
          if (!active) return;
          console.error('获取统计数据失败:', err);
          setSidebarError('获取统计数据失败');
        }),
    ];

    Promise.allSettled(tasks).then(() => {
      if (active) setSidebarLoading(false);
    });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (activeDomain && domains.length > 0 && !domains.some((d) => d.name === activeDomain)) {
      const timer = window.setTimeout(() => setActiveDomain(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [domains, activeDomain]);

  // 打开编辑弹窗
  function handleEditQuestion(q: QuestionEntry) {
    setEditModal({ open: true, q, title: q.title, body: q.body || q.excerpt });
  }

  // 确认编辑保存
  async function handleConfirmEdit() {
    const { q, title, body } = editModal;
    if (!q || !title.trim() || !body.trim()) return;
    setError(null);
    try {
      await updateExpertQuestion(q.id, {
        title: title.trim(),
        body: body.trim(),
        domain: q.domain,
      });
      setQuestions((current) =>
        current.map((item) =>
          item.id === q.id
            ? {
                ...item,
                title: title.trim(),
                body: body.trim(),
                excerpt: textExcerpt(body.trim(), 120),
              }
            : item,
        ),
      );
      setEditModal({ open: false, q: null, title: '', body: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : '问题保存失败，请稍后重试');
    }
  }

  // 打开删除确认弹窗
  function handleDeleteQuestion(q: QuestionEntry) {
    setDeleteModal({ open: true, q });
  }

  // 确认删除
  async function handleConfirmDelete() {
    const { q } = deleteModal;
    if (!q) return;
    setError(null);
    try {
      await deleteExpertQuestion(q.id);
      setQuestions((current) => current.filter((item) => item.id !== q.id));
      setTotal((current) => Math.max(current - 1, 0));
      setDeleteModal({ open: false, q: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : '问题删除失败，请稍后重试');
    }
  }

  return (
    <PageShell>
      <section className={s.heroStrip}>
        <div className={s.heroInner}>
          <div className={s.heroL}>
            <h1 className={s.heroTitle}>专家问答 · 一线问题，专家解答</h1>
            <p className={s.heroSub}>
              提问时可指定业务域或邀请特定专家，专家应答后所有同事可参与讨论与追问
            </p>
            <div className={s.heroStats}>
              {heroStats.map((stat) => (
                <div key={stat.label} className={s.heroStat}>
                  <span className={s.heroStatNum}>{stat.value}</span>
                  <span className={s.heroStatLb}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={s.heroAction}>
            <Link to="/expert-qa/ask" className={s.askBtn}>
              <PenLine size={15} /> 我要提问
            </Link>
          </div>
        </div>
      </section>

      <div className={s.container}>
        <div className={s.crumbs}>
          <Link to="/">首页</Link> <span> · </span> <span>专家问答</span>
        </div>

        <div className={s.layout}>
          <aside className={s.left}>
            <div className={s.leftCard}>
              <div className={s.leftLabel}>业务域</div>
              {sidebarError && domains.length === 0 ? (
                <div className={s.errorTip}>{sidebarError}</div>
              ) : (
                domains.map((d) => {
                  const Icon = iconMap[d.icon] || Tag;
                  const active = d.name === activeDomain;
                  return (
                    <button
                      key={d.name}
                      type="button"
                      className={`${s.filterItem} ${active ? s.filterActive : ''}`}
                      onClick={() => setActiveDomain((prev) => (prev === d.name ? null : d.name))}
                    >
                      <span className={s.filterLabel}>
                        <Icon size={14} className={s.filterIco} />
                        {d.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className={s.leftCard}>
              <div className={s.leftLabel}>状态</div>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`${s.filterItem} ${activeStatus === f.key ? s.filterActive : ''}`}
                  onClick={() => setActiveStatus((prev) => (prev === f.key ? null : f.key))}
                >
                  <span className={s.filterLabel}>{f.label}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className={s.center}>
            <div className={s.sortBar}>
              <div className={s.sortTabs}>
                {SORT_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`${s.sortTab} ${sort === tab.key ? s.sortTabActive : ''}`}
                    onClick={() => setSort(tab.key as SortKey)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className={s.sortMeta}>
                共 <strong>{total}</strong> 个问题
              </div>
            </div>

            {loading ? (
              <div className={s.loading}>问题加载中…</div>
            ) : error ? (
              <div className={s.errorTip}>{error}</div>
            ) : questions.length === 0 ? (
              <div className={s.loading}>暂无符合条件的问题</div>
            ) : (
              questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  showOwnerActions={showOwnerActions}
                  onOpen={(id) => navigate(`/expert-qa/${id}`)}
                  onEdit={(item) => handleEditQuestion(item)}
                  onDelete={(item) => handleDeleteQuestion(item)}
                />
              ))
            )}

            <div className={s.pagination}>
              <button
                type="button"
                className={s.pgBtn}
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <span className={s.pgInfo}>第 {page} 页</span>
              <button
                type="button"
                className={s.pgBtn}
                aria-label="下一页"
                disabled={page >= maxPage}
                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </main>

          <aside className={s.right}>
            <div className={s.rightCard}>
              <div className={s.rightTitle}>
                <Award size={15} className={s.rightTitleIco} /> 专家榜单{' '}
                <Link to="/expert-qa/expertmanage" className={s.rightTitleMore}>
                  全部 ›
                </Link>
              </div>
              {sidebarLoading && experts.length === 0 ? (
                <div className={s.loading}>加载中…</div>
              ) : sidebarError && experts.length === 0 ? (
                <div className={s.errorTip}>{sidebarError}</div>
              ) : (
                experts.map((expert) => (
                  <div key={expert.id} className={s.expRow}>
                    <div
                      className={`${s.avatar} ${s.avatarExpert}`}
                      style={{ backgroundColor: stringToColor(expert.expert_name) }}
                    >
                      {expert.expert_name?.charAt(0) || '?'}
                    </div>
                    <div className={s.expInfo}>
                      <div className={s.expName}>
                        {expert.expert_name}{' '}
                        <span className={s.expBadge} />
                      </div>
                      <div className={s.expDept}>{expert.depart_ment}</div>
                    </div>
                    <div className={s.expCt}>回答 {expert.answer_count || 0}</div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* 编辑弹窗 */}
      {editModal.open && (
        <EditModal
          title={editModal.title}
          body={editModal.body}
          onTitleChange={(v) => setEditModal((prev) => ({ ...prev, title: v }))}
          onBodyChange={(v) => setEditModal((prev) => ({ ...prev, body: v }))}
          onConfirm={() => void handleConfirmEdit()}
          onCancel={() => setEditModal({ open: false, q: null, title: '', body: '' })}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteModal.open && (
        <DeleteModal
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setDeleteModal({ open: false, q: null })}
        />
      )}
    </PageShell>
  );
}