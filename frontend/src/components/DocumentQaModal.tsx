import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bot, CalendarClock, FileText, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { streamDocumentFileChat, type FileItem } from '../api/content';
import { renderChatMarkdown } from '../utils/chatMessage';
import { buildFileListItemView } from '../utils/fileListItemView';
import s from './DocumentQaModal.module.css';

interface Props {
  open: boolean;
  file: FileItem | null;
  onClose: () => void;
}

interface Message {
  role: 'bot' | 'user';
  text: string;
}

const QUICK_QUESTIONS = [
  '总结文章要点',
  '文章的主要结论是什么',
];

function getInitialMessages(file: FileItem): Message[] {
  return [
    {
      role: 'bot',
      text: `您好！我可以帮您深入了解《${file.title}》这份文档。\n\n文档摘要：${file.summary || '暂无摘要。'}\n\n您可以直接提问，或者点击下方快捷问题开始对话。`,
    },
  ];
}

export default function DocumentQaModal({ open, file, onClose }: Props) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !file) return;
    requestSeq.current += 1;
    setDraft('');
    setError('');
    setStreaming(false);
    setMessages(getInitialMessages(file));
  }, [file, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  if (!open || !file) return null;

  const view = buildFileListItemView(file);

  const updateLastBotMessage = (text: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const lastIndex = next.length - 1;
      if (lastIndex < 0 || next[lastIndex].role !== 'bot') return prev;
      next[lastIndex] = { ...next[lastIndex], text };
      return next;
    });
  };

  const sendQuestion = (question?: string) => {
    const text = (question ?? draft).trim();
    if (!text || streaming) return;

    const currentRequest = ++requestSeq.current;
    setDraft('');
    setError('');
    setStreaming(true);
    setMessages((prev) => [...prev, { role: 'user', text }, { role: 'bot', text: '' }]);

    void streamDocumentFileChat({
      spaceId: file.spaceId,
      fileId: file.id,
      text,
      onUpdate(currentText) {
        if (requestSeq.current !== currentRequest) return;
        updateLastBotMessage(currentText);
      },
    }).catch(() => {
      if (requestSeq.current !== currentRequest) return;
      setError('问答请求失败，请稍后重试。');
      updateLastBotMessage('问答请求失败，请稍后重试。');
    }).finally(() => {
      if (requestSeq.current === currentRequest) {
        setStreaming(false);
      }
    });
  };

  const handleClose = () => {
    requestSeq.current += 1;
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendQuestion();
    }
  };

  return (
    <div className={s.overlay} role="presentation" onMouseDown={handleClose}>
      <section
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-qa-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={s.closeButton} aria-label="关闭" onClick={handleClose}>
          <X size={24} />
        </button>

        <header className={s.header}>
          <div className={s.fileIcon}>
            <FileText size={24} />
          </div>
          <div className={s.headerText}>
            <h2 id="document-qa-title" className={s.title}>{file.title}</h2>
            <div className={s.meta}>
              <span><FileText size={15} />{view.documentTypeLabel}</span>
              {view.dateLabel ? <span><CalendarClock size={15} />{view.dateLabel}</span> : null}
            </div>
          </div>
        </header>

        <div className={s.content}>
          <div className={s.messages}>
            {messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              const isThinking = streaming && isLast && message.role === 'bot' && !message.text.trim();
              return (
                <div key={`${message.role}-${index}`} className={`${s.messageRow} ${message.role === 'user' ? s.messageRowUser : ''}`}>
                  {message.role === 'bot' ? (
                    <div className={s.avatar}><Bot size={17} /></div>
                  ) : null}
                  <div className={`${s.bubble} ${message.role === 'user' ? s.userBubble : s.botBubble}`}>
                    {isThinking ? (
                      <span className={s.thinking}><Loader2 size={16} className={s.spin} />思考中...</span>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: renderChatMarkdown(message.text, []) }} />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className={s.quickList}>
            {QUICK_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                className={s.quickButton}
                onClick={() => sendQuestion(question)}
                disabled={streaming}
              >
                <MessageCircle size={16} />
                {question}
              </button>
            ))}
          </div>
        </div>

        <footer className={s.footer}>
          {error ? <div className={s.errorText}>{error}</div> : null}
          <div className={s.inputRow}>
            <textarea
              className={s.input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入您的问题...（Enter 发送，Shift+Enter 换行）"
              rows={1}
              disabled={streaming}
            />
            <button
              type="button"
              className={s.sendButton}
              onClick={() => sendQuestion()}
              disabled={!draft.trim() || streaming}
              aria-label="发送问题"
            >
              <Send size={20} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
