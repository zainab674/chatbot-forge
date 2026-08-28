/**
 * Provider catalog.
 *
 * Almost every vendor now speaks the OpenAI /chat/completions wire format, so
 * there are only two adapters in this codebase:
 *   - "openai"    → OpenAI-compatible (OpenAI, Groq, Gemini)
 *   - "anthropic" → Anthropic Messages API (different request/stream shape)
 *
 * Adding a new OpenAI-compatible vendor = one entry below, no other changes.
 */

export type Api = 'openai' | 'anthropic';

export interface Provider {
  id: string;
  label: string;
  api: Api;
  baseUrl: string;
  /** Where the creator gets a key. */
  keyUrl: string;
  keyHint: string;
  models: { id: string; label: string; note?: string }[];
  /** `custom` lets the creator type their own base URL. */
  editableBaseUrl?: boolean;
  /** No key needed (e.g. a local Ollama server). */
  keyOptional?: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: 'fast + cheap, good default' },
      { id: 'gpt-4o', label: 'GPT-4o', note: 'strong all-rounder' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'o4-mini', label: 'o4-mini', note: 'reasoning' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', note: 'best balance' },
      { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', note: 'most capable' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'fastest' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    api: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza...',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'fast, very cheap' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'very fast' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
      { id: 'moonshotai/kimi-k2-instruct', label: 'Kimi K2' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    api: 'openai',
    baseUrl: '',
    keyUrl: '',
    keyHint: 'key for your endpoint, if it needs one',
    models: [],
    editableBaseUrl: true,
    keyOptional: true,
  },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Resolve the key to use: the creator's own key first, the platform's key
 * second.
 *
 * Kept pure — the caller fetches the platform key (see lib/platform-keys.ts)
 * and passes it in, rather than this reaching for a database or an environment
 * variable of its own. That is what makes the precedence rule testable in
 * isolation, which matters because getting it backwards would silently bill
 * the platform for traffic a creator should be paying for.
 */
export function resolveKey(
  provider: Provider,
  creatorKey: string | null,
  platformKey: string | null = null,
): string | null {
  if (creatorKey) return creatorKey;
  if (platformKey) return platformKey;
  return null;
}

/**
 * Which endpoint this request is allowed to be sent to.
 *
 * `customBaseUrl` is creator-supplied and only checked for "starts with http",
 * so it is honoured only while the request carries the creator's own key (or no
 * key at all, for a self-hosted endpoint that needs none). A platform-owned key
 * must never travel anywhere but the vendor's documented endpoint: a bot saved
 * with `customBaseUrl: 'https://attacker.example/v1'` and no key of its own
 * would otherwise be handed the platform's key on the first message and post it
 * straight to the attacker in an Authorization header — and since anonymous
 * drafts get trial messages on the platform key, that took no account at all.
 *
 * Returns null when there is nowhere legitimate to send the request, which the
 * caller turns into a message for the creator.
 */
export function resolveBaseUrl(
  provider: Provider,
  customBaseUrl: string | null | undefined,
  opts: { platformKey: boolean },
): string | null {
  if (opts.platformKey) return vendorBaseUrl(provider) || null;
  return customBaseUrl || provider.baseUrl || null;
}

/**
 * Where a vendor's API actually lives.
 *
 * The override exists for the end-to-end suite, which runs a fake provider on
 * localhost and needs to exercise the platform-key path — the one path that
 * refuses a custom endpoint by design. It is gated on CF_FAKE_DB, which
 * already means "this process is pointed at a fake database", so it cannot be
 * switched on in a deployment that has real data behind it.
 */
function vendorBaseUrl(provider: Provider): string {
  if (process.env.CF_FAKE_DB === '1' && process.env.CF_TEST_PROVIDER_BASE_URL) {
    return process.env.CF_TEST_PROVIDER_BASE_URL;
  }
  return provider.baseUrl;
}
