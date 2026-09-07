'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ownerHeaders } from '@/lib/owner';
import { getProvider } from '@/lib/providers';
import type { BotSummary } from '@/lib/types';

/** How many cards the homepage teaser shows before sending you to /bots. */
const PREVIEW_COUNT = 4;

/**
 * The full list is the /bots dashboard. `preview` renders the same cards as a
 * homepage teaser instead: it stays silent when there is nothing to resume, so
 * the landing page never shows an empty state or a login prompt to a visitor.
 */
export default function BotList({ preview = false }: { preview?: boolean }) {
  const [items, setItems] = useState<BotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [anon, setAnon] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setAnon(!j.user))
      .catch(() => {});
    fetch('/api/bots', { headers: ownerHeaders() })
      .then(async (r) => {
        if (r.status === 401) {
          setNeedsLogin(true);
          return { bots: null };
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load your chatbots.');
        return j;
      })
      .then((j) => setItems(j.bots))
      .catch((e) => setError(e.message));
  }, []);

  if (needsLogin) {
    if (preview) return null;
    return (
      <div className="card text-center">
        <p className="text-sm text-slate-600">Log in to see your chatbots, and to create new ones.</p>
        <p className="mt-1 text-xs text-slate-500">
          Your bots and encrypted API keys live on your account, so they are not stuck in one browser.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Link href="/account" className="btn-primary">
            Log in or sign up
          </Link>
          <Link href="/create" className="btn-ghost">
            Build one first
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    if (preview) return null;
    return (
      <div className="rounded-control border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {error}
        <p className="mt-1 text-xs">Check that MongoDB is running and <code>MONGODB_URI</code> is set in <code>.env.local</code>.</p>
      </div>
    );
  }

  if (items === null) {
    if (preview) return null;
    return <div className="h-24 animate-pulse rounded-control bg-slate-100" />;
  }

  if (items.length === 0) {
    if (preview) return null;
    return (
      <div className="card text-center">
        <p className="text-sm text-slate-600">No chatbots yet.</p>
        <Link href="/create" className="btn-primary mt-5">
          Create your first one
        </Link>
      </div>
    );
  }

  const shown = preview ? items.slice(0, PREVIEW_COUNT) : items;

  return (
    <section>
      {/* On /bots the page header already says "My bots" — repeating it here
          put two rules and two labels on top of each other. The teaser on the
          homepage is the only place this heading has work to do. */}
      {preview && (
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <h2 className="kicker">Your chatbots</h2>
          <Link href="/bots" className="crumb">
            See all {items.length}
            <span className="crumb-arrow rotate-180" aria-hidden>
              ←
            </span>
          </Link>
        </div>
      )}
      {anon && !preview && (
        <div className="mb-4 rounded-control border border-accent-200 bg-accent-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          These drafts live only in this browser. Clear your browsing data and they are gone.{' '}
          <Link href="/account" className="font-medium underline underline-offset-2">
            Sign up free
          </Link>{' '}
          to keep them, add API keys, and go live. Everything moves to your account automatically.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((b) => (
          <Link key={b.id} href={`/bots/${b.id}`} className="card flex items-start gap-3 transition hover:shadow-md">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-xl"
              style={{ backgroundColor: `${b.accent}1f` }}
            >
              {b.avatarEmoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{b.name}</span>
                {!b.isPublic && (
                  <span className="border border-slate-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">paused</span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{b.tagline || 'No tagline'}</span>
              <span className="mt-2 block text-[11px] text-slate-400">
                {getProvider(b.provider)?.label ?? b.provider} · {b.model} · {b.messageCount ?? 0} messages
                {!b.apiKeyMask && ' · no API key'}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
