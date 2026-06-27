import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  Link2,
  List,
  Loader2,
  Paperclip,
  Plus,
  Quote,
  Search,
  Send,
  X,
} from 'lucide-react';
import PageShell from '../components/PageShell';
import CommonFileUploadModal, {
  type CommonUploadedFile,
} from '../components/CommonFileUploadModal';
import {
  createExpertQuestion,
  handleCheckQuestion,
  fetchConfigData,
  fetchExpertProfiles,
  fetchSimilarExpertQuestions,
  uploadQaImage,
  type ExpertProfileResponse,
  type SimilarQuestionItem,
} from '../api/expertQa';
import s from './ExpertQAAskPage.module.css';
import type { DomainConfig } from '../api/adminConfig';
import {
  CheckCircle,
  Settings,
  Shield,
  Leaf,
  GraduationCap,
  Network,
  Zap,
  Factory,
} from 'lucide-react';
import { ASK_DRAFT } from '../data/expertQaMock';

// 侧边栏图标映射
const iconMap: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  CheckCircle,
  Settings,
  Shield,
  Leaf,
  GraduationCap,
  Network,
  Zap,
  Factory,
};

// 颜色缓存，避免每次渲染重新计算
const colorCache = new Map<string, string>();
const COLOR_PALETTE = ['#4F86C6', '#58A55C', '#D4713A', '#9B6BBE', '#C0565B', '#4AACAB'];

function stringToColor(str: string): string {
  if (colorCache.has(str)) return colorCache.get(str)!;
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const color = COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
  colorCache.set(str, color);
  return color;
}

function getInitial(name: string): string {
  return name ? name.charAt(0).toUpperCase() : '?';
}

// 工具栏配置
const TOOLBAR_BUTTONS = [
  { key: 'bold', icon: Bold, title: '加粗' },
  { key: 'italic', icon: Italic, title: '斜体' },
  { key: 'list', icon: List, title: '列表' },
  { key: 'sep1', sep: true },
  { key: 'quote', icon: Quote, title: '引用' },
  { key: 'code', icon: Code, title: '代码' },
  { key: 'sep2', sep: true },
  { key: 'image', icon: ImageIcon, title: '插入图片' },
  { key: 'attach', icon: Paperclip, title: '附件' },
  { key: 'related', icon: Link2, title: '关联文档' },
] as const;

const EXPERT_PAGE_SIZE = 20;
const MAX_IMAGE_COUNT = 3;
const ATTACHMENT_LIST_SEPARATOR = ';';

type KnowledgeAttachment = CommonUploadedFile;

function serializeKnowledgeAttachments(
  items: KnowledgeAttachment[],
): string | undefined {
  const validItems = items.filter(
    (item) => item.title.trim(),
  );

  return validItems.length
    ? validItems
        .map(
          (item) =>
            `${item.title.trim()}`,
        )
        .join(ATTACHMENT_LIST_SEPARATOR)
    : undefined;
}

function serializeKnowledgeAttachmentsID(
  items: KnowledgeAttachment[],
): string | undefined {
  const validItems = items.filter(
    (item) => item.id.trim(),
  );

  return validItems.length
    ? validItems
        .map(
          (item) =>
            `${item.id.trim()}`,
        )
        .join(ATTACHMENT_LIST_SEPARATOR)
    : undefined;
}


// 规范化 fetchExpertProfiles 的返回值，防御接口格式变化
interface ExpertProfilesResult {
  experts: ExpertProfileResponse[];
  total: number;
}

function normalizeExpertResult(res: unknown): ExpertProfilesResult {
  if (res && typeof res === 'object') {
    const r = res as Record<string, unknown>;
    const experts = Array.isArray(r['experts'])
      ? (r['experts'] as ExpertProfileResponse[])
      : Array.isArray(res)
      ? (res as ExpertProfileResponse[])
      : [];
    const total = typeof r['total'] === 'number' ? r['total'] : experts.length;
    return { experts, total };
  }
  return { experts: [], total: 0 };
}

//主页面
export default function ExpertQAAskPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<string>('');
  const [domainList, setDomainList] = useState<DomainConfig[]>([]);
  const [expertList, setExpertList] = useState<ExpertProfileResponse[]>([]);
  const [invited, setInvited] = useState<ExpertProfileResponse[]>([]);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [domainError, setDomainError] = useState(false);
  // 分离提交错误与上传错误，互不覆盖
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [similarQuestions, setSimilarQuestions] = useState<SimilarQuestionItem[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // 专家选择器分页状态
  const [expertPage, setExpertPage] = useState(1);
  const [expertTotal, setExpertTotal] = useState(0);
  const [expertLoading, setExpertLoading] = useState(false);
  const pickerListRef = useRef<HTMLDivElement>(null);
  // 用于点击外部关闭专家弹窗
  const pickerPanelRef = useRef<HTMLDivElement>(null);

  // 图片/附件状态
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [attachments, setAttachments] = useState<KnowledgeAttachment[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 是否还有更多专家（仅在非搜索态有意义；搜索态由服务端决定）
  const hasMoreExperts = expertList.length < expertTotal;

  // 修复：搜索改为服务端搜索，loadExperts 不再做前端过滤
  const loadExperts = useCallback(
    async (page: number, search: string, append = false) => {
      setExpertLoading(true);
      try {
        // search 参数透传给接口，由服务端过滤
        const raw = await fetchExpertProfiles(page, EXPERT_PAGE_SIZE, search.trim() || undefined);
        const { experts, total } = normalizeExpertResult(raw);
        setExpertList((prev) => (append ? [...prev, ...experts] : experts));
        setExpertTotal(total);
        setExpertPage(page);
      } catch {
        if (!append) setExpertList([]);
      } finally {
        setExpertLoading(false);
      }
    },
    [],
  );

  // 修复：补全依赖数组 —— 加入 loadExperts 与 pickerSearch
  useEffect(() => {
    if (showPicker) {
      setExpertList([]);
      setExpertPage(1);
      loadExperts(1, pickerSearch);
    }
  }, [showPicker, loadExperts, pickerSearch]);

  // 搜索防抖（依赖已完整）
  useEffect(() => {
    if (!showPicker) return;
    const timer = setTimeout(() => {
      setExpertList([]);
      setExpertPage(1);
      loadExperts(1, pickerSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [pickerSearch, showPicker, loadExperts]);

  // 修复：点击弹窗外部关闭专家选择器
  useEffect(() => {
    if (!showPicker) return;
    function handleOutsideClick(e: MouseEvent) {
      if (
        pickerPanelRef.current &&
        !pickerPanelRef.current.contains(e.target as Node)
      ) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showPicker]);

  // 滚动加载更多
  const handlePickerScroll = useCallback(() => {
    const el = pickerListRef.current;
    if (!el || expertLoading || !hasMoreExperts) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30) {
      loadExperts(expertPage + 1, pickerSearch, true);
    }
  }, [expertLoading, hasMoreExperts, expertPage, pickerSearch, loadExperts]);

  function openPicker() {
    setPickerSearch('');
    setShowPicker(true);
  }

  // 获取领域配置
  useEffect(() => {
    let active = true;
    fetchConfigData()
      .then((data) => {
        if (!active) return;
        setDomainList(data);
        if (data.length > 0) setSelectedDomain(data[0].name);
      })
      .catch((err) => {
        if (!active) return;
        console.error('获取业务领域配置失败:', err);
        setDomainList([]);
      });
    return () => {
      active = false;
    };
  }, []);

  function toggleInvite(expert: ExpertProfileResponse) {
    setInvited((current) => {
      if (current.some((e) => e.id === expert.id))
        return current.filter((e) => e.id !== expert.id);
      if (current.length >= 3) return current;
      return [...current, expert];
    });
  }

  async function handleImageUpload(files: File[]) {
    const currentCount = imageUrls.length;
    const availableSlots = MAX_IMAGE_COUNT - currentCount;
    if (availableSlots <= 0) {
      // 修复：使用独立的 uploadError，不影响 submitError
      setUploadError(`图片最多上传 ${MAX_IMAGE_COUNT} 张`);
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);
    if (selectedFiles.length < files.length) {
      setUploadError(
        `图片最多上传 ${MAX_IMAGE_COUNT} 张，已自动保留前 ${availableSlots} 张`,
      );
    } else {
      setUploadError(null);
    }

    setUploadingImages(true);
    try {
      const uploaded = await Promise.all(selectedFiles.map((file) => uploadQaImage(file)));
      const urls = uploaded.map((item) => item.image_url).filter(Boolean);
      if (!urls.length) throw new Error('上传响应缺少图片地址');
      setImageUrls((current) => [...current, ...urls].slice(0, MAX_IMAGE_COUNT));
    } catch (err) {
      console.error('图片上传错误:', err);
      setUploadError('图片上传失败，请重试');
    } finally {
      setUploadingImages(false);
    }
  }

  function removeImage(url: string) {
    setImageUrls((current) => current.filter((item) => item !== url));
  }

  function openUploadModal() {
    setUploadModalOpen(true);
  }

  // 修复：关闭知识库弹窗时重置过滤条件，保持下次打开状态干净
  function removeAttachment(target: KnowledgeAttachment) {
    const targetKey = `${target.id}-${target.url}`;
    setAttachments((current) =>
      current.filter((item) => `${item.id}-${item.url}` !== targetKey),
    );
  }

  function handleSelectAttachments(files: CommonUploadedFile[]) {
   
    setAttachments(files);
    setUploadError(null);
  }

  function handleToolbarClick(key: string) {
    if (key === 'image') {
      imageInputRef.current?.click();
    } else if (key === 'attach' || key === 'related') {
      openUploadModal();
    }
  }

  // 类似问题搜索
  useEffect(() => {
    const q = title.trim();
    if (q.length < 2) {
      setSimilarQuestions([]);
      setSimilarLoading(false);
      return;
    }

    let active = true;
    setSimilarLoading(true);
    const timer = setTimeout(() => {
      fetchSimilarExpertQuestions(q)
        .then((items) => {
          if (active) setSimilarQuestions(items);
        })
        .catch(() => {
          if (active) setSimilarQuestions([]);
        })
        .finally(() => {
          if (active) setSimilarLoading(false);
        });
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [title]);

  async function handlePublish() {
    // 修复：拆分标题与正文的缺失校验，给出明确提示
    const missingTitle = !title.trim();
    const missingBody = !body.trim();
    const missingDomain = !selectedDomain;

    setDomainError(missingDomain);

    if (missingTitle) {
      setSubmitError('请填写问题标题');
      return;
    }
    if (missingBody) {
      setSubmitError('请填写问题描述');
      return;
    }
    if (missingDomain) {
      setSubmitError(null);
      return;
    }
    if (attachments.some((item) => !item.title.trim() || !item.url.trim())) {
      setSubmitError('附件信息缺少文档名称或路径，请重新确认');
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    setDomainError(false);

    try {
      // 校验问题是否存在安全内容
      await handleCheckQuestion(title.trim()+"\n"+ body.trim());
      await createExpertQuestion({
        title: title.trim(),
        body: body.trim(),
        domain: selectedDomain,
        invited_expert_ids: invited.map((e) => e.id).join(';'),
        invited_expert_names: invited.map((e) => e.expert_name).join(';'),
        image_url: imageUrls.length ? imageUrls.join(';') : undefined,
        attachments: serializeKnowledgeAttachments(attachments),
        related_docs: serializeKnowledgeAttachmentsID(attachments)
        
      });
      navigate('/expert-qa');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '发布失败，请重试');
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <PageShell>
      <div className={s.container}>
        <div className={s.crumbs}>
          <Link to="/expert-qa">专家问答</Link> / <span>我要提问</span>
        </div>
        <div className={s.layout}>
          <main className={s.formCard}>
            <h1 className={s.formTitle}>我要提问</h1>
            <p className={s.formSub}>描述您的问题，邀请专家为您解答</p>

            {/* 标题 */}
            <div className={s.field}>
              <label className={s.fieldLabel}>
                标题<span className={s.req}>*</span>
              </label>
              <input
                className={s.input}
                placeholder="请输入问题标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 业务领域 */}
            <div className={s.row2}>
              <div className={s.field}>
                <label className={s.fieldLabel}>
                  业务领域<span className={s.req}>*</span>
                  {domainError && (
                    <span style={{ color: 'var(--red-500)', marginLeft: 8 }}>
                      请选择业务领域
                    </span>
                  )}
                </label>
                <div className={s.domainGrid}>
                  {domainList.map((d) => {
                    const Icon = iconMap[d.icon] ?? CheckCircle;
                    const sel = selectedDomain === d.name;
                    return (
                      <button
                        key={d.name}
                        type="button"
                        className={`${s.domainOpt} ${sel ? s.domainOptSel : ''}`}
                        onClick={() => {
                          setSelectedDomain(d.name);
                          setDomainError(false);
                        }}
                      >
                        <Icon size={18} className={s.domainIco} />
                        <span className={s.domainName}>{d.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 问题描述编辑器 */}
            <div className={s.field}>
              <label className={s.fieldLabel}>
                问题描述<span className={s.req}>*</span>
              </label>
              <div className={s.editorBar}>
                {TOOLBAR_BUTTONS.map((btn) => {
                  if ('sep' in btn)
                    return <span key={btn.key} className={s.editorSep} aria-hidden />;
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.key}
                      type="button"
                      title={btn.title}
                      className={s.editorBtn}
                      onClick={() => handleToolbarClick(btn.key)}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>

              {/* 隐藏的文件输入框 */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void handleImageUpload(files);
                  e.target.value = '';
                }}
              />

              <textarea
                className={s.input}
                placeholder="请详细描述您的问题…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                style={{ height: '120px', resize: 'vertical' }}
              />

              {/* 图片上传错误（独立显示，不与提交错误混用）*/}
              {uploadError && <div className={s.errorTip}>{uploadError}</div>}

              {/* 图片预览 */}
              {(imageUrls.length > 0 || uploadingImages) && (
                <div className={s.previewGrid}>
                  {imageUrls.map((url) => (
                    <div key={url} className={s.imagePreviewItem}>
                      <img src={url} alt="uploaded" className={s.previewImg} />
                      <button
                        type="button"
                        className={s.removeImg}
                        onClick={() => removeImage(url)}
                        title="移除图片"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {uploadingImages && (
                    <div className={`${s.imagePreviewItem} ${s.uploadingBox}`}>
                      <Loader2 size={18} className={s.spin} />
                      <span>上传中</span>
                    </div>
                  )}
                </div>
              )}

              {/* 附件信息 */}
              {attachments.length > 0 && (
                <div className={s.attachmentList}>
                  {attachments.map((item) => (
                    <span key={`${item.spaceId}-${item.id}`} className={s.attachmentChip}>
                      <Paperclip size={14} />
                      <span className={s.attachmentName}>{item.title}</span>
                      <button
                        type="button"
                        className={s.attachmentRemove}
                        onClick={() => removeAttachment(item)}
                        title="移除附件"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className={s.hint}>
                图片最多 3 张，发布时将以分号拼接 URL；附件从知识库选择后同样以分号拼接链接。
              </div>
            </div>

            {/* 邀请专家 */}
            <div className={s.field}>
              <label className={s.fieldLabel}>
                邀请专家<span className={s.optional}>（最多 3 位）</span>
              </label>
              <div className={s.expertChips}>
                {invited.map((expert) => (
                  <span key={expert.id} className={s.expChipSel}>
                    <span
                      className={s.expChipAv}
                      style={{ backgroundColor: stringToColor(expert.expert_name) }}
                    >
                      {getInitial(expert.expert_name)}
                    </span>
                    {expert.expert_name}
              
                    <span className={s.expChipX} onClick={() => toggleInvite(expert)}>
                      ×
                    </span>
                  </span>
                ))}
                <button type="button" className={s.addExp} onClick={openPicker}>
                  <Plus size={13} /> 邀请
                </button>
              </div>

              {/* 专家选择弹窗（添加 ref 用于点击外部关闭）*/}
              {showPicker && (
                <div className={s.pickerPanel} ref={pickerPanelRef}>
                  <div className={s.pickerSearch}>
                    <Search size={14} className={s.pickerSearchIco} />
                    <input
                      autoFocus
                      type="text"
                      className={s.pickerSearchInput}
                      placeholder="搜索姓名或部门"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                    />
                  </div>
                  <div
                    ref={pickerListRef}
                    className={s.pickerList}
                    onScroll={handlePickerScroll}
                  >
                    {expertList.length === 0 && !expertLoading ? (
                      <div className={s.pickerEmpty}>未找到匹配的专家</div>
                    ) : (
                      expertList.map((expert) => {
                        const isSelected = invited.some((e) => e.id === expert.id);
                        const maxReached = !isSelected && invited.length >= 3;
                        return (
                          <button
                            key={expert.id}
                            type="button"
                            disabled={maxReached}
                            className={`${s.pickerRow} ${isSelected ? s.pickerRowSel : ''}`}
                            onClick={() => toggleInvite(expert)}
                          >
                            <span
                              className={s.expChipAv}
                              style={{ backgroundColor: stringToColor(expert.expert_name) }}
                            >
                              {getInitial(expert.expert_name)}
                            </span>
                            
                            <span className={s.pickerInfo}>
                              <span className={s.pickerName}>{expert.expert_name}</span>
                              {expert.depart_ment && (
                                <span className={s.pickerDept}>{expert.depart_ment}</span>
                              )}
                            </span>
                            <span className={s.expertInfo}>
                              <span className={s.expertMajor}>{expert.major}</span>
                            </span>
                            {isSelected && <span className={s.pickerCheck}>✓</span>}
                          </button>
                        );
                      })
                    )}
                    {expertLoading && (
                      <div className={s.pickerLoading}>加载中…</div>
                    )}
                    {!expertLoading && hasMoreExperts && (
                      <div className={s.pickerScrollHint}>下滑加载更多</div>
                    )}
                  </div>
                  <div className={s.pickerFoot}>
                    <span className={s.pickerCount}>已选 {invited.length} / 3</span>
                    <button
                      type="button"
                      className={s.btnSecondary}
                      onClick={() => setShowPicker(false)}
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )}
              <div className={s.hint}>
                未邀请专家时，问题将向所选业务域的全部认证专家公开
              </div>
            </div>

            {submitError && <div className={s.errorTip}>{submitError}</div>}

            {/* 发布按钮 */}
            <div className={s.actionBar}>
              <div className={s.actionBtns}>
                <button
                  type="button"
                  className={s.btnPrimary}
                  onClick={handlePublish}
                  disabled={submitLoading}
                >
                  <Send size={14} /> {submitLoading ? '发布中...' : '发布提问'}
                </button>
              </div>
            </div>
          </main>

          {/* 知识库附件弹窗（关闭时重置过滤条件）*/}
          <CommonFileUploadModal
            visible={uploadModalOpen}
            selectedFiles={attachments}
            title="选择知识库附件"
            description="选择文档后将返回文档名称和路径，发布问题时会一并保存"
            onClose={() => setUploadModalOpen(false)}
            onSelectFiles={handleSelectAttachments}
          />

          {/* 侧边栏 */}
          <aside className={s.right}>
            <div className={s.sideCard}>
              <div className={s.sideTitle}>
                <Lightbulb size={15} className={s.tipsIcon} /> 提问小贴士
              </div>
              <ul className={s.tipList}>
                <li>
                  先描述<strong>现象</strong>与<strong>已做检查</strong>，再提出问题
                </li>
                <li>附上现场照片、趋势曲线、点检表</li>
                <li>注明设备编号、钢种、规格</li>
                <li>避免与其他用户重复提问，优先在右上角搜索</li>
                <li>采纳最佳回答可帮助沉淀知识</li>
              </ul>
            </div>
            <div className={s.sideCard}>
              <div className={s.sideTitle}>
                <Search size={15} className={s.sideTitleIco} /> 类似问题
              </div>
              {similarLoading ? (
                <div className={s.similarEmpty}>
                  <Loader2 size={15} className={s.spin} />
                  <span>正在匹配</span>
                </div>
              ) : similarQuestions.length > 0 ? (
                similarQuestions.map((item) => (
                  <Link key={item.id} to={`/expert-qa/${item.id}`} className={s.similarItem}>
                    <span>{item.title}</span>
                    <small>
                      {item.answer_count ?? 0} 回答 · {item.view_count ?? 0} 浏览
                    </small>
                  </Link>
                ))
              ) : (
                // 修复：fallback 也用 Link，与真实数据行为一致
                ASK_DRAFT.similar.map((item) => (
                  <Link key={item} to="/expert-qa" className={s.similarItem}>
                    <span>{item}</span>
                  </Link>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
