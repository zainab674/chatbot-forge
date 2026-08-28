'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import ChatScene from './ChatScene';
import { accessibleSurface } from '@/lib/contrast';
import type { Citation, PublicBot } from '@/lib/types';
import { getChatTheme, type ChatTheme } from '@/lib/themes';

type Msg = { role: 'user' | 'assistant'; content: string; citations?: Citation[] };

/** The origin of the page that framed this chat, or '' when it stands alone. */
function hostPageOrigin(): string {
  if (typeof window === 'undefined' || window.parent === window) return '';
  try {
    return document.referrer ? new URL(document.referrer).origin : '';
  } catch {
    return '';
  }
}

interface Props {
  bot: PublicBot;
  /** Where to POST. Defaults to this app's own chat route. */
  endpoint?: string;
  /** Fills its parent instead of standing alone in the page. */
  fill?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  /** Builder preview before the bot exists: fakes a reply instead of calling the API. */
  demo?: boolean;
}

export default function ChatWindow({
  bot,
  endpoint,
  fill = false,
  showHeader = true,
  showFooter = true,
  demo = false,
}: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * One id per open chat, so a bot with logging on gets a readable thread
   * rather than a pile of one-message rows. Generated in the browser and never
   * reused across page loads: it identifies a conversation, not a person.
   */
  const conversationId = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2).padEnd(16, '0'),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const theme = getChatTheme(bot.theme);
  const dark = theme.dark;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      setError(null);
      setInput('');
      const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
      setMessages([...next, { role: 'assistant', content: '' }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      if (demo) {
        const canned = `This is a styling preview, so I'm not calling **${bot.model}** yet.\n\nCreate the chatbot and you'll get a live test chat, a share link, and embed code on the next screen.`;
        for (let i = 1; i <= canned.length; i += 3) {
          if (controller.signal.aborted) break;
          const slice = canned.slice(0, i);
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: 'assistant', content: slice };
            return copy;
          });
          await new Promise((r) => setTimeout(r, 8));
        }
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: canned };
          return copy;
        });
        setStreaming(false);
        abortRef.current = null;
        return;
      }

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // Inside an iframe this chat is served from the platform, so its own
        // Origin says nothing about which site embedded it. The referrer is
        // the framing page, and the allow-list is checked against that.
        const framedBy = hostPageOrigin();
        if (framedBy) headers['X-Embed-Origin'] = framedBy;
        // Ties this session's requests together into one transcript, for the
        // owners who switch logging on. Ignored entirely by everyone else.
        headers['X-Conversation-Id'] = conversationId.current;

        const res = await fetch(endpoint ?? `/api/chat/${bot.id}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ messages: next }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let message = `Request failed (${res.status}).`;
          try {
            const j = await res.json();
            if (j?.error) message = j.error;
          } catch {
            /* keep default */
          }
          throw new Error(message);
        }

        let citations: Citation[] | undefined;
        const raw = res.headers.get('x-citations');
        if (raw) {
          try {
            citations = JSON.parse(decodeURIComponent(escape(atob(raw))));
          } catch {
            citations = undefined;
          }
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: 'assistant', content: acc, citations };
            return copy;
          });
        }
        if (!acc.trim()) {
          setMessages((prev) => prev.slice(0, -1));
          setError('The model returned an empty response. Try again or lower the max tokens.');
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          setMessages((prev) => (prev[prev.length - 1]?.content ? prev : prev.slice(0, -1)));
        } else {
          setMessages((prev) => prev.slice(0, -1));
          setError(e?.message ?? 'Something went wrong.');
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        textareaRef.current?.focus();
      }
    },
    [bot.id, bot.model, demo, endpoint, messages, streaming],
  );

  const stop = () => abortRef.current?.abort();
  const reset = () => {
    stop();
    setMessages([]);
    setError(null);
  };

  const showIntro = messages.length === 0;

  return (
    <div
      className={[
        dark ? 'dark text-slate-100' : 'text-slate-900',
        'relative flex flex-col overflow-hidden',
        fill ? 'h-full w-full' : 'h-[640px] w-full max-w-2xl rounded-2xl border shadow-xl',
        !fill && (dark ? 'border-slate-700' : 'border-slate-200'),
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ['--accent' as any]: bot.accent, background: theme.surface }}
    >
      <ChatScene theme={theme} busy={streaming} />

      {showHeader && (
        <header
          className="relative flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: theme.border }}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg"
            style={{
              backgroundColor: `${bot.accent}1f`,
              boxShadow: theme.glow ? `0 0 18px 2px ${theme.glow}` : undefined,
            }}
            aria-hidden
          >
            {bot.avatarEmoji}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{bot.name}</div>
            {bot.tagline && (
              <div className={`truncate text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{bot.tagline}</div>
            )}
          </div>
          {bot.bookingEnabled && (
            <button
              onClick={() => setBooking(true)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition"
              style={accessibleSurfaceStyle(bot.accent)}
            >
              📅 Book
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={reset}
              className={`rounded-lg px-2.5 py-1.5 text-xs transition ${
                dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              New chat
            </button>
          )}
        </header>
      )}

      {booking && <BookingForm bot={bot} dark={dark} demo={demo} onClose={() => setBooking(false)} />}

      <div ref={scrollRef} className="thin-scroll relative flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {showIntro && (
          <div className="animate-fade-up">
            <Bubble theme={theme} accent={bot.accent} role="assistant" emoji={bot.avatarEmoji}>
              <Markdown text={bot.greeting || `Hi! I'm ${bot.name}.`} />
            </Bubble>
            {bot.suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 pl-10">
                {bot.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${
                      dark
                        ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            <Bubble theme={theme} accent={bot.accent} role={m.role} emoji={bot.avatarEmoji}>
              {m.content ? (
                <Markdown text={m.content} />
              ) : (
                <span className="inline-flex gap-1 py-1" aria-label="Thinking">
                  <Dot delay="0s" />
                  <Dot delay=".2s" />
                  <Dot delay=".4s" />
                </span>
              )}
            </Bubble>
            {m.role === 'assistant' && m.content && m.citations?.length ? (
              <Sources citations={m.citations} dark={dark} accent={bot.accent} />
            ) : null}
          </div>
        ))}

        {error && (
          <div
            className={`rounded-xl border px-3 py-2 text-xs ${
              dark ? 'border-red-900 bg-red-950 text-red-200' : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {error}
          </div>
        )}
      </div>

      <div className="relative border-t px-3 py-3" style={{ borderColor: theme.border }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className={`flex items-end gap-2 rounded-2xl border px-3 py-2 transition focus-within:ring-4 ${theme.composer}`}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(140, el.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={bot.placeholder || 'Type a message…'}
            className={`max-h-36 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none ${
              dark ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'
            }`}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
                dark ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700'
              }`}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:opacity-40"
              style={accessibleSurfaceStyle(bot.accent)}
              aria-label="Send"
            >
              ↑
            </button>
          )}
        </form>
        {showFooter && (
          <p className={`mt-2 text-center text-[11px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            AI can make mistakes, so double-check anything important.
          </p>
        )}
      </div>
    </div>
  );
}

/** Accent background with a foreground that is guaranteed to be readable on it. */
function accessibleSurfaceStyle(accent: string) {
  const { background, foreground } = accessibleSurface(accent);
  return { backgroundColor: background, color: foreground };
}

/** The Book button's form, laid over the conversation. */
function BookingForm({
  bot,
  dark,
  demo,
  onClose,
}: {
  bot: PublicBot;
  dark: boolean;
  demo: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:ring-4 ${
    dark
      ? 'border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500 focus:ring-white/5'
      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:ring-slate-900/5'
  }`;
  const label = `mb-1 mt-3 block text-xs font-medium ${dark ? 'text-slate-300' : 'text-slate-600'}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (demo) {
      setDone(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const framedBy = hostPageOrigin();
      if (framedBy) headers['X-Embed-Origin'] = framedBy;
      const res = await fetch(`/api/book/${bot.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, contact, when, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Could not send the booking.');
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`absolute inset-0 z-10 overflow-y-auto p-4 ${dark ? 'bg-slate-900/95' : 'bg-white/95'} backdrop-blur-sm`}>
      <div className="mx-auto max-w-sm pt-2">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Book an appointment</h3>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-2 py-1 text-xs ${dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {bot.bookingInstructions && (
          <p className={`mb-2 text-xs leading-relaxed ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {bot.bookingInstructions}
          </p>
        )}

        {done ? (
          <div
            className={`rounded-xl border px-4 py-4 text-sm leading-relaxed ${
              dark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
            }`}
          >
            <p className="font-medium">Request sent ✅</p>
            <p className={`mt-1 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {demo
                ? 'This is the builder preview, so nothing was really sent.'
                : `They'll get back to you at ${contact}.`}
            </p>
            <button type="button" className="mt-3 rounded-xl px-3.5 py-2 text-xs font-medium" style={accessibleSurfaceStyle(bot.accent)} onClick={onClose}>
              Back to chat
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label className={label}>Your name</label>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
            <label className={label}>Email or phone</label>
            <input
              className={field}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="so they can get back to you"
              maxLength={200}
              required
            />
            <label className={label}>Preferred date &amp; time</label>
            <input
              className={field}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              placeholder="e.g. Tuesday afternoon, or 24 Aug 3pm"
              maxLength={200}
            />
            <label className={label}>Anything they should know? (optional)</label>
            <textarea className={`${field} min-h-[64px]`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />

            {error && (
              <p
                className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                  dark ? 'border-red-900 bg-red-950 text-red-200' : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !name.trim() || !contact.trim()}
              className="mt-4 w-full rounded-xl px-3.5 py-2.5 text-sm font-medium transition disabled:opacity-40"
              style={accessibleSurfaceStyle(bot.accent)}
            >
              {busy ? 'Sending…' : 'Request booking'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Numbered chips under an answer, matching the [1] markers in the text. */
function Sources({ citations, dark, accent }: { citations: Citation[]; dark: boolean; accent: string }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-1.5 pl-9">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[11px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Sources</span>
        {citations.map((c) => {
          const chip = (
            <>
              <span className="font-medium" style={{ color: accent }}>
                {c.n}
              </span>
              <span className="max-w-[160px] truncate">{c.title}</span>
            </>
          );
          const className = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
            dark
              ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`;
          return c.url ? (
            <a key={c.n} href={c.url} target="_blank" rel="noopener noreferrer" className={className} title={c.url}>
              {chip}
            </a>
          ) : (
            <button
              key={c.n}
              type="button"
              onClick={() => setOpen(open === c.n ? null : c.n)}
              className={className}
              title="Show the excerpt this came from"
            >
              {chip}
            </button>
          );
        })}
      </div>
      {open !== null && (
        <p
          className={`mt-1.5 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${
            dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-50 text-slate-600'
          }`}
        >
          {citations.find((c) => c.n === open)?.snippet}…
        </p>
      )}
    </div>
  );
}

function Bubble({
  role,
  children,
  theme,
  accent,
  emoji,
}: {
  role: 'user' | 'assistant';
  children: React.ReactNode;
  theme: ChatTheme;
  accent: string;
  emoji: string;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex animate-fade-up gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
          style={{
            backgroundColor: `${accent}1f`,
            boxShadow: theme.glow ? `0 0 14px 1px ${theme.glow}` : undefined,
          }}
          aria-hidden
        >
          {emoji}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser ? '' : theme.bubble
        }`}
        style={isUser ? accessibleSurfaceStyle(accent) : undefined}
      >
        {children}
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-blink rounded-full bg-current"
      style={{ animationDelay: delay }}
    />
  );
}
