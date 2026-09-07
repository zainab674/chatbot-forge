'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PROVIDERS, getProvider } from '@/lib/providers';
import { TALKING_STYLES } from '@/lib/styles';
import { DEFAULT_CONFIG } from '@/lib/prompt';
import { ownerHeaders } from '@/lib/owner';
import { PLATFORM_MODELS, ANON_TRIAL_MESSAGES } from '@/lib/platform';
import KeyRequest from '@/components/KeyRequest';
import { LIMITS } from '@/lib/validate';
import { CHAT_THEMES } from '@/lib/themes';
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
import { SparkStep, ShipStep, ModelAside } from './botform/steps';
import { StepHead, TogglePill, Slider, ErrorToast } from './botform/controls';
import { InfoImport, QAPairEditor, SuggestionEditor } from './botform/editors';

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


/** Provider chips in the Model step: a mark and a colour each. */
const PROVIDER_MARKS: Record<string, { mark: string; bg: string }> = {
  openai: { mark: 'O', bg: '#10A37F' },
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
                              Needs an account. Embedding keys are stored on accounts only.
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
                    🔒 Keys live on accounts. This draft runs on {ANON_TRIAL_MESSAGES} free trial messages.{' '}
                    <Link
                      className="text-accent-600 underline underline-offset-2"
                      href={`/account?next=${mode === 'create' ? '/create' : `/bots/${botId}/edit`}`}
                    >
                      sign up
                    </Link>{' '}
                    to add your own.
                    {!PLATFORM_MODELS.has(cfg.model) && !provider.keyOptional && (
                      <span className="mt-2 block text-amber-800">
                        This model is not covered by trial messages. Pick GPT-OSS on Groq, Gemini Flash or
                        GPT-4o mini to test without a key.
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
                    {/* The third door, for a creator with neither a key nor
                        credits: ask the admin rather than leave the step. */}
                    <KeyRequest provider={provider.id} providerLabel={provider.label} model={cfg.model} />
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
