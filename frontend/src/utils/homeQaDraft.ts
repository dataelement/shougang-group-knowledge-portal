import type { ChatAttachment, QaKnowledgeScope } from '../api/content';

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
  /** 知识库范围;mode 为 'none' 时表示未指定,由问答页回退到「全部有权限的知识空间」。 */
  scope: QaKnowledgeScope;
  /** 已上传附件,每个就是上传接口返回的 data 对象。 */
  attachments: ChatAttachment[];
}

const STORAGE_KEY = 'portal.homeQaDraft';

export function saveHomeQaDraft(draft: HomeQaDraft): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage 不可用时静默降级:问答页拿不到草稿会退回仅带关键词的老逻辑。
  }
}

export function readHomeQaDraft(): HomeQaDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HomeQaDraft> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      keyword: typeof parsed.keyword === 'string' ? parsed.keyword : '',
      answerMode: parsed.answerMode === 'expert' ? 'expert' : 'normal',
      scope: parsed.scope && typeof parsed.scope === 'object' ? parsed.scope : { mode: 'none' },
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    };
  } catch {
    return null;
  }
}

export function clearHomeQaDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
