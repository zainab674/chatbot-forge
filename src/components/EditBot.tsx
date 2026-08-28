'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import BotForm from './BotForm';
import PageHeader from './PageHeader';
import { ownerHeaders } from '@/lib/owner';
import type { BotSummary, BotConfig } from '@/lib/types';

export default function EditBot({ id }: { id: string }) {
  const [bot, setBot] = useState<BotSummary | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(false);
  const [anon, setAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setAnon(!j.user))
      .catch(() => {});
    fetch(`/api/bots/${id}`, { headers: ownerHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? 'Could not load this chatbot.');
        return j;
      })
      .then((j) => {
        setBot(j.bot);
        setHasKey(j.hasKey);
        setHasEmbeddingKey(j.hasEmbeddingKey);
      })
      .catch((e) => setError(e.message));
  }, [id]);

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

  return (
    <>
      {/* "Back" used to sit on the right as a button, which put an escape
          hatch where every other page puts its primary action. It is a crumb
          now, and it names where it goes. */}
      <PageHeader
        back={{ href: `/bots/${id}`, label: bot.name }}
        kicker="Editing"
        title={`Edit ${bot.name}`}
        sub="Changes go live everywhere the bot is embedded as soon as you save."
        actions={
          <Link href={`/bots/${id}`} className="btn-ghost">
            Cancel
          </Link>
        }
      />
      <BotForm
        mode="edit"
        botId={id}
        initial={bot as unknown as BotConfig}
        hasKey={hasKey}
        existingMask={bot.apiKeyMask}
        hasEmbeddingKey={hasEmbeddingKey}
        embeddingMask={bot.embeddingKeyMask}
        anonMode={anon}
      />
    </>
  );
}
