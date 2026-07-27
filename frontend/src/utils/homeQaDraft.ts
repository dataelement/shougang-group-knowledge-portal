import type { ChatAttachment, QaKnowledgeScope } from '../api/content';
import type { QaKnowledgePickerMode } from '../components/qaKnowledgeScopeMode';

/**
 * 首页「智能问答」输入框发起时,把用户在首页选好的模型档位 / 知识库范围 / 已上传附件,
 * 连同问题一起打包成一份「待发起会话草稿」,写入 sessionStorage;跳转到智能应用后由问答页
 * 读取、应用并自动发送、随后清除。
 *
 * 只带「引用」不带二进制:附件在首页已经上传完成,这里存的 ChatAttachment 就是上传接口返回的
 * 结果对象(file_id/temp_file_id/filepath/...),发送时按 file_id 走,足够用。
 */
export interface HomeQaDraft {
  keyword: string;
  /** 模型档位:通用 = normal,推理 = expert(对应问答页的 answerMode)。 */
  answerMode: 'normal' | 'expert';
  /** 当前生效的知识范围模式。 */
  scopeMode?: QaKnowledgePickerMode;
  /** 「按知识库」草稿。 */
  knowledgeScope?: QaKnowledgeScope;
  /** 「按文件分类」草稿(文件多选)。 */
  categoryScope?: QaKnowledgeScope;
  /**
   * 生效中的知识库范围(兼容旧草稿字段)。
   * 新草稿优先用 scopeMode + knowledgeScope/categoryScope。
   */
  scope: QaKnowledgeScope;
  /** 已上传附件,每个就是上传接口返回的 data 对象。 */
  attachments: ChatAttachment[];
}

const STORAGE_KEY = 'portal.homeQaDraft';

function asScope(value: unknown): QaKnowledgeScope {
  return value && typeof value === 'object' ? (value as QaKnowledgeScope) : { mode: 'none' };
}

export function readHomeQaDraft(): HomeQaDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HomeQaDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const scopeMode: QaKnowledgePickerMode = parsed.scopeMode === 'category' ? 'category' : 'knowledge';
    const knowledgeScope = asScope(parsed.knowledgeScope ?? (scopeMode === 'knowledge' ? parsed.scope : { mode: 'none' }));
    const categoryScope = asScope(parsed.categoryScope ?? (scopeMode === 'category' ? parsed.scope : { mode: 'none' }));
    const scope = scopeMode === 'category' ? categoryScope : knowledgeScope;
    return {
      keyword: typeof parsed.keyword === 'string' ? parsed.keyword : '',
      answerMode: parsed.answerMode === 'expert' ? 'expert' : 'normal',
      scopeMode,
      knowledgeScope,
      categoryScope,
      scope,
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return null;
  }
}

export function saveHomeQaDraft(draft: HomeQaDraft): void {
  try {
    const scopeMode = draft.scopeMode === 'category' ? 'category' : 'knowledge';
    const knowledgeScope = draft.knowledgeScope ?? (scopeMode === 'knowledge' ? draft.scope : { mode: 'none' });
    const categoryScope = draft.categoryScope ?? (scopeMode === 'category' ? draft.scope : { mode: 'none' });
    const payload: HomeQaDraft = {
      ...draft,
      scopeMode,
      knowledgeScope,
      categoryScope,
      scope: scopeMode === 'category' ? categoryScope : knowledgeScope,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage 不可用时静默降级:问答页拿不到草稿会退回仅带关键词的老逻辑。
  }
}

export function clearHomeQaDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
