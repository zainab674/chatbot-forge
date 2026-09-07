'use client';

/**
 * The first and last steps of the builder, plus the summary column beside them.
 *
 * Split out of BotForm, which had grown past 1700 lines. These take plain props
 * and hold no state of the form's own, so they read on their own terms.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProvider } from '@/lib/providers';
import { ANON_TRIAL_MESSAGES } from '@/lib/platform';
import type { BotConfig } from '@/lib/types';



/** One tap fills the spark box. */
const EXAMPLES = [
  {
    emoji: '🕯️',
    label: 'Shop support',
    text: 'I run a candle shop called Wick & Wax. Friendly tone. We ship in 1 to 3 business days, returns within 30 days, free shipping over $50. Escalate anything about wholesale to hello@wickandwax.com.',
  },
  {
    emoji: '🩺',
    label: 'Clinic front desk',
    text: 'A front desk assistant for Brightsmile Dental. Patient, reassuring. Open Mon to Fri 9 to 6, Sat 9 to 1. We take most insurance and a check-up is $90. Never give medical advice, offer to book instead.',
  },
  {
    emoji: '🚀',
    label: 'SaaS onboarding',
    text: 'An onboarding guide for Acme, a project management tool. Concise and technical. Free is 3 projects, Pro is $12 per user per month, Enterprise adds SSO. Send billing questions to billing@acme.com.',
  },
  {
    emoji: '🏠',
    label: 'Property enquiries',
    text: 'An assistant for Meridian Lettings. Professional and quick. We list flats across Manchester, viewings run Tue to Sat, deposits are five weeks rent. Take the caller name and number for a viewing request.',
  },
  {
    emoji: '📚',
    label: 'Course tutor',
    text: 'A tutor for my GCSE maths course. Patient, asks a guiding question before giving the answer. Cover algebra, geometry and statistics. Never just hand over the answer unless the student asks plainly.',
  },
];

/* ============================ step 1: spark ============================ */

export function SparkStep({
  describe,
  setDescribe,
  generating,
  onGenerate,
  onSkip,
}: {
  describe: string;
  setDescribe: (v: string) => void;
  generating: boolean;
  onGenerate: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="px-2 py-6 text-center sm:px-8 sm:py-10">
      <h2 className="mx-auto max-w-[17ch] font-serif text-[40px] font-normal leading-[1.14] sm:text-[50px]">
        Tell me what your bot <span className="text-gradient">does</span>.
      </h2>
      <p className="mx-auto mt-5 max-w-[54ch] text-[15.5px] font-light leading-[1.8] text-slate-600">
        One or two sentences is plenty. Forge writes the prompt, picks a voice, and fills in the rest. You can change
        every bit of it afterwards.
      </p>

      {/* Skip sits above the box, aligned to its right edge: someone who already
          knows what they want shouldn't have to read past the examples to find
          the way out. */}
      <div className="mx-auto mt-7 flex max-w-[760px] justify-end">
        <button
          type="button"
          onClick={onSkip}
          className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-accent-700 hover:decoration-accent-600"
        >
          Skip — start from blank →
        </button>
      </div>

      <div className="bigbox mt-2.5">
        <textarea
          className="bigbox-area thin-scroll"
          value={describe}
          onChange={(e) => setDescribe(e.target.value)}
          maxLength={600}
          placeholder="I run a candle shop called Wick & Wax. Friendly tone. We ship in 1 to 3 business days, returns within 30 days, free shipping over $50. Escalate anything about wholesale to hello@wickandwax.com."
          onKeyDown={(e) => {
            // ⌘/Ctrl + Enter builds, matching the hint under the box.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && describe.trim().length >= 10 && !generating) {
              e.preventDefault();
              onGenerate();
            }
          }}
        />
        <div className="bigbox-bar">
          <div className="flex gap-2">
            <span className="mini-tag">⌘ + Enter to build</span>
            <span className="mini-tag">{describe.length} / 600</span>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={onGenerate}
            disabled={generating || describe.trim().length < 10}
          >
            {generating ? 'Forging…' : 'Forge it ✨'}
          </button>
        </div>
      </div>

      <div className="mx-auto mt-7 flex max-w-[720px] flex-wrap justify-center gap-2.5">
        <span className="chip chip-hot">
          <span aria-hidden>🔥</span> Popular
        </span>
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className="chip" onClick={() => setDescribe(ex.text)}>
            <span aria-hidden>{ex.emoji}</span> {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ step 6: ship ============================ */

export function ShipStep({
  id,
  cfg,
  anonMode,
  onToggleLive,
  onSave,
  saving,
}: {
  id: string | undefined;
  cfg: BotConfig;
  anonMode: boolean;
  onToggleLive: (v: boolean) => void;
  onSave: () => Promise<string | undefined>;
  saving: boolean;
}) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(process.env.NEXT_PUBLIC_APP_URL || window.location.origin);
  }, []);

  const base = origin || 'https://your-domain.com';
  const link = `${base}/chat/${id ?? ''}`;
  const widget = `<script\n  src="${base}/widget.js"\n  data-bot-id="${id ?? ''}"\n  data-position="right"\n  defer\n></script>`;
  const iframe = `<iframe\n  src="${base}/embed/${id ?? ''}"\n  title="${cfg.name || 'Chatbot'}"\n  style="width:100%;height:600px;border:0;border-radius:16px"\n></iframe>`;

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  return (
    <>
      <div className="ship-hero">
        <span className="ship-big" aria-hidden>
          🚀
        </span>
        <div className="min-w-0">
          <h3 className="font-serif text-[22px] font-normal">{cfg.name || 'Your chatbot'} is live.</h3>
          <p className="text-[13.5px] font-medium text-slate-700">
            Change anything later — the link stays the same.
          </p>
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2.5 rounded-control border border-emerald-600 bg-white py-2 pl-3.5 pr-2 text-[10.5px] font-medium uppercase tracking-wide text-emerald-700">
          {cfg.isPublic ? 'Live' : 'Paused'}
          <input
            type="checkbox"
            className="sr-only"
            checked={cfg.isPublic}
            onChange={(e) => {
              onToggleLive(e.target.checked);
              // The bot already exists here, so the switch has to reach the server.
              setTimeout(onSave, 0);
            }}
          />
          <span
            className={`relative h-[23px] w-10 rounded-full transition ${cfg.isPublic ? 'bg-emerald-500' : 'bg-slate-300'}`}
            aria-hidden
          >
            <span
              className={`absolute top-[3px] h-[17px] w-[17px] rounded-full bg-white transition-all ${cfg.isPublic ? 'left-[20px]' : 'left-[3px]'}`}
            />
          </span>
        </label>
      </div>

      {anonMode && (
        <div className="note-strip is-warm mb-5 mt-0">
          <span className="text-base" aria-hidden>
            ⚠️
          </span>
          <p>
            This is a draft on {ANON_TRIAL_MESSAGES} trial messages. The snippets below work, but{' '}
            <Link className="underline underline-offset-2" href="/account">
              sign up
            </Link>{' '}
            and add a key before you put it on a real site.
          </p>
        </div>
      )}

      <div className="grid gap-3.5">
        <div className="shipcard">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="shipcard-ic bg-accent-50" aria-hidden>
              🔗
            </span>
            <h4 className="text-[14.5px] font-extrabold tracking-tight">Hosted page</h4>
            <span className="tagx">easiest</span>
          </div>
          <div className="urlbox">
            <code>{link}</code>
            <button
              type="button"
              className="ml-auto whitespace-nowrap text-xs font-extrabold text-accent-600"
              onClick={() => copy('link', link)}
            >
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <a className="pill" href={link} target="_blank" rel="noreferrer">
              Open it ↗
            </a>
            <Link className="pill" href={`/bots/${id}`}>
              Manage
            </Link>
          </div>
        </div>

        <div className="shipcard">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="shipcard-ic bg-red-50" aria-hidden>
              {'</>'}
            </span>
            <h4 className="text-[14.5px] font-extrabold tracking-tight">Embed on your site</h4>
            <span className="tagx">bubble, bottom right</span>
          </div>
          <div className="codeblk thin-scroll">
            <pre>{widget}</pre>
          </div>
          <button
            type="button"
            className="mt-3 text-xs font-extrabold text-accent-600"
            onClick={() => copy('widget', widget)}
          >
            {copied === 'widget' ? 'Copied' : 'Copy snippet'}
          </button>
        </div>

        <div className="shipcard">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="shipcard-ic bg-sky-100" aria-hidden>
              🖼️
            </span>
            <h4 className="text-[14.5px] font-extrabold tracking-tight">Inline iframe</h4>
            <span className="tagx">sits in the page</span>
          </div>
          <div className="codeblk thin-scroll">
            <pre>{iframe}</pre>
          </div>
          <button
            type="button"
            className="mt-3 text-xs font-extrabold text-accent-600"
            onClick={() => copy('iframe', iframe)}
          >
            {copied === 'iframe' ? 'Copied' : 'Copy snippet'}
          </button>
        </div>

        <div className="shipcard">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="shipcard-ic bg-amber-100" aria-hidden>
              ⚙️
            </span>
            <h4 className="text-[14.5px] font-extrabold tracking-tight">API</h4>
          </div>
          <p className="m-0 text-[13px] leading-relaxed text-slate-700">
            Call it from your own backend. One endpoint, streams the reply back as plain text.
          </p>
          <div className="urlbox mt-3">
            <code>POST {base}/api/chat/{id}</code>
            <Link className="ml-auto whitespace-nowrap text-xs font-extrabold text-accent-600" href={`/bots/${id}`}>
              Details
            </Link>
          </div>
        </div>
      </div>

      {saving && <p className="mt-4 text-[13px] font-semibold text-slate-500">Saving…</p>}
    </>
  );
}

/* ============================ right column: model ============================ */

export function ModelAside({
  cfg,
  anonMode,
  hasKey,
  apiKeyTyped,
  onBooking,
  onBookingInstructions,
  onPublic,
  onLogging,
}: {
  cfg: BotConfig;
  anonMode: boolean;
  hasKey: boolean;
  apiKeyTyped: boolean;
  onBooking: (v: boolean) => void;
  onBookingInstructions: (v: string) => void;
  onPublic: (v: boolean) => void;
  onLogging: (v: boolean) => void;
}) {
  const keyed = hasKey || apiKeyTyped;
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="preview-t">How it will run</span>
      </div>

      <div className="side-card">
        <div className="side-card-top bg-slate-900">
          <span className="side-cav" aria-hidden>
            🔑
          </span>
          <div>
            <div className="text-sm font-extrabold leading-tight">Who pays</div>
            <div className="text-[11.5px] font-medium opacity-85">per message sent</div>
          </div>
        </div>
        <div className="flex flex-col gap-3 bg-slate-50 px-4 py-4 text-[13.5px] font-bold">
          <Row k="Provider" v={getProvider(cfg.provider)?.label ?? cfg.provider} />
          <Row k="Model" v={cfg.model || 'not set'} />
          <Row
            k="Billed to"
            v={anonMode ? `Trial (${ANON_TRIAL_MESSAGES} msgs)` : keyed ? 'Your API key' : 'Forge credits'}
          />
          <p className="m-0 border-t border-slate-200 pt-3 text-[12.5px] font-semibold leading-relaxed text-slate-500">
            Forge never proxies your traffic through a shared key. Messages go straight from the server to the provider
            you picked.
          </p>
        </div>
      </div>

      <div className="side-card">
        <div className="side-card-top grad-warm-bg">
          <span className="side-cav" aria-hidden>
            🛡️
          </span>
          <div>
            <div className="text-sm font-extrabold leading-tight">Guardrails</div>
            <div className="text-[11.5px] font-medium opacity-85">
              {[cfg.isPublic, cfg.citations, cfg.strictGrounding, cfg.bookingEnabled, cfg.logConversations].filter(
                Boolean,
              ).length}{' '}
              on
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 bg-slate-50 px-4 py-4">
          <Check on={cfg.isPublic} onClick={() => onPublic(!cfg.isPublic)} label="Live for visitors" />
          <Check on={cfg.citations} label="Cites its sources" readOnly hint="set in Voice" />
          <Check on={cfg.strictGrounding} label="Answers only from sources" readOnly hint="set in Voice" />
          <Check
            on={cfg.bookingEnabled ?? false}
            onClick={() => onBooking(!(cfg.bookingEnabled ?? false))}
            label="Takes bookings"
          />
          {(cfg.bookingEnabled ?? false) && (
            <input
              className="input mt-1 !py-2 !text-[13px]"
              value={cfg.bookingInstructions ?? ''}
              onChange={(e) => onBookingInstructions(e.target.value)}
              placeholder="30-minute consultation, Mon–Fri 9–5"
              maxLength={500}
            />
          )}
          <Check
            on={cfg.logConversations ?? false}
            onClick={() => onLogging(!(cfg.logConversations ?? false))}
            label="Saves conversations"
          />
          {(cfg.logConversations ?? false) && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              Transcripts appear on the manage screen and delete themselves after{' '}
              {cfg.logRetentionDays ?? 30} days. Tell your visitors — in most places you have to.
            </p>
          )}
        </div>
      </div>

      <p className="preview-foot">Guardrails apply the moment you ship</p>
    </>
  );
}

export function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

export function Check({
  on,
  onClick,
  label,
  readOnly = false,
  hint,
}: {
  on: boolean;
  onClick?: () => void;
  label: string;
  readOnly?: boolean;
  hint?: string;
}) {
  const body = (
    <>
      <span className={on ? 'text-emerald-600' : 'text-slate-400'} aria-hidden>
        {on ? '✓' : '○'}
      </span>
      <span className={on ? 'text-slate-900' : 'text-slate-500'}>{label}</span>
      {hint && <span className="ml-auto text-[11px] font-semibold text-slate-400">{hint}</span>}
    </>
  );
  const className = 'flex items-center gap-2.5 text-[13px] font-bold';
  return readOnly ? (
    <div className={className}>{body}</div>
  ) : (
    <button type="button" onClick={onClick} className={`${className} text-left transition hover:opacity-80`}>
      {body}
    </button>
  );
}
