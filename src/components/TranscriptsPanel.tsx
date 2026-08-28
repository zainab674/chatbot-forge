'use client';

import { useCallback, useEffect, useState } from 'react';
import { ownerHeaders } from '@/lib/owner';
import Markdown from './Markdown';
import type { ChatMessage } from '@/lib/types';

interface Summary {
  id: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  opening: string;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * What the bot has actually been saying — the first thing anyone asks for once
 * their bot is live, and the reason "it answered something odd" stops being
 * unfalsifiable.
 *
 * Only rendered when the owner has switched logging on for this bot, so the
 * empty state here means "nobody has talked to it yet", never "the setting is
 * off somewhere else".
 */
export default function TranscriptsPanel({ botId, retentionDays }: { botId: string; retentionDays: number }) {
  const [list, setList] = useState<Summary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/bots/${botId}/conversations`, { headers: ownerHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load conversations.');
        setList(j.conversations ?? []);
      })
      .catch((e) => setError(e.message));
  }, [botId]);

  useEffect(load, [load]);

  async function show(id: string) {
    if (open === id) {
      setOpen(null);
      setMessages(null);
      return;
    }
    setOpen(id);
    setMessages(null);
    try {
      const res = await fetch(`/api/bots/${botId}/conversations?conversation=${encodeURIComponent(id)}`, {
        headers: ownerHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not load that conversation.');
      setMessages(json.conversation?.messages ?? []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function clearAll() {
    if (!confirm('Delete every stored conversation for this bot? This cannot be undone.')) return;
    setList([]);
    setOpen(null);
    await fetch(`/api/bots/${botId}/conversations`, { method: 'DELETE', headers: ownerHeaders() }).catch(() => {});
  }

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Conversations</h2>
          <p className="hint mt-1">
            Kept for {retentionDays} {retentionDays === 1 ? 'day' : 'days'} after the last message, then deleted
            automatically.
          </p>
        </div>
        {(list?.length ?? 0) > 0 && (
          <button className="btn-ghost shrink-0" onClick={clearAll}>
            Delete all
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-control border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{error}</p>
      )}

      {list === null && <p className="hint mt-3">Loading…</p>}
      {list?.length === 0 && <p className="hint mt-3">No conversations yet. They appear here as visitors chat.</p>}

      <div className="mt-3 space-y-2">
        {list?.map((c) => (
          <div key={c.id} className="rounded-control border border-slate-200">
            <button
              className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
              onClick={() => show(c.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-slate-800">{c.opening || '(no message)'}</span>
                <span className="hint mt-0.5 block">
                  {c.messageCount} messages · {when(c.updatedAt)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400" aria-hidden>
                {open === c.id ? '−' : '+'}
              </span>
            </button>

            {open === c.id && (
              <div className="border-t border-slate-200 px-4 py-3">
                {messages === null && <p className="hint">Loading…</p>}
                <div className="space-y-3">
                  {messages?.map((m, i) => (
                    <div key={i}>
                      <p className="text-[11px] font-medium uppercase tracking-label text-slate-400">
                        {m.role === 'user' ? 'Visitor' : 'Bot'}
                      </p>
                      <div className="mt-1 text-xs leading-relaxed text-slate-700">
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
