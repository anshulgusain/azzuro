import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, type ChatMessage, type ChatView } from '../lib/api';
import { Icon } from './ui';

const SUGGESTIONS = [
  'How are we doing this week?',
  'What are guests complaining about most?',
  'Which hotel needs the most attention?',
  'Show me recent reviews that mention noise',
  'How does Booking.com rate our cleanliness?',
  'Compare Potts Point with Darling Harbour',
];

const STORAGE_KEY = 'assistant-chat';

function loadSaved(): ChatMessage[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(saved) ? (saved as ChatMessage[]).filter((m) => m && typeof m.content === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * "Ask a question" chat for staff. Answers come from an OpenAI model that can
 * only read the same review data as the dashboard (see src/assistant).
 */
export function Assistant({ view, viewLabel }: { view: ChatView; viewLabel: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(loadSaved);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.assistantStatus().then(setStatus).catch(() => setStatus({ enabled: false, model: null }));
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
    } catch {
      /* storage full or blocked: the chat still works */
    }
  }, [messages]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending, error]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setDraft('');
    setError(null);
    setPending(true);
    try {
      const res = await api.chat(next, view);
      setMessages([...next, { role: 'assistant', content: res.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  function retry() {
    const lastQuestion = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastQuestion) return;
    setMessages(messages.slice(0, messages.lastIndexOf(lastQuestion)));
    void send(lastQuestion.content);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  return (
    <>
      {!open && (
        <button className="ask-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Icon name="reviews" size={20} />
          <span>Ask a question</span>
        </button>
      )}
      {open && (
        <aside className="ask-panel" role="dialog" aria-label="Ask about guest reviews" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <header className="ask-head">
            <div>
              <h2>Ask about guest reviews</h2>
              <p className="ask-context">Looking at: {viewLabel}</p>
            </div>
            <div className="ask-head-actions">
              {messages.length > 0 && (
                <button className="link small" onClick={() => (setMessages([]), setError(null))}>
                  New chat
                </button>
              )}
              <button className="ask-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
          </header>

          <div className="ask-body" ref={listRef} aria-live="polite">
            {status && !status.enabled ? (
              <div className="ask-off">
                <p>
                  <strong>The assistant isn't switched on yet.</strong>
                </p>
                <p>It needs an OpenAI account key. Ask IT to add it to the dashboard's settings file and restart it (the steps are in the README).</p>
                <p className="muted small">Everything else on the dashboard works without it.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="ask-welcome">
                <p>Ask anything about our guest reviews in your own words. For example:</p>
                <div className="ask-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="ask-suggestion" onClick={() => void send(s)} disabled={!status?.enabled}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`bubble bubble-${m.role}`}>
                  {m.role === 'assistant' ? <Formatted text={m.content} /> : <p>{m.content}</p>}
                </div>
              ))
            )}
            {pending && (
              <div className="bubble bubble-assistant bubble-pending">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                Looking through the reviews…
              </div>
            )}
            {error && (
              <div className="ask-error" role="alert">
                <p>{error}</p>
                <button className="link small" onClick={retry}>
                  Try again
                </button>
              </div>
            )}
          </div>

          <form
            className="ask-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={draft}
              maxLength={2000}
              placeholder={status?.enabled === false ? 'Not available yet' : 'Type your question…'}
              disabled={status?.enabled === false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Your question"
            />
            <button className="btn btn-primary" type="submit" disabled={!draft.trim() || pending || status?.enabled === false}>
              Send
            </button>
          </form>
          <p className="ask-note">Answers use the review data in this dashboard. AI can make mistakes, so check important numbers on the Summary page.</p>
        </aside>
      )}
    </>
  );
}

/* ---------- Safe rendering of the model's simple Markdown (**bold** and "- " lists) ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

function Formatted({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  const flushBullets = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(' '))}</p>);
    para = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '').trimEnd();
    if (!line.trim()) {
      flushBullets();
      flushPara();
    } else if (BULLET.test(line)) {
      flushPara();
      bullets.push(line.replace(BULLET, ''));
    } else {
      flushBullets();
      para.push(line.trim());
    }
  }
  flushBullets();
  flushPara();
  return <>{out}</>;
}
