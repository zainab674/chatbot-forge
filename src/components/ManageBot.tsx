'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ChatWindow from './ChatWindow';
import KnowledgeManager from './KnowledgeManager';
import PageHeader from './PageHeader';
import BookingsPanel from './BookingsPanel';
import TranscriptsPanel from './TranscriptsPanel';
import { ownerHeaders } from '@/lib/owner';
import { getProvider } from '@/lib/providers';
import { getStyle } from '@/lib/styles';
import { getEmbeddingProvider, NO_EMBEDDINGS } from '@/lib/knowledge/embed';
import { PLATFORM_MODELS, ANON_TRIAL_MESSAGES } from '@/lib/platform';
import type { BotSummary, PublicBot } from '@/lib/types';

type Tab = 'link' | 'iframe' | 'widget' | 'api';

export default function ManageBot({ id }: { id: string }) {
  const router = useRouter();
  const [bot, setBot] = useState<BotSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('widget');
  const [origin, setOrigin] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [anon, setAnon] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setAnon(!j.user))
      .catch(() => {});
    setOrigin(process.env.NEXT_PUBLIC_APP_URL || window.location.origin);
    fetch(`/api/bots/${id}`, { headers: ownerHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load this chatbot.');
        return j;
      })
      .then((j) => setBot(j.bot))
      .catch((e) => setError(e.message));
  }, [id]);

  const snippets = useMemo(() => {
    const base = origin || 'https://your-domain.com';
    return {
      link: `${base}/chat/${id}`,
      iframe: `<iframe
  src="${base}/embed/${id}"
  title="${bot?.name ?? 'Chatbot'}"
  style="width:100%;height:600px;border:0;border-radius:16px"
  allow="clipboard-write"
></iframe>`,
      widget: `<script
  src="${base}/widget.js"
  data-bot-id="${id}"
  data-position="right"
  defer
></script>`,
      api: `curl -N ${base}/api/chat/${id} \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'

# Streams the reply back as plain text.
# Send the whole conversation each time to give it memory:
# {"messages":[{"role":"user",...},{"role":"assistant",...},{"role":"user",...}]}`,
    };
  }, [origin, id, bot?.name]);

  async function remove() {
    setDeleting(true);
    const res = await fetch(`/api/bots/${id}`, { method: 'DELETE', headers: ownerHeaders() });
    if (res.ok) {
      router.push('/bots');
      router.refresh();
    } else {
      setError('Could not delete this chatbot.');
      setDeleting(false);
    }
  }

  if (error)
    return (
      <div className="card">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/bots" className="btn-primary mt-4">
          Back to my bots
        </Link>
      </div>
    );

  if (!bot) return <div className="h-64 animate-pulse rounded-control bg-slate-100" />;

  const publicBot: PublicBot = {
    id: bot.id,
    name: bot.name,
    tagline: bot.tagline,
    greeting: bot.greeting,
    placeholder: bot.placeholder,
    suggestions: bot.suggestions ?? [],
    accent: bot.accent,
    theme: bot.theme,
    avatarEmoji: bot.avatarEmoji,
    model: bot.model,
    provider: bot.provider,
    citations: bot.citations ?? true,
    bookingEnabled: bot.bookingEnabled ?? false,
    bookingInstructions: bot.bookingInstructions ?? '',
  };

  return (
    <>
      <PageHeader
        back={{ href: '/bots', label: 'My bots' }}
        kicker={bot.isPublic ? 'Live chatbot' : 'Paused chatbot'}
        icon={
          <span
            className="flex h-12 w-12 flex-none items-center justify-center rounded-control text-2xl"
            style={{ backgroundColor: `${bot.accent}1f` }}
            aria-hidden
          >
            {bot.avatarEmoji}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {bot.name}
            {!bot.isPublic && (
              <span className="border border-slate-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                paused
              </span>
            )}
          </span>
        }
        sub={bot.tagline || 'No tagline'}
        actions={
          <>
            {/* Same order on every bot screen: the safe action, then the
                destructive one, with the primary action of this page first. */}
            <Link href={`/bots/${id}/edit`} className="btn-primary">
              Edit
            </Link>
            <a href={snippets.link} target="_blank" rel="noreferrer" className="btn-ghost">
              Open chat ↗
            </a>
            {confirmDelete ? (
              <button className="btn-danger" onClick={remove} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Really delete?'}
              </button>
            ) : (
              <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </>
        }
      />

      {!bot.apiKeyMask &&
        (anon ? (
          <div className="mb-5 rounded-control border border-accent-200 bg-accent-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
            {PLATFORM_MODELS.has(bot.model) ? (
              <>
                Draft mode:{' '}
                <span className="font-medium text-slate-900">
                  {Math.max(0, ANON_TRIAL_MESSAGES - (bot.messageCount ?? 0))} of {ANON_TRIAL_MESSAGES}
                </span>{' '}
                free trial messages left. Try it in the live test on the right.
              </>
            ) : (
              <>
                Draft mode: this model is not covered by the free trial, so chats will fail until a key is added.
              </>
            )}{' '}
            <Link href="/account" className="font-medium underline underline-offset-2">
              Sign up free
            </Link>{' '}
            to keep this chatbot, add your API key, and put it on a real site.
          </div>
        ) : (
          <div className="mb-5 rounded-control border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No API key saved for this chatbot yet, so chats will fail unless a platform key is configured for{' '}
            {getProvider(bot.provider)?.label}.{' '}
            <Link href={`/bots/${id}/edit`} className="underline underline-offset-2">
              Add one
            </Link>
            .
          </div>
        ))}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <section className="card tone-ink">
            <h2 className="mb-1 text-base font-semibold">Ship it</h2>
            <p className="mb-4 text-xs text-slate-500">Four ways to put this chatbot in front of people. Pick one.</p>
            {anon && !bot.apiKeyMask && (
              <p className="mb-4 rounded-control border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                These snippets work, but a draft&rsquo;s {ANON_TRIAL_MESSAGES}-message trial runs out fast on a real
                site. Sign up and add your API key before shipping it anywhere.
              </p>
            )}

            <div className="mb-4 flex flex-wrap gap-1.5">
              {(
                [
                  ['widget', 'Floating widget'],
                  ['iframe', 'Inline iframe'],
                  ['link', 'Share link'],
                  ['api', 'REST API'],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-control border px-3.5 py-2 text-[10.5px] font-medium uppercase tracking-wide transition ${
                    tab === key
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mb-2 text-xs leading-relaxed text-slate-600">
              {tab === 'widget' &&
                'Paste this once before </body> on any page. A chat bubble appears in the corner and opens your bot in a panel.'}
              {tab === 'iframe' &&
                'Drops the chat straight into your page layout at whatever size you give it. Good for a dedicated support or docs page.'}
              {tab === 'link' &&
                'A full-page hosted chat. Send it in an email, put it behind a button, or use it as a QR-code destination.'}
              {tab === 'api' &&
                'Talk to the bot from your own app or backend. Streams plain text; send the full message history for memory.'}
            </p>

            <CodeBlock code={snippets[tab]} />

            {tab === 'link' && (
              <a href={snippets.link} target="_blank" rel="noreferrer" className="btn-ghost mt-3">
                Open the chat page ↗
              </a>
            )}
            {tab === 'widget' && (
              <div className="mt-3 rounded-control bg-slate-50 p-3 text-xs text-slate-600">
                Options: <code>data-position=&quot;left|right&quot;</code>, <code>data-label</code> (tooltip text),{' '}
                <code>data-open=&quot;true&quot;</code> to start expanded, <code>data-width</code> /{' '}
                <code>data-height</code> in pixels.
              </div>
            )}
          </section>

          {(bot.bookingEnabled ?? false) && <BookingsPanel botId={bot.id} />}

          {(bot.logConversations ?? false) && (
            <TranscriptsPanel botId={bot.id} retentionDays={bot.logRetentionDays ?? 30} />
          )}

          <KnowledgeManager
            botId={bot.id}
            hasEmbeddings={Boolean(bot.embeddingProvider && bot.embeddingProvider !== NO_EMBEDDINGS)}
          />

          <section className="card tone-sand">
            <h2 className="mb-3 text-base font-semibold">Configuration</h2>
            <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
              <Row label="Provider" value={getProvider(bot.provider)?.label ?? bot.provider} />
              <Row label="Model" value={<code className="text-xs">{bot.model}</code>} />
              <Row label="API key" value={bot.apiKeyMask ? <code className="text-xs">{bot.apiKeyMask}</code> : 'none'} />
              <Row label="Talking style" value={getStyle(bot.style)?.label ?? bot.style} />
              <Row
                label="Embeddings"
                value={
                  bot.embeddingProvider && bot.embeddingProvider !== NO_EMBEDDINGS
                    ? `${getEmbeddingProvider(bot.embeddingProvider)?.label ?? bot.embeddingProvider}`
                    : 'Keyword only'
                }
              />
              <Row label="Chunks retrieved" value={`Top ${bot.retrievalTopK}`} />
              <Row label="Creativity" value={bot.temperature} />
              <Row label="Max reply" value={`${bot.maxTokens} tokens`} />
              <Row label="Memory" value={`${bot.memoryTurns} turns`} />
              <Row label="Messages handled" value={bot.messageCount ?? 0} />
              <Row
                label="Allowed domains"
                value={bot.allowedOrigins?.length ? bot.allowedOrigins.join(', ') : 'Any domain'}
              />
              <Row label="Created" value={new Date(bot.createdAt).toLocaleDateString()} />
            </dl>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Live test</p>
          <div className="overflow-hidden rounded-control border border-slate-300 shadow-[0_6px_20px_-12px_rgba(30,27,24,0.4)]">
            <div className="h-[600px]">
              <ChatWindow bot={publicBot} fill />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {anon && !bot.apiKeyMask
              ? 'Real messages: these spend your draft’s free trial allowance.'
              : 'Real messages: these use your API key.'}
          </p>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="thin-scroll overflow-x-auto rounded-control bg-slate-900 p-4 pr-20 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            setCopied(false);
          }
        }}
        className="absolute right-2.5 top-2.5 rounded-control bg-white/10 px-2.5 py-1.5 text-xs text-white transition hover:bg-white/20"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
