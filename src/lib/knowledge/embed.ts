/**
 * Embeddings.
 *
 * Same trick as the chat adapters: nearly every vendor implements OpenAI's
 * `POST /embeddings`, so one adapter covers the lot. Anthropic has no embedding
 * endpoint, which is why Voyage is in the list — it is what they recommend.
 *
 * A bot can also run with `embeddingProvider: 'none'`, in which case retrieval
 * falls back to keyword scoring. That keeps the knowledge base usable for
 * someone whose only key is for a provider with no embedding API (Groq,
 * OpenRouter, Anthropic) without forcing them to sign up for another service.
 */

export interface EmbeddingProvider {
  id: string;
  label: string;
  baseUrl: string;
  keyUrl: string;
  envKey?: string;
  models: { id: string; label: string; dims: number }[];
  editableBaseUrl?: boolean;
  keyOptional?: boolean;
  /** Chat provider ids that can reuse their key for this embedding provider. */
  sharesKeyWith?: string[];
}

export const EMBEDDING_PROVIDERS: EmbeddingProvider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    envKey: 'OPENAI_API_KEY',
    sharesKeyWith: ['openai'],
    models: [
      { id: 'text-embedding-3-small', label: 'text-embedding-3-small (cheap, good)', dims: 1536 },
      { id: 'text-embedding-3-large', label: 'text-embedding-3-large (best)', dims: 3072 },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    envKey: 'GOOGLE_API_KEY',
    sharesKeyWith: ['google'],
    models: [{ id: 'gemini-embedding-001', label: 'gemini-embedding-001', dims: 3072 }],
  },
  {
    id: 'voyage',
    label: 'Voyage AI (recommended with Claude)',
    baseUrl: 'https://api.voyageai.com/v1',
    keyUrl: 'https://dash.voyageai.com',
    envKey: 'VOYAGE_API_KEY',
    models: [
      { id: 'voyage-3.5-lite', label: 'voyage-3.5-lite (cheap)', dims: 1024 },
      { id: 'voyage-3.5', label: 'voyage-3.5', dims: 1024 },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    models: [{ id: 'embed-v4.0', label: 'embed-v4.0', dims: 1536 }],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    keyUrl: '',
    models: [],
    editableBaseUrl: true,
    keyOptional: true,
    // The same self-hosted endpoint usually answers /chat/completions and
    // /embeddings (Ollama, vLLM, LiteLLM), so one key and base URL cover both.
    sharesKeyWith: ['custom'],
  },
];

export const NO_EMBEDDINGS = 'none';

export function getEmbeddingProvider(id: string): EmbeddingProvider | undefined {
  return EMBEDDING_PROVIDERS.find((p) => p.id === id);
}

/** The obvious embedding choice for a given chat provider, or 'none'. */
export function suggestEmbeddingProvider(chatProviderId: string): string {
  const match = EMBEDDING_PROVIDERS.find((p) => p.sharesKeyWith?.includes(chatProviderId));
  return match?.id ?? NO_EMBEDDINGS;
}

export function defaultEmbeddingModel(providerId: string): string {
  return getEmbeddingProvider(providerId)?.models[0]?.id ?? '';
}

/**
 * Where to send embedding requests for a given bot.
 *
 * For self-hosted and custom providers the creator only configures one base URL
 * on the bot, because in practice the same server answers both /chat/completions
 * and /embeddings (Ollama, vLLM, LiteLLM all do). Hosted providers ignore it.
 */
export function embeddingBaseUrl(
  bot: { customBaseUrl?: string },
  provider: EmbeddingProvider,
): string | undefined {
  if (!provider.editableBaseUrl) return undefined;
  return bot.customBaseUrl || provider.baseUrl || undefined;
}

/**
 * The actual HTTP call lives in ./embed-call, because this module is imported
 * by client components for the provider catalogue and the call needs Node's
 * DNS resolver for its SSRF checks — which webpack cannot put in a browser
 * bundle. Splitting them is what keeps the catalogue importable from the UI.
 */
export class EmbeddingError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface EmbedArgs {
  provider: EmbeddingProvider;
  baseUrl?: string;
  apiKey: string | null;
  model: string;
  input: string[];
  signal?: AbortSignal;
}

/**
 * Unit-normalising once at write time turns every later cosine similarity into
 * a plain dot product, which is the hot path during retrieval.
 */
export function normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const mag = Math.sqrt(sum);
  if (!mag || !Number.isFinite(mag)) return v;
  return v.map((x) => x / mag);
}

/**
 * Dot product of two unit vectors, which equals cosine similarity.
 *
 * Returns 0 on a dimension mismatch rather than comparing the overlapping
 * prefix: after a creator switches embedding model, older chunks have a
 * different width, and scoring them on a truncated prefix would let
 * meaningless numbers compete with real ones. Zero drops them out of the
 * semantic ranking while leaving them findable by keyword.
 */
export function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
