import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { Bot, User, Send, Plus, Loader2 } from 'lucide-react';
import Header from '../components/Header';
import { fetchPortalContentConfig, streamChatCompletion, type Citation } from '../api/content';
import { extractReferencedCitations, renderChatMarkdown } from '../utils/chatMessage';
import s from './QAPage.module.css';

interface Message {
  role: 'bot' | 'user';
  text: string;
  citations?: Citation[];
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
}

function getWelcomeMessage(welcomeMessage?: string) {
  return welcomeMessage?.trim() || '你好，我是首钢股份知库智能助手，请问有什么可以帮您？';
}

function CitationList({ items }: { items: Citation[] }) {
  return (
    <ol className={s.citations}>
      {items.map((c, idx) => {
        const sp = c.sourcePayload ?? {};
        const href = sp.knowledgeId && sp.documentId
          ? `/space/${sp.knowledgeId}/file/${sp.documentId}`
          : undefined;
        const label = sp.documentName || c.key;
        return (
          <li key={c.key} className={s.citationItem}>
            <span className={s.citationIndex}>{idx + 1}</span>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={s.citationLink}
                title={label}
              >
                {label}
              </a>
            ) : (
              <span className={s.citationLink}>{label}</span>
            )}
            {sp.knowledgeName ? <span className={s.citationHint}>· {sp.knowledgeName}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function QAPage() {
  const initialGreeting = getWelcomeMessage();
  const initialSessions: Session[] = [
    {
      id: 'sess1',
      title: '新会话',
      messages: [{ role: 'bot', text: initialGreeting }],
    },
  ];
  const [assistantGreeting, setAssistantGreeting] = useState(initialGreeting);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [activeId, setActiveId] = useState(initialSessions[0].id);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [knowledgeSpaceIds, setKnowledgeSpaceIds] = useState<number[]>([]);
  const msgEndRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((ss) => ss.id === activeId)!;

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession.messages, streaming]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await fetchPortalContentConfig();
        if (active) {
          setKnowledgeSpaceIds(config.qa.knowledge_space_ids);
          const nextGreeting = getWelcomeMessage(config.qa.welcome_message);
          setAssistantGreeting(nextGreeting);
          setSessions((prev) => prev.map((session, index) => {
            if (index !== 0 || session.messages[0]?.role !== 'bot') return session;
            return {
              ...session,
              messages: [{ role: 'bot', text: nextGreeting }, ...session.messages.slice(1)],
            };
          }));
        }
      } catch {
        // Keep the page usable even when config fails to load.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const updateLastBotMessage = (mutator: (last: Message) => Message) => {
    setSessions((prev) =>
      prev.map((ss) => {
        if (ss.id !== activeId) return ss;
        const msgs = [...ss.messages];
        const lastIdx = msgs.length - 1;
        if (lastIdx < 0 || msgs[lastIdx].role !== 'bot') return ss;
        msgs[lastIdx] = mutator(msgs[lastIdx]);
        return { ...ss, messages: msgs };
      }),
    );
  };

  const sendMessage = () => {
    if (!input.trim() || streaming) return;
    const text = input.trim();
    setInput('');
    setStreaming(true);

    setSessions((prev) =>
      prev.map((ss) =>
        ss.id === activeId
          ? { ...ss, messages: [...ss.messages, { role: 'user', text }, { role: 'bot', text: '' }] }
          : ss,
      ),
    );

    void streamChatCompletion({
      scene: 'qa',
      text,
      knowledgeSpaceIds,
      onUpdate(currentText) {
        setSessions((prev) =>
          prev.map((ss) => {
            if (ss.id !== activeId) return ss;
            const msgs = [...ss.messages];
            const lastIdx = msgs.length - 1;
            if (lastIdx < 0 || msgs[lastIdx].role !== 'bot') return ss;
            msgs[lastIdx] = { ...msgs[lastIdx], text: currentText };
            return {
              ...ss,
              title: ss.title === '新会话' ? text.slice(0, 12) : ss.title,
              messages: msgs,
            };
          }),
        );
      },
      onCitations(list) {
        updateLastBotMessage((last) => ({ ...last, citations: list }));
      },
    }).catch(() => {
      updateLastBotMessage((last) => ({
        ...last,
        text: '问答请求失败，请稍后重试。',
        citations: undefined,
      }));
    }).finally(() => {
      setStreaming(false);
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendMessage();
  };

  const newSession = () => {
    const id = `sess_${Date.now()}`;
    const ns: Session = {
      id,
      title: '新会话',
      messages: [{ role: 'bot', text: assistantGreeting }],
    };
    setSessions((prev) => [...prev, ns]);
    setActiveId(id);
  };

  return (
    <>
      <Header />
      <div className={s.layout}>
        <aside className={s.sidebar}>
          <div className={s.sideHeader}>历史会话</div>
          <div className={s.sessionList}>
            {sessions.map((ss) => (
              <div
                key={ss.id}
                className={`${s.sessionItem} ${ss.id === activeId ? s.sessionItemActive : ''}`}
                onClick={() => setActiveId(ss.id)}
              >
                {ss.title}
              </div>
            ))}
          </div>
          <button className={s.newSessionBtn} onClick={newSession}>
            <Plus size={14} />
            新建会话
          </button>
        </aside>

        <div className={s.main}>
          <div className={s.messages}>
            {activeSession.messages.map((msg, i) => {
              const isLastMessage = i === activeSession.messages.length - 1;
              const isThinking = streaming && msg.role === 'bot' && isLastMessage && !msg.text.trim();
              const referenced = msg.role === 'bot' && msg.citations
                ? extractReferencedCitations(msg.text, msg.citations)
                : [];
              return (
                <div
                  key={i}
                  className={`${s.msgRow} ${msg.role === 'user' ? s.msgRowUser : ''}`}
                >
                  <div className={`${s.avatar} ${msg.role === 'bot' ? s.avatarBot : s.avatarUser}`}>
                    {msg.role === 'bot' ? <Bot size={16} /> : <User size={16} />}
                  </div>
                  <div className={s.msgColumn}>
                    {msg.role === 'bot' ? (
                      isThinking ? (
                        <div className={`${s.msgBubble} ${s.msgBot} ${s.thinking}`}>
                          <Loader2 size={16} className={s.spinner} />
                          <span>思考中...</span>
                        </div>
                      ) : (
                        <div
                          className={`${s.msgBubble} ${s.msgBot} ${s.botContent}`}
                          dangerouslySetInnerHTML={{ __html: renderChatMarkdown(msg.text, msg.citations ?? []) }}
                        />
                      )
                    ) : (
                      <div className={`${s.msgBubble} ${s.msgUser}`}>{msg.text}</div>
                    )}
                    {msg.role === 'bot' && referenced.length > 0 ? (
                      <CitationList items={referenced} />
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div ref={msgEndRef} />
          </div>

          <div className={s.inputBar}>
            <input
              className={s.chatInput}
              placeholder="请输入您的问题..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className={s.sendBtn} onClick={sendMessage}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
