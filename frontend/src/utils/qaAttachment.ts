import type { ChatAttachment } from '../api/content';

/** 智能问答附件:支持的文件类型(与智能应用问答页保持一致)。 */
export const QA_ATTACHMENT_ACCEPT =
  '.pdf,.txt,.doc,.docx,.ppt,.pptx,.md,.html,.xls,.xlsx,.wps,.dps,.et,.png,.jpg,.jpeg,.bmp';

const QA_ATTACHMENT_EXTENSIONS = new Set(QA_ATTACHMENT_ACCEPT.split(',').map((item) => item.replace('.', '')));

export interface UploadingAttachment {
  id: string;
  name: string;
}

export function isSupportedAttachment(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return QA_ATTACHMENT_EXTENSIONS.has(ext);
}

export function getAttachmentName(file: ChatAttachment): string {
  return file.filename || file.file_id || file.temp_file_id || '附件';
}

export function getAttachmentKey(file: ChatAttachment): string {
  return file.filepath || file.file_id || file.temp_file_id || getAttachmentName(file);
}
