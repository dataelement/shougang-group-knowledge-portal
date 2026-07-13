import { useEffect, useState, useRef, useCallback } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bold,
  Check,
  ChevronRight,
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
  fetchExpertQuestionDetail,
  updateExpertQuestion,
  uploadQaImage,
  type ExpertProfileResponse,
  type SimilarQuestionItem,
} from '../api/expertQa';
import s from './ExpertQAAskPage.module.css';
import type { DomainConfig } from '../api/adminConfig';
import { ASK_DRAFT } from '../data/expertQaMock';
import askBanner from '../assets/ask-banner@2x.png';
import { resolveQaImageUrl } from '../utils/qaImageUrl';
import {
  normalizeQuestionDescriptionEditorHtml,
  toQuestionDescriptionEditorHtml,
  toQuestionDescriptionPlainText,
} from '../utils/questionRichText';

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
const LINK_LIST_SPLIT_PATTERN = /[;；,，\n\r]+/;

type KnowledgeAttachment = CommonUploadedFile;

function splitStoredList(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(LINK_LIST_SPLIT_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInvitedExperts(
  invitedIds?: string | null,
  invitedNames?: string | null,
): ExpertProfileResponse[] {
  const ids = splitStoredList(invitedIds);
  const names = splitStoredList(invitedNames);
  return ids
    .map((id, index) => {
      const numericId = Number(id);
      if (!Number.isFinite(numericId)) return null;
      const expert: ExpertProfileResponse = {
        id: numericId,
        user_id: numericId,
        expert_name: names[index] || '',
        introduction: null,
        depart_ment: null,
        major: null,
        answer_count: 0,
        adoption_count: 0,
        vote_count: 0,
        created_at: '',
        updated_at: '',
      };
      return expert;
    })
    .filter((item): item is ExpertProfileResponse => Boolean(item));
}

function parseQuestionAttachments(
  attachmentNames?: string | null,
  relatedDocs?: string | null,
): KnowledgeAttachment[] {
  const names = splitStoredList(attachmentNames);
  if (!relatedDocs?.trim()) return [];

  const pairs = relatedDocs
    .replace(/;/g, '；')
    .split('；')
    .map((str) => str.trim())
    .filter(Boolean);

  return pairs.reduce<KnowledgeAttachment[]>((acc, pair, index) => {
    if (!pair.includes('-')) return acc;
    const [spaceIdStr, fileIdStr] = pair.split('-');
    const spaceId = Number(spaceIdStr);
    const fileId = Number(fileIdStr);
    if (!Number.isFinite(spaceId) || !Number.isFinite(fileId)) return acc;

    const fileName = names[index] || 'file';
    const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
    const encodedName = encodeURIComponent(fileName);
    const url = `/workspace/knowledge/file/${fileId}?name=${encodedName}&type=${ext}&spaceId=${spaceId}`;

    acc.push({
      id: `${spaceId}-${fileId}`,
      fileId,
      spaceId,
      parentId: null,
      type: 'file',
      title: fileName,
      name: fileName,
      path: url,
      url,
      ext: ext || '',
      sizeLabel: '',
      hasChildren: false,
      resolvedFileCount: 1,
    });
    return acc;
  }, []);
}

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
  const [searchParams] = useSearchParams();
  const editQuestionId = searchParams.get('edit');
  const isEditMode = Boolean(editQuestionId);

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
  const richTextEditorRef = useRef<HTMLDivElement>(null);
  const savedSelectionRef = useRef<Range | null>(null);

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
        if (data.length > 0 && !isEditMode && !selectedDomain) {
          setSelectedDomain(data[0].name);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error('获取业务领域配置失败:', err);
        setDomainList([]);
      });
    return () => {
      active = false;
    };
  }, [isEditMode, selectedDomain]);

  // 编辑模式：加载原问题内容回填表单
  useEffect(() => {
    if (!editQuestionId) return;
    let active = true;
    setSubmitLoading(true);
    fetchExpertQuestionDetail(editQuestionId)
      .then((question) => {
        if (!active) return;
        setTitle(question.title || '');
        setBody(toQuestionDescriptionEditorHtml(question.description || ''));
        if (question.business_domain) setSelectedDomain(question.business_domain);
        setImageUrls(splitStoredList(question.image_url));
        setInvited(parseInvitedExperts(question.invited_experts, question.experts_names));
        setAttachments(parseQuestionAttachments(question.attachments, question.related_docs));
      })
      .catch((err) => {
        if (!active) return;
        setSubmitError(err instanceof Error ? err.message : '加载问题失败');
      })
      .finally(() => {
        if (!active) return;
        setSubmitLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editQuestionId]);

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

  useEffect(() => {
    const editor = richTextEditorRef.current;
    if (editor && editor.innerHTML !== body) editor.innerHTML = body;
  }, [body]);

  function saveEditorSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (richTextEditorRef.current?.contains(range.commonAncestorContainer)) {
      savedSelectionRef.current = range.cloneRange();
    }
  }

  function restoreEditorSelection() {
    const selection = window.getSelection();
    const range = savedSelectionRef.current;
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function syncEditorContent() {
    const editor = richTextEditorRef.current;
    if (!editor) return;
    const html = normalizeQuestionDescriptionEditorHtml(editor.innerHTML);
    if (editor.innerHTML !== html) editor.innerHTML = html;
    setBody(html);
  }

  function toggleBlockCode() {
    const editor = richTextEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const element = ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor as HTMLElement
      : ancestor.parentElement;
    const existingPre = element?.closest('pre');
    if (existingPre && editor.contains(existingPre)) {
      const paragraph = document.createElement('p');
      paragraph.textContent = existingPre.textContent || '';
      existingPre.replaceWith(paragraph);
      return;
    }

    const selectedText = range.toString();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = selectedText || '代码';
    pre.appendChild(code);
    range.deleteContents();
    range.insertNode(pre);
    range.setStartAfter(pre);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function handleEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const plainText = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plainText);
    syncEditorContent();
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const editor = richTextEditorRef.current;
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const br = document.createElement('br');
    range.insertNode(br);

    range.setStartAfter(br);
    range.setEndAfter(br);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    syncEditorContent();
  }

  function handleToolbarClick(key: string) {
    if (key === 'image') {
      imageInputRef.current?.click();
      return;
    }
    if (key === 'attach' || key === 'related') {
      openUploadModal();
      return;
    }

    richTextEditorRef.current?.focus();
    restoreEditorSelection();
    if (key === 'bold') document.execCommand('bold');
    if (key === 'italic') document.execCommand('italic');
    if (key === 'list') document.execCommand('insertUnorderedList');
    if (key === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    if (key === 'code') toggleBlockCode();
    syncEditorContent();
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
    // const missingBody = !body.trim();
    const missingDomain = !selectedDomain;

    setDomainError(missingDomain);

    if (missingTitle) {
      setSubmitError('请填写问题标题');
      return;
    }
    /*if (missingBody) {
      setSubmitError('请填写问题描述');
      return;
    }*/
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
      const safeBody = normalizeQuestionDescriptionEditorHtml(body);
      // 内容安全检测只检查用户可见文本，避免 HTML 标签干扰命中规则。
      await handleCheckQuestion(`${title.trim()}\n${toQuestionDescriptionPlainText(safeBody)}`);
      const payload = {
        title: title.trim(),
        body: safeBody,
        domain: selectedDomain,
        invited_expert_ids: invited.map((e) => e.id).join(';'),
        invited_expert_names: invited.map((e) => e.expert_name).join(';'),
        image_url: imageUrls.length ? imageUrls.join(';') : null,
        attachments: serializeKnowledgeAttachments(attachments) ?? null,
        related_docs: serializeKnowledgeAttachmentsID(attachments) ?? null,
      };
      if (isEditMode && editQuestionId) {
        await updateExpertQuestion(Number(editQuestionId), payload);
      } else {
        await createExpertQuestion({
          ...payload,
          image_url: payload.image_url ?? undefined,
          attachments: payload.attachments ?? undefined,
          related_docs: payload.related_docs ?? undefined,
        });
      }
      navigate('/expert-qa');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : isEditMode ? '保存失败，请重试' : '发布失败，请重试');
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <PageShell>
      <div className={s.container}>
        <div className={s.crumbs}>
          <Link to="/expert-qa">专家问答</Link>
          <ChevronRight size={14} className={s.crumbChevron} />
          <span>{isEditMode ? '编辑提问' : '我要提问'}</span>
        </div>
        <div className={s.layout}>
          <main className={s.formCard}>
            <div
              className={s.formHeader}
              style={{ backgroundImage: `url(${askBanner})` }}
            >
              <div className={s.formHeaderTitle}>
                <span className={s.formAccent} aria-hidden />
                {isEditMode ? '编辑提问' : '我要提问'}
              </div>
              <p className={s.formHeaderSub}>描述您的问题，邀请专家为您解答～</p>
            </div>

            <div className={s.formBody}>
            {/* 标题 */}
            <div className={s.field}>
              <label className={s.fieldLabel}>
                问题<span className={s.req}>*</span>
              </label>
              <input
                className={s.input}
                placeholder="请输入问题"
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
                        <span className={s.domainName}>{d.name}</span>
                        {sel && <Check size={13} className={s.domainCheck} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 问题描述编辑器 */}
            <div className={s.field}>
              <label className={s.fieldLabel}>
                问题描述
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
                      onMouseDown={(event) => {
                        if (['bold', 'italic', 'list', 'quote', 'code'].includes(btn.key)) {
                          event.preventDefault();
                          saveEditorSelection();
                        }
                      }}
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

              <div
                ref={richTextEditorRef}
                className={`${s.input} ${s.textarea} ${s.richTextEditor}`}
                contentEditable
                role="textbox"
                aria-multiline="true"
                data-placeholder="请详细描述您的问题…"
                suppressContentEditableWarning
                onInput={syncEditorContent}
                onBlur={syncEditorContent}
                onPaste={handleEditorPaste}
                onKeyDown={handleEditorKeyDown}
                onKeyUp={saveEditorSelection}
                onMouseUp={saveEditorSelection}
              />

              {/* 图片上传错误（独立显示，不与提交错误混用）*/}
              {uploadError && <div className={s.errorTip}>{uploadError}</div>}

              {/* 图片预览 */}
              {(imageUrls.length > 0 || uploadingImages) && (
                <div className={s.previewGrid}>
                  {imageUrls.map((url) => (
                    <div key={url} className={s.imagePreviewItem}>
                      <img src={resolveQaImageUrl(url)} alt="uploaded" className={s.previewImg} />
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
            <button
              type="button"
              className={s.btnPrimary}
              onClick={handlePublish}
              disabled={submitLoading}
            >
              <Send size={14} />{' '}
              {submitLoading
                ? isEditMode
                  ? '保存中...'
                  : '发布中...'
                : isEditMode
                  ? '保存并发布'
                  : '发布提问'}
            </button>
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
