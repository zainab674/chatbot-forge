'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PROVIDERS, getProvider } from '@/lib/providers';
import { TALKING_STYLES } from '@/lib/styles';
import { DEFAULT_CONFIG } from '@/lib/prompt';
import { ownerHeaders } from '@/lib/owner';
import { PLATFORM_MODELS, ANON_TRIAL_MESSAGES } from '@/lib/platform';
import { SUPPORTED_EXTENSIONS, MAX_UPLOAD_MB } from '@/lib/knowledge/constants';
import { LIMITS } from '@/lib/validate';
import { CHAT_THEMES, getChatTheme } from '@/lib/themes';
import ChatScene from './ChatScene';
import {
  EMBEDDING_PROVIDERS,
  getEmbeddingProvider,
  suggestEmbeddingProvider,
  defaultEmbeddingModel,
  NO_EMBEDDINGS,
} from '@/lib/knowledge/embed';
import ChatWindow from './ChatWindow';
import type { BotConfig, PublicBot } from '@/lib/types';

/**
 * Documents, crawling and retrieval settings are hidden for now. The prompt
 * editor (which takes a document import) and pinned answers cover the builder
 * meanwhile. Flip this to true to bring the retrieval panel back — nothing else
 * changes, and a bot saved while it was hidden keeps the settings it had.
 */
const ADVANCED_KNOWLEDGE_UNLOCKED = false;

type StepId = 'spark' | 'identity' | 'brain' | 'voice' | 'model' | 'ship';

interface Step {
  id: StepId;
  label: string;
}

const ALL_STEPS: Step[] = [
  { id: 'spark', label: 'Spark' },
  { id: 'identity', label: 'Identity' },
  { id: 'brain', label: 'Brain' },
  { id: 'voice', label: 'Voice' },
  { id: 'model', label: 'Model' },
  { id: 'ship', label: 'Ship' },
];

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

/** Provider chips in the Model step: a mark and a colour each. */
const PROVIDER_MARKS: Record<string, { mark: string; bg: string }> = {
  openai: { mark: 'O', bg: '#10A37F' },
  anthropic: { mark: 'A', bg: '#B96143' },
  google: { mark: 'G', bg: '#587A86' },
  gemini: { mark: 'G', bg: '#587A86' },
  groq: { mark: 'Gq', bg: '#BF9134' },
  openrouter: { mark: 'OR', bg: '#7E5C2D' },
  mistral: { mark: 'M', bg: '#CC7E5F' },
  together: { mark: 'T', bg: '#6E875A' },
  custom: { mark: '⚙', bg: '#615E54' },
};
const providerMark = (id: string) => PROVIDER_MARKS[id] ?? { mark: id.slice(0, 2).toUpperCase(), bg: '#807B70' };

/** Only has to be unique within the session, so a counter beats a timestamp. */
let nextToastId = 1;

const ACCENTS = ['#2A302C', '#7E5C2D', '#C79A55', '#B96143', '#BF9134', '#6E875A', '#587A86'];
const EMOJIS = ['🤖', '💬', '✨', '🧠', '🎧', '🛟', '📚', '🩺', '🛒', '⚖️', '🏠', '🍜'];

interface Props {
  mode: 'create' | 'edit';
  botId?: string;
  initial?: BotConfig;
  hasKey?: boolean;
  existingMask?: string;
  hasEmbeddingKey?: boolean;
  embeddingMask?: string;
  /** Visitor has no account: drafts allowed, API keys are not. */
  anonMode?: boolean;
}

export default function BotForm({
  mode,
  botId,
  initial,
  hasKey = false,
  existingMask = '',
  hasEmbeddingKey = false,
  embeddingMask = '',
  anonMode = false,
}: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<BotConfig>(initial ?? DEFAULT_CONFIG);
  const [apiKey, setApiKey] = useState('');
  const [embeddingKey, setEmbeddingKey] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(() => {
    const p = getProvider((initial ?? DEFAULT_CONFIG).provider);
    const m = (initial ?? DEFAULT_CONFIG).model;
    return Boolean(p && p.models.length > 0 && !p.models.some((x) => x.id === m));
  });
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(mode === 'edit');
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  // A fresh id on every call so the same message twice still re-announces and
  // restarts the auto-dismiss countdown.
  const showError = useCallback((message: string) => setToast({ id: nextToastId++, message }), []);
  const dismissError = useCallback(() => setToast(null), []);
  const [describe, setDescribe] = useState('');
  const [generating, setGenerating] = useState(false);

  /** The bot's real id: known from the start when editing, after the save when creating. */
  const [liveId, setLiveId] = useState<string | undefined>(botId);

  // Spark only makes sense while creating; editing drops straight into Identity.
  const steps = useMemo(() => (mode === 'create' ? ALL_STEPS : ALL_STEPS.filter((s) => s.id !== 'spark')), [mode]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const frameRef = useRef<HTMLDivElement>(null);

  const provider = useMemo(() => getProvider(cfg.provider)!, [cfg.provider]);
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const embeddingProvider = useMemo(
    () => (cfg.embeddingProvider === NO_EMBEDDINGS ? undefined : getEmbeddingProvider(cfg.embeddingProvider)),
    [cfg.embeddingProvider],
  );

  /** True when the embedding vendor is the same as the chat vendor, so one key covers both. */
  const embeddingSharesKey = Boolean(embeddingProvider?.sharesKeyWith?.includes(cfg.provider));

  function onProviderChange(id: string) {
    const p = getProvider(id)!;
    setCfg((c) => {
      // Only re-suggest embeddings if the creator has not picked one deliberately.
      const shouldFollow = c.embeddingProvider === suggestEmbeddingProvider(c.provider) || !c.embeddingProvider;
      const nextEmbedding = shouldFollow ? suggestEmbeddingProvider(id) : c.embeddingProvider;
      return {
        ...c,
        provider: id,
        model: p.models[0]?.id ?? '',
        customBaseUrl: p.editableBaseUrl ? p.baseUrl : '',
        embeddingProvider: nextEmbedding,
        embeddingModel: shouldFollow ? defaultEmbeddingModel(nextEmbedding) : c.embeddingModel,
      };
    });
    setUseCustomModel(p.models.length === 0);
  }

  function onEmbeddingProviderChange(id: string) {
    setCfg((c) => ({ ...c, embeddingProvider: id, embeddingModel: defaultEmbeddingModel(id) }));
  }

  const preview: PublicBot = {
    id: liveId ?? 'preview',
    name: cfg.name || 'Your chatbot',
    tagline: cfg.tagline,
    greeting: cfg.greeting,
    placeholder: cfg.placeholder,
    suggestions: cfg.suggestions,
    accent: cfg.accent,
    theme: cfg.theme,
    avatarEmoji: cfg.avatarEmoji,
    model: cfg.model,
    provider: cfg.provider,
    citations: cfg.citations,
    bookingEnabled: cfg.bookingEnabled ?? false,
    bookingInstructions: cfg.bookingInstructions ?? '',
  };

  async function generate() {
    setGenerating(true);
    setToast(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: describe,
          provider: cfg.provider,
          model: cfg.model,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Generation failed.');
      setCfg((c) => ({ ...c, ...json.config }));
      goTo(stepIndex + 1);
    } catch (e: any) {
      showError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Creates the bot on the first call and patches it afterwards, so pressing
   * "Ship" twice does not leave two chatbots behind.
   */
  async function save(): Promise<string | undefined> {
    setSaving(true);
    setToast(null);
    try {
      const payload: any = { ...cfg };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (embeddingKey.trim()) payload.embeddingKey = embeddingKey.trim();

      const res = await fetch(liveId ? `/api/bots/${liveId}` : '/api/bots', {
        method: liveId ? 'PATCH' : 'POST',
        headers: ownerHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Could not save.');
      const id: string = liveId ?? json.bot.id;
      setLiveId(id);
      setSavedOnce(true);
      router.refresh();
      return id;
    } catch (e: any) {
      showError(e.message);
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  function goTo(index: number) {
    const next = Math.max(0, Math.min(steps.length - 1, index));
    setStepIndex(next);
    // Long steps otherwise leave you halfway down the previous one.
    frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Cancelling out of step one. This used to be router.back(), which walks the
   * visitor off the site entirely whenever /create was the entry point — a
   * shared link, a bookmark, an ad. Editing goes back to the bot; creating
   * goes to the dashboard.
   */
  function cancel() {
    router.push(mode === 'edit' && botId ? `/bots/${botId}` : '/bots');
  }

  /** Advancing off the Model step is what actually writes the bot. */
  async function next() {
    if (step.id === 'identity' && !cfg.name.trim()) {
      showError('Give the chatbot a name before moving on.');
      return;
    }
    if (step.id === 'model') {
      const id = await save();
      if (!id) return;
    }
    goTo(stepIndex + 1);
  }

  const stepNumberOf = (id: StepId) => steps.findIndex((s) => s.id === id) + 1;

  return (
    <div ref={frameRef} className="app-frame scroll-mt-20">
      {/* ---------------- step rail ---------------- */}
      <nav className="rail thin-scroll" aria-label="Builder steps">
        {steps.map((s, i) => {
          const state = i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : '';
          return (
            <div key={s.id} className="flex flex-none items-center" style={{ flex: i === steps.length - 1 ? '0 0 auto' : '1 1 auto' }}>
              <button
                type="button"
                onClick={() => (i < stepIndex || savedOnce ? goTo(i) : undefined)}
                disabled={i > stepIndex && !savedOnce}
                aria-current={i === stepIndex ? 'step' : undefined}
                className={`rail-step ${state} ${i < stepIndex || savedOnce ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className="rail-bub">{i < stepIndex ? '✓' : i + 1}</span>
                <span className="rail-lbl hidden sm:block">{s.label}</span>
              </button>
              {i < steps.length - 1 && <span className={`rail-connect ${i < stepIndex ? 'is-filled' : ''}`} />}
            </div>
          );
        })}
      </nav>

      {/* ---------------- stage ---------------- */}
      <div className={`stage ${step.id === 'spark' ? 'stage-solo' : ''}`}>
        <div key={step.id} className="panel animate-step-in">
          {step.id === 'spark' && (
            <SparkStep
              describe={describe}
              setDescribe={setDescribe}
              generating={generating}
              onGenerate={generate}
              onSkip={() => goTo(stepIndex + 1)}
            />
          )}

          {step.id === 'identity' && (
            <>
              <StepHead
                n={stepNumberOf('identity')}
                total={steps.length}
                title="Give it a face."
                sub="This is what visitors see in the header of the chat window. Nothing here changes what the bot knows."
              />

              <div className="grid gap-[18px] sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="cf-name">
                    Name
                  </label>
                  <input
                    id="cf-name"
                    className="input"
                    value={cfg.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="Wax Assistant"
                    maxLength={60}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="cf-tagline">
                    Tagline <span className="field-hint">optional</span>
                  </label>
                  <input
                    id="cf-tagline"
                    className="input"
                    value={cfg.tagline}
                    onChange={(e) => set('tagline', e.target.value)}
                    placeholder="Answers about orders and shipping"
                    maxLength={120}
                  />
                </div>
              </div>

              <div className="mt-6">
                <span className="field-label">Avatar</span>
                <div className="flex flex-wrap gap-2.5">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => set('avatarEmoji', e)}
                      aria-pressed={cfg.avatarEmoji === e}
                      className={`av ${cfg.avatarEmoji === e ? 'av-on' : ''}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                <span className="field-label">Accent colour</span>
                <div className="flex flex-wrap gap-2.5">
                  {ACCENTS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set('accent', c)}
                      aria-label={c}
                      aria-pressed={cfg.accent === c}
                      className={`sw ${cfg.accent === c ? 'sw-on' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <label
                    className="grid h-9 w-9 cursor-pointer place-items-center rounded-control border-2 border-slate-200 bg-white text-[15px]"
                    title="Pick any colour"
                  >
                    🎨
                    <input
                      type="color"
                      className="sr-only"
                      value={cfg.accent}
                      onChange={(e) => set('accent', e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <span className="field-label">Chat theme</span>
                <div className="grid gap-3 sm:grid-cols-3">
                  {CHAT_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set('theme', t.id)}
                      aria-pressed={cfg.theme === t.id}
                      className={`tile !p-3.5 ${cfg.theme === t.id ? 'tile-on' : ''}`}
                    >
                      <span
                        className="tile-ic relative overflow-hidden ring-1 ring-slate-900/10"
                        style={{ backgroundImage: t.swatch }}
                        aria-hidden
                      >
                        {/* The animated themes preview themselves in the swatch,
                            so the label is not the only thing selling them. */}
                        <ChatScene theme={t} mini />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-extrabold tracking-tight">
                          {t.label}
                          {t.motion && (
                            <span className="ml-1.5 align-[2px] border border-accent-400 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-700">
                              Animated
                            </span>
                          )}
                        </span>
                        <span className="block text-[12.5px] leading-snug text-slate-500">{t.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step.id === 'brain' && (
            <>
              <StepHead
                n={stepNumberOf('brain')}
                total={steps.length}
                title="What does it know?"
                sub="Everything here is its source of truth. Edit it directly, or drop in a document and let it read."
              />

              <div className="editor">
                <div className="editor-top">
                  <span className="editor-tag">System prompt</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {cfg.info.length.toLocaleString()} / {LIMITS.info.toLocaleString()}
                  </span>
                </div>
                <textarea
                  className="editor-area thin-scroll"
                  value={cfg.info}
                  onChange={(e) => set('info', e.target.value)}
                  spellCheck={false}
                  placeholder={`# Who you are
You are the support assistant for Wick & Wax, a candle shop.

# Facts
shipping:   1 to 3 business days
free over:  $50
returns:    30 days, unused items

# Rules
- Never promise a refund. Billing goes to a human.
- Two sentences max unless they ask for detail.`}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="meter-track">
                  <span
                    className="meter-fill block"
                    style={{ width: `${Math.min(100, (cfg.info.length / LIMITS.info) * 100)}%` }}
                  />
                </span>
                <span className="meter-n">{cfg.info.length.toLocaleString()} chars</span>
              </div>

              <div className="mt-[18px]">
                <InfoImport
                  onError={showError}
                  onText={(text, name) =>
                    setCfg((c) => {
                      const separator = c.info.trim() ? `\n\n--- ${name} ---\n` : '';
                      return { ...c, info: (c.info.trimEnd() + separator + text).slice(0, LIMITS.info) };
                    })
                  }
                />
              </div>

              <div className="mt-7">
                <span className="field-label">
                  Pinned answers <span className="field-hint">exact wording for the questions you get most</span>
                </span>
                <QAPairEditor value={cfg.qaPairs ?? []} onChange={(v) => set('qaPairs', v)} />
              </div>

              {ADVANCED_KNOWLEDGE_UNLOCKED && (
                <details className="group mt-7 overflow-hidden rounded-panel border-2 border-slate-200 bg-white">
                  <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3.5 text-[14.5px] font-extrabold">
                    Advanced: documents, websites &amp; retrieval
                    <span className="text-slate-400 transition group-open:rotate-180" aria-hidden>
                      ⌄
                    </span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="field-label" htmlFor="cf-embedding-provider">
                          Embeddings
                        </label>
                        <select
                          id="cf-embedding-provider"
                          className="input"
                          value={cfg.embeddingProvider}
                          onChange={(e) => onEmbeddingProviderChange(e.target.value)}
                        >
                          <option value={NO_EMBEDDINGS}>None, keyword search only</option>
                          {EMBEDDING_PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                        <p className="hint">Finds answers worded differently. Without it, keyword scoring only.</p>
                      </div>

                      {embeddingProvider && (
                        <div>
                          <label className="field-label" htmlFor="cf-embedding-model">
                            Embedding model
                          </label>
                          {embeddingProvider.models.length ? (
                            <select
                              id="cf-embedding-model"
                              className="input"
                              value={cfg.embeddingModel}
                              onChange={(e) => set('embeddingModel', e.target.value)}
                            >
                              {embeddingProvider.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="input input-mono"
                              value={cfg.embeddingModel}
                              onChange={(e) => set('embeddingModel', e.target.value)}
                              placeholder="embedding model id"
                            />
                          )}

                          <label className="field-label mt-4">
                            Embedding API key{' '}
                            {embeddingSharesKey && <span className="field-hint">reuses the chat key</span>}
                          </label>
                          {anonMode ? (
                            <p className="rounded-control border-2 border-slate-200 bg-slate-50 px-3.5 py-3 text-[12.5px] text-slate-500">
                              Needs an account — embedding keys are stored on accounts only.
                            </p>
                          ) : (
                            <input
                              className="input input-mono"
                              type="password"
                              value={embeddingKey}
                              onChange={(e) => setEmbeddingKey(e.target.value)}
                              placeholder={
                                hasEmbeddingKey
                                  ? `saved · ${embeddingMask}`
                                  : embeddingSharesKey
                                    ? 'same vendor, leave blank'
                                    : 'key for this embedding provider'
                              }
                              autoComplete="off"
                            />
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <Slider
                        label="Chunks retrieved"
                        value={cfg.retrievalTopK}
                        min={0}
                        max={12}
                        step={1}
                        onChange={(v) => set('retrievalTopK', v)}
                        left={cfg.retrievalTopK === 0 ? 'Retrieval off' : 'Fewer'}
                        right="More"
                      />
                    </div>
                  </div>
                </details>
              )}
            </>
          )}

          {step.id === 'voice' && (
            <>
              <StepHead
                n={stepNumberOf('voice')}
                total={steps.length}
                title="How should it talk?"
                sub="Tap one and the preview rewrites itself in that voice. Then set the first thing visitors ever see."
              />

              <div className="grid gap-3 sm:grid-cols-2">
                {TALKING_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => set('style', s.id)}
                    aria-pressed={cfg.style === s.id}
                    className={`tile ${cfg.style === s.id ? 'tile-on' : ''}`}
                  >
                    <span className="tile-ic">{s.emoji}</span>
                    <span className="min-w-0">
                      <span className="block text-[14.5px] font-extrabold tracking-tight">{s.label}</span>
                      <span className="block text-[12.5px] leading-snug text-slate-500">{s.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>

              {cfg.style === 'custom' && (
                <textarea
                  className="input mt-4 min-h-[96px]"
                  value={cfg.customStyle}
                  onChange={(e) => set('customStyle', e.target.value)}
                  placeholder="Describe the voice: “Blunt and dry. Short sentences. Never apologises twice.”"
                />
              )}

              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <div>
                  <span className="field-label">Answer length</span>
                  <Slider
                    value={cfg.maxTokens}
                    min={256}
                    max={4096}
                    step={128}
                    onChange={(v) => set('maxTokens', v)}
                    left="Terse"
                    right="Chatty"
                    caption={`about ${Math.round((cfg.maxTokens * 3) / 4)} words`}
                  />
                </div>
                <div>
                  <span className="field-label">Extras</span>
                  <div className="flex flex-wrap gap-2.5">
                    <TogglePill
                      on={cfg.citations}
                      onClick={() => set('citations', !cfg.citations)}
                      label="Cites sources"
                    />
                    <TogglePill
                      on={cfg.strictGrounding}
                      onClick={() => set('strictGrounding', !cfg.strictGrounding)}
                      label="Answers only from sources"
                    />
                  </div>
                  <p className="hint">
                    {cfg.strictGrounding
                      ? 'It refuses rather than falling back on general knowledge.'
                      : 'It may fall back on general knowledge when your notes do not cover something.'}
                  </p>
                </div>
              </div>

              <div className="mt-7 grid gap-[18px] sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="cf-greeting">
                    First message
                  </label>
                  <textarea
                    id="cf-greeting"
                    className="input min-h-[92px]"
                    value={cfg.greeting}
                    onChange={(e) => set('greeting', e.target.value)}
                    maxLength={400}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="cf-placeholder">
                    Input placeholder
                  </label>
                  <input
                    id="cf-placeholder"
                    className="input"
                    value={cfg.placeholder}
                    onChange={(e) => set('placeholder', e.target.value)}
                    maxLength={80}
                  />
                  <span className="field-label mt-4 block">
                    Starter questions <span className="field-hint">up to 4</span>
                  </span>
                  <SuggestionEditor value={cfg.suggestions} onChange={(v) => set('suggestions', v)} />
                </div>
              </div>
            </>
          )}

          {step.id === 'model' && (
            <>
              <StepHead
                n={stepNumberOf('model')}
                total={steps.length}
                title="Which brain runs it?"
                sub="Your key, your bill, your choice of provider. Forge stores the key encrypted and only uses it server-side."
              />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {PROVIDERS.map((p) => {
                  const m = providerMark(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onProviderChange(p.id)}
                      aria-pressed={cfg.provider === p.id}
                      className={`prov ${cfg.provider === p.id ? 'prov-on' : ''}`}
                    >
                      <span className="prov-lg" style={{ background: m.bg }} aria-hidden>
                        {m.mark}
                      </span>
                      <span className="block text-[12.5px] font-extrabold tracking-tight">{p.label}</span>
                      <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                        {p.models.length ? `${p.models.length} models` : 'any model id'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 grid gap-[18px] sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="cf-model">
                    Model
                  </label>
                  {provider.models.length > 0 && !useCustomModel ? (
                    <select
                      id="cf-model"
                      className="input"
                      value={cfg.model}
                      onChange={(e) => set('model', e.target.value)}
                    >
                      {provider.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.note ? ` · ${m.note}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input input-mono"
                      value={cfg.model}
                      onChange={(e) => set('model', e.target.value)}
                      placeholder="exact model id from the provider"
                    />
                  )}
                  {provider.models.length > 0 && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-bold text-slate-500 underline underline-offset-2 hover:text-accent-600"
                      onClick={() => setUseCustomModel((v) => !v)}
                    >
                      {useCustomModel ? 'Choose from the list' : 'Type a model id instead'}
                    </button>
                  )}
                </div>

                {provider.editableBaseUrl ? (
                  <div>
                    <label className="field-label" htmlFor="cf-base">
                      Base URL
                    </label>
                    <input
                      id="cf-base"
                      className="input input-mono"
                      value={cfg.customBaseUrl}
                      onChange={(e) => set('customBaseUrl', e.target.value)}
                      placeholder="https://your-endpoint.com/v1"
                    />
                    <p className="hint">
                      Any endpoint that implements <code>POST /chat/completions</code>.
                    </p>
                  </div>
                ) : (
                  <div>
                    <span className="field-label">Memory</span>
                    <Slider
                      value={cfg.memoryTurns}
                      min={0}
                      max={30}
                      step={1}
                      onChange={(v) => set('memoryTurns', v)}
                      left="Goldfish"
                      right="30 turns"
                      caption={cfg.memoryTurns === 0 ? 'no memory' : `${cfg.memoryTurns} messages`}
                    />
                  </div>
                )}
              </div>

              <div className="mt-6">
                <span className="field-label">
                  API key{' '}
                  <span className="field-hint">
                    {provider.keyOptional ? 'optional for this provider' : 'encrypted, never shown again'}
                  </span>
                </span>
                {anonMode ? (
                  <div className="rounded-control border-2 border-accent-200 bg-accent-50 px-4 py-3.5 text-[13px] font-semibold leading-relaxed text-slate-700">
                    🔒 Keys live on accounts. This draft runs on {ANON_TRIAL_MESSAGES} free trial messages —{' '}
                    <Link
                      className="text-accent-600 underline underline-offset-2"
                      href={`/account?next=${mode === 'create' ? '/create' : `/bots/${botId}/edit`}`}
                    >
                      sign up
                    </Link>{' '}
                    to add your own.
                    {!PLATFORM_MODELS.has(cfg.model) && !provider.keyOptional && (
                      <span className="mt-2 block text-amber-800">
                        This model is not covered by trial messages. Pick GPT-4o mini, Gemini Flash, Claude Haiku or
                        Llama on Groq to test without a key.
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <input
                        className="input input-mono min-w-[240px] flex-1"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={hasKey ? `saved · ${existingMask}` : provider.keyHint}
                        autoComplete="off"
                      />
                      {hasKey && !apiKey && <span className="okpill">✓ Key saved</span>}
                    </div>
                    <p className="hint">
                      Leave blank to run on{' '}
                      <Link className="underline underline-offset-2" href="/account">
                        Forge credits
                      </Link>{' '}
                      instead.
                      {provider.keyUrl && (
                        <>
                          {' · '}
                          <a
                            className="underline underline-offset-2"
                            href={provider.keyUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Get a {provider.label} key ↗
                          </a>
                        </>
                      )}
                    </p>
                  </>
                )}
              </div>

              <div className="mt-6">
                <span className="field-label">Creativity</span>
                <Slider
                  value={cfg.temperature}
                  min={0}
                  max={2}
                  step={0.1}
                  onChange={(v) => set('temperature', v)}
                  left="Sticks to the facts"
                  right="Improvises"
                  caption={cfg.temperature.toFixed(1)}
                />
              </div>

              <div className="note-strip">
                <span className="text-base" aria-hidden>
                  💡
                </span>
                <p>
                  Support bots do best on the left. Anything that has to quote your policy word for word should sit
                  near &ldquo;sticks to the facts&rdquo;.
                </p>
              </div>

              <div className="mt-6">
                <label className="field-label" htmlFor="cf-origins">
                  Allowed domains <span className="field-hint">optional</span>
                </label>
                <input
                  id="cf-origins"
                  className="input input-mono"
                  value={cfg.allowedOrigins.join(', ')}
                  onChange={(e) =>
                    set(
                      'allowedOrigins',
                      e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="acme.com, *.acme.com"
                />
                <p className="hint">
                  Empty means anywhere. Wildcards like <code>*.acme.com</code> work.
                </p>
              </div>
            </>
          )}

          {step.id === 'ship' && (
            <ShipStep
              id={liveId}
              cfg={cfg}
              anonMode={anonMode}
              onToggleLive={(v) => set('isPublic', v)}
              onSave={save}
              saving={saving}
            />
          )}
        </div>

        {/* ---------------- right column ---------------- */}
        {step.id !== 'spark' && (
          <aside className="preview tone-ink">
            {step.id === 'model' ? (
              <ModelAside
                cfg={cfg}
                anonMode={anonMode}
                hasKey={hasKey}
                apiKeyTyped={Boolean(apiKey.trim())}
                onBooking={(v) => set('bookingEnabled', v)}
                onBookingInstructions={(v) => set('bookingInstructions', v)}
                onPublic={(v) => set('isPublic', v)}
                onLogging={(v) => set('logConversations', v)}
              />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="preview-t">{step.id === 'voice' ? 'Voice sample' : 'Live preview'}</span>
                  <span className="seg">
                    <b className="on">{liveId ? 'Live' : 'Draft'}</b>
                  </span>
                </div>
                <div className="chatwin min-h-[440px] flex-1">
                  <ChatWindow key={`${cfg.theme}-${cfg.accent}`} bot={preview} fill demo={!liveId} />
                </div>
                <p className="preview-foot">
                  {liveId ? 'Real bot, real key, live now' : 'Updates as you type'}
                </p>
              </>
            )}
          </aside>
        )}
      </div>

      {/* ---------------- footer nav ---------------- */}
      <footer className="footbar">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => (stepIndex === 0 ? cancel() : goTo(stepIndex - 1))}
          disabled={saving}
        >
          ← {stepIndex === 0 ? 'Cancel' : 'Back'}
        </button>

        <div className="dots" aria-hidden>
          {steps.map((s, i) => (
            <i key={s.id} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : ''} />
          ))}
        </div>

        {step.id === 'ship' ? (
          <Link className="btn-warm" href={liveId ? `/bots/${liveId}` : '/bots'}>
            {liveId ? 'Open this bot →' : 'Open dashboard →'}
          </Link>
        ) : (
          <button type="button" className="btn-primary" onClick={next} disabled={saving || generating}>
            {saving
              ? 'Saving…'
              : step.id === 'model'
                ? mode === 'create'
                  ? 'Create & ship →'
                  : 'Save & ship →'
                : `Next: ${steps[stepIndex + 1]?.label ?? 'Ship'} →`}
          </button>
        )}
      </footer>

      <ErrorToast toast={toast} onClose={dismissError} />
    </div>
  );
}

/* ============================ step 1: spark ============================ */

function SparkStep({
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

function ShipStep({
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

function ModelAside({
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="truncate text-right">{v}</span>
    </div>
  );
}

function Check({
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

/* ============================ shared bits ============================ */

function StepHead({ n, total, title, sub }: { n: number; total: number; title: string; sub: string }) {
  return (
    <div className="mb-7">
      <p className="eyebrow">
        <span className="eyebrow-bar" />
        Step {n} of {total}
      </p>
      <h2 className="h-step">{title}</h2>
      <p className="sub-step">{sub}</p>
    </div>
  );
}

function TogglePill({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`pill ${on ? 'pill-on' : ''}`}>
      <span aria-hidden>{on ? '✓' : '＋'}</span>
      {label}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  left,
  right,
  caption,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  left: string;
  right: string;
  caption?: string;
}) {
  // The filled part of the track is painted by a gradient stop, so the input
  // has to know how far along it is.
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div>
      {label && <span className="field-label">{label}</span>}
      <input
        type="range"
        className="slider"
        style={{ ['--pct' as any]: `${pct}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      <div className="slider-ends">
        <span>{left}</span>
        {caption && <span className="font-mono text-slate-700">{caption}</span>}
        <span>{right}</span>
      </div>
    </div>
  );
}

/**
 * Pulls the text out of a document straight into the prompt.
 *
 * Parsed server-side by /api/extract and dropped into the editor as ordinary
 * editable text: no storage, no embeddings, no model, and it works before the
 * chatbot exists.
 */
function InfoImport({
  onText,
  onError,
}: {
  onText: (text: string, name: string) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; note: string } | null>(null);
  const [over, setOver] = useState(false);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setBusy(file.name);
      try {
        const form = new FormData();
        form.append('file', file);
        // No Content-Type header: the browser sets the multipart boundary.
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Could not read that file.');
        onText(json.text, json.title || file.name);
        setDone({
          name: file.name,
          note:
            `${json.chars.toLocaleString()} characters` +
            (json.truncated ? `, trimmed to the ${LIMITS.info.toLocaleString()} limit` : ''),
        });
      } catch (e: any) {
        onError(`${file.name}: ${e.message}`);
        break;
      }
    }
    setBusy(null);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) importFiles(e.dataTransfer.files);
        }}
        className={`drop ${over ? 'drop-over' : ''} ${busy ? 'opacity-60' : ''}`}
      >
        <span className="drop-ic" aria-hidden>
          {busy ? '⏳' : '📄'}
        </span>
        <div className="min-w-0">
          <h4 className="m-0 text-[14.5px] font-extrabold tracking-tight">
            {busy ? `Reading ${busy}…` : 'Feed it a document'}
          </h4>
          <p className="m-0 text-[12.5px] text-slate-500">
            {SUPPORTED_EXTENSIONS.join(', ')} · up to {MAX_UPLOAD_MB} MB
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost ml-auto !px-4 !py-2.5 !text-[13px]"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={Boolean(busy)}
        >
          Browse
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SUPPORTED_EXTENSIONS.join(',')}
          className="sr-only"
          onChange={(e) => {
            importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {done && (
        <div className="filerow">
          <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-sky-100 text-sm" aria-hidden>
            📄
          </span>
          <span className="min-w-0 truncate text-[13.5px] font-bold">{done.name}</span>
          <span className="ml-auto whitespace-nowrap text-xs font-semibold text-slate-500">read, {done.note}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Errors surface here rather than as a banner in the page, because a failed
 * save is often triggered from the footer with the offending field scrolled out
 * of view. Announces itself, and clears after a few seconds.
 */
function ErrorToast({ toast, onClose }: { toast: { id: number; message: string } | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
    // toast.id changes on every new error, which restarts the countdown even
    // when the same message comes back twice.
  }, [toast?.id, onClose]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
      <div
        role="alert"
        aria-live="assertive"
        className="animate-fade-down pointer-events-auto flex max-w-md items-start gap-3 rounded-panel border-2 border-red-200 bg-white px-4 py-3.5"
        style={{ boxShadow: '0 24px 60px -28px rgba(41,15,80,.5)' }}
      >
        <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-red-50 text-xs font-black text-red-600">
          !
        </span>
        <p className="m-0 min-w-0 text-sm font-semibold text-red-700">{toast.message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 flex-none rounded-control px-1.5 text-lg leading-none text-slate-400 transition hover:text-slate-700"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function QAPairEditor({
  value,
  onChange,
}: {
  value: { q: string; a: string }[];
  onChange: (v: { q: string; a: string }[]) => void;
}) {
  const update = (i: number, field: 'q' | 'a', text: string) =>
    onChange(value.map((p, idx) => (idx === i ? { ...p, [field]: text } : p)));

  return (
    <div>
      {value.map((p, i) => (
        <div key={i} className="qa">
          <div className="flex items-center gap-2">
            <span className="qa-tag">Q</span>
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] font-bold outline-none placeholder:font-medium placeholder:text-slate-400"
              value={p.q}
              onChange={(e) => update(i, 'q', e.target.value)}
              placeholder="Do you ship to Canada?"
              maxLength={300}
            />
            <button
              type="button"
              className="flex-none rounded-control px-2 py-1 text-xs font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              aria-label={`Remove pinned answer ${i + 1}`}
            >
              Remove
            </button>
          </div>
          <textarea
            className="mt-1.5 block w-full resize-y border-0 bg-transparent pl-[34px] text-[13px] leading-relaxed text-slate-700 outline-none placeholder:text-slate-400"
            value={p.a}
            onChange={(e) => update(i, 'a', e.target.value)}
            placeholder="Yes. Canada is $12 flat and takes 5 to 8 business days."
            maxLength={2000}
            rows={2}
          />
        </div>
      ))}
      {value.length < 50 && (
        <button type="button" className="addrow" onClick={() => onChange([...value, { q: '', a: '' }])}>
          + Add a pinned answer
        </button>
      )}
      <p className="hint">Shown to the model word for word — no indexing, no retrieval involved.</p>
    </div>
  );
}

function SuggestionEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (draft.trim() && value.length < 4) {
      onChange([...value, draft.trim()]);
      setDraft('');
    }
  };
  return (
    <div>
      <div className="flex gap-2.5">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Track my order"
          disabled={value.length >= 4}
        />
        <button type="button" className="btn-ghost flex-none !px-4" disabled={!draft.trim() || value.length >= 4} onClick={add}>
          Add
        </button>
      </div>
      {value.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {value.map((s, i) => (
            <button
              key={`${s}-${i}`}
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="inline-flex items-center gap-1.5 rounded-control border border-slate-300 bg-white px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-wide text-slate-700 transition hover:border-red-600 hover:text-red-700"
            >
              {s} <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
