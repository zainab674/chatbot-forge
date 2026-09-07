'use client';

import { useCallback, useEffect, useState } from 'react';
import { KEY_REQUEST_MAX_CHARS } from '@/lib/platform';

/**
 * "Ask the admin for a key", from inside the builder.
 *
 * A creator with no key of their own and no credits left used to have nowhere
 * to go from this step: paste a key or spend credits, and both doors shut. This
 * is the third door. It sends a short note — their address, the provider and
 * model they were on, and what they typed — to /admin, and then shows them
 * where that note got to.
 *
 * Deliberately not a grant: an approved request means an admin agreed, and the
 * key or the credits arrive through the panel separately.
 */

type Status = 'pending' | 'approved' | 'declined';

interface Request {
  id: string;
  provider: string;
  providerLabel: string;
  model: string;
  reason: string;
  status: Status;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  adminNote: string;
}

export default function KeyRequest({
  provider,
  providerLabel,
  model,
}: {
  provider: string;
  providerLabel: string;
  model: string;
}) {
  const [mine, setMine] = useState<Request[] | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/key-requests')
      .then(async (r) => (r.ok ? r.json() : { requests: [] }))
      .then((j) => setMine(j.requests ?? []))
      // A builder step should not break because this list would not load; the
      // button simply offers to file a request, which is the fallback anyway.
      .catch(() => setMine([]));
  }, []);

  useEffect(load, [load]);

  // The newest request about the provider on screen. An older one for a
  // provider the creator has since switched away from is not this step's news.
  const current = mine?.find((r) => r.provider === provider) ?? null;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/key-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not send the request.');
      setReason('');
      setOpen(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (mine === null) return null;

  if (current && current.status === 'pending') {
    return (
      <Strip tone="wait">
        <p>
          <strong className="font-semibold">Waiting on the admin.</strong> You asked about {current.providerLabel} on{' '}
          {new Date(current.createdAt).toLocaleDateString()}. Nothing changes until they answer — until then this bot
          still needs a key of its own or credits on your account to reply.
        </p>
      </Strip>
    );
  }

  if (current && current.status === 'approved') {
    return (
      <Strip tone="ok">
        <p>
          <strong className="font-semibold">Approved</strong>
          {current.decidedBy ? ` by ${current.decidedBy}` : ''}. Check your balance on{' '}
          <a className="underline underline-offset-2" href="/account">
            your account
          </a>
          ; if credits are there, leaving the key box empty runs this bot on them.
          {current.adminNote && <span className="mt-1 block italic">&ldquo;{current.adminNote}&rdquo;</span>}
        </p>
      </Strip>
    );
  }

  return (
    <div className="mt-2.5">
      {current?.status === 'declined' && (
        <Strip tone="no">
          <p>
            <strong className="font-semibold">Declined.</strong>
            {current.adminNote ? (
              <span className="mt-1 block italic">&ldquo;{current.adminNote}&rdquo;</span>
            ) : (
              ' No reason was given.'
            )}
          </p>
        </Strip>
      )}

      {!open ? (
        <button
          type="button"
          className="text-[12px] text-slate-600 underline underline-offset-2 hover:text-slate-900"
          onClick={() => setOpen(true)}
        >
          {current?.status === 'declined' ? 'Ask again ↗' : `Don't have one? Ask the admin for a ${providerLabel} key ↗`}
        </button>
      ) : (
        <div className="rounded-control border border-slate-300 p-4">
          <span className="field-label">
            Ask the admin
            <span className="field-hint">
              they see your email, {providerLabel}
              {model ? ` · ${model}` : ''}, and this note
            </span>
          </span>
          <textarea
            className="input min-h-[84px] resize-y"
            value={reason}
            maxLength={KEY_REQUEST_MAX_CHARS}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What the bot is for, and roughly how much traffic you expect."
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary !px-5 !py-2" onClick={send} disabled={busy || !reason.trim()}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              className="btn-ghost !px-5 !py-2"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <span className="ml-auto text-[11px] text-slate-500">
              {reason.length}/{KEY_REQUEST_MAX_CHARS}
            </span>
          </div>
          {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The app's left-rule note, in the three tones this component needs. */
function Strip({ tone, children }: { tone: 'wait' | 'ok' | 'no'; children: React.ReactNode }) {
  const tones = {
    wait: 'border-amber-400 bg-amber-50 text-amber-900',
    ok: 'border-emerald-500 bg-emerald-50 text-emerald-900',
    no: 'border-slate-400 bg-slate-50 text-slate-700',
  } as const;
  return (
    <div className={`mt-2.5 border-l-2 px-4 py-3 text-[12.5px] font-light leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
