import type { BotConfig } from './types';
import { DEFAULT_CONFIG } from './prompt';
import { getProvider } from './providers';
import { TALKING_STYLES } from './styles';
import { getEmbeddingProvider, NO_EMBEDDINGS } from './knowledge/embed';
import { isChatThemeId } from './themes';

export const LIMITS = {
  name: 60,
  tagline: 120,
  info: 24_000,
  customStyle: 2_000,
  greeting: 400,
  placeholder: 80,
  suggestion: 120,
  model: 200,
  url: 300,
  qaPairs: 50,
  qaQuestion: 300,
  qaAnswer: 2_000,
};

function str(v: unknown, max: number, fallback: unknown = ''): string {
  const safeFallback = typeof fallback === 'string' ? fallback : '';
  // The fallback comes from a stored document, which may hold null for a field
  // that was never set. Returning that would crash the first .trim() call.
  if (typeof v !== 'string') return safeFallback;
  return v.slice(0, max);
}

function list(v: unknown, fallback: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return Array.isArray(fallback) ? fallback : [];
}

function num(v: unknown, min: number, max: number, fallback: number, hardDefault = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  const chosen = Number.isFinite(n) ? n : fallback;
  // The fallback comes from the stored document, which may predate a field.
  // Without this guard an old bot would be saved back with NaN.
  if (!Number.isFinite(chosen)) return hardDefault;
  return Math.min(max, Math.max(min, chosen));
}

export function parseConfig(
  body: any,
  storedBase: BotConfig = DEFAULT_CONFIG,
): { config: BotConfig; error?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { config: storedBase, error: 'Expected a JSON object.' };
  }

  // Documents written before a field existed have no value for it. Layering the
  // stored document over the defaults means an old bot picks up sane values on
  // its next save instead of persisting undefined (which becomes NaN or null).
  const base: BotConfig = { ...DEFAULT_CONFIG, ...storedBase };

  const providerId = str(body.provider, 40, base.provider);
  const provider = getProvider(providerId);
  if (!provider) return { config: base, error: `Unknown provider "${providerId}".` };

  const styleId = str(body.style, 40, base.style);
  if (!TALKING_STYLES.some((s) => s.id === styleId)) {
    return { config: base, error: `Unknown talking style "${styleId}".` };
  }

  const embeddingProviderId = str(body.embeddingProvider, 40, base.embeddingProvider) || NO_EMBEDDINGS;
  if (embeddingProviderId !== NO_EMBEDDINGS && !getEmbeddingProvider(embeddingProviderId)) {
    return { config: base, error: `Unknown embedding provider "${embeddingProviderId}".` };
  }

  const config: BotConfig = {
    name: str(body.name, LIMITS.name, base.name).trim(),
    tagline: str(body.tagline, LIMITS.tagline, base.tagline).trim(),
    info: str(body.info, LIMITS.info, base.info),
    qaPairs: list(body.qaPairs, base.qaPairs)
      .map((p: any) => ({
        q: str(p?.q, LIMITS.qaQuestion).trim(),
        a: str(p?.a, LIMITS.qaAnswer).trim(),
      }))
      .filter((p) => p.q && p.a)
      .slice(0, LIMITS.qaPairs),
    style: styleId,
    customStyle: str(body.customStyle, LIMITS.customStyle, base.customStyle),
    provider: providerId,
    model: str(body.model, LIMITS.model, base.model).trim(),
    customBaseUrl: str(body.customBaseUrl, LIMITS.url, base.customBaseUrl).trim(),
    temperature: num(body.temperature, 0, 2, base.temperature, DEFAULT_CONFIG.temperature),
    maxTokens: Math.round(num(body.maxTokens, 64, 8192, base.maxTokens, DEFAULT_CONFIG.maxTokens)),
    greeting: str(body.greeting, LIMITS.greeting, base.greeting),
    placeholder: str(body.placeholder, LIMITS.placeholder, base.placeholder),
    suggestions: list(body.suggestions, base.suggestions)
      .map((s: unknown) => str(s, LIMITS.suggestion))
      .filter(Boolean)
      .slice(0, 4),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(body.accent)) ? String(body.accent) : base.accent,
    theme: isChatThemeId(body.theme) ? body.theme : base.theme,
    avatarEmoji: str(body.avatarEmoji, 8, base.avatarEmoji) || '🤖',
    allowedOrigins: list(body.allowedOrigins, base.allowedOrigins)
      .map((s: unknown) => str(s, LIMITS.url).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 25),
    memoryTurns: Math.round(num(body.memoryTurns, 0, 50, base.memoryTurns, DEFAULT_CONFIG.memoryTurns)),
    isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : base.isPublic,
    embeddingProvider: embeddingProviderId,
    embeddingModel: str(body.embeddingModel, LIMITS.model, base.embeddingModel).trim(),
    retrievalTopK: Math.round(num(body.retrievalTopK, 0, 20, base.retrievalTopK, DEFAULT_CONFIG.retrievalTopK)),
    citations: typeof body.citations === 'boolean' ? body.citations : base.citations,
    strictGrounding:
      typeof body.strictGrounding === 'boolean' ? body.strictGrounding : base.strictGrounding,
    logConversations:
      typeof body.logConversations === 'boolean' ? body.logConversations : base.logConversations,
    // Bounded either side: zero would mean "keep nothing", which is confusing
    // next to an on/off switch, and unbounded retention is how a transcript
    // store quietly becomes a liability.
    logRetentionDays: Math.round(num(body.logRetentionDays, 1, 365, base.logRetentionDays, 30)),
    bookingEnabled: typeof body.bookingEnabled === 'boolean' ? body.bookingEnabled : base.bookingEnabled,
    bookingInstructions: str(body.bookingInstructions, 500, base.bookingInstructions).trim(),
  };

  if (config.embeddingProvider !== NO_EMBEDDINGS && !config.embeddingModel) {
    return { config, error: 'Pick an embedding model, or set embeddings to "none".' };
  }

  if (!config.name) return { config, error: 'Give your chatbot a name.' };
  if (!config.model) return { config, error: 'Pick or type a model.' };
  if (config.style === 'custom' && !config.customStyle.trim()) {
    return { config, error: 'Describe the custom talking style, or pick a preset.' };
  }
  if (provider.editableBaseUrl && !config.customBaseUrl && !provider.baseUrl) {
    return { config, error: 'This provider needs a base URL (e.g. https://your-host/v1).' };
  }
  if (config.customBaseUrl && !/^https?:\/\//i.test(config.customBaseUrl)) {
    return { config, error: 'Base URL must start with http:// or https://' };
  }

  return { config };
}

function hostMatches(allowed: string[], host: string): boolean {
  return allowed.some((entry) => {
    const clean = entry.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    if (clean.startsWith('*.')) {
      const root = clean.slice(2);
      return host === root || host.endsWith(`.${root}`);
    }
    return host === clean;
  });
}

function sameHost(origin: string | null, selfHost: string | null | undefined): boolean {
  if (!origin || !selfHost) return false;
  try {
    return new URL(origin).hostname.toLowerCase() === selfHost.toLowerCase().replace(/:\d+$/, '');
  } catch {
    return false;
  }
}

/**
 * Which origin the allow-list should actually be applied to.
 *
 * A chat inside the iframe embed is served from this app, so its requests carry
 * *our* Origin, not the customer's site. Checking that would make the allow-list
 * meaningless for the widget, which is the main way bots get embedded. The embed
 * page therefore reports the page that framed it, and that is what gets checked.
 *
 * Best effort by design: the header is only as trustworthy as the browser that
 * sent it, so it stops honest embedding on the wrong domain, not a determined
 * attacker. The per-bot rate limit is what actually caps spend.
 */
export function effectiveOrigin(
  origin: string | null,
  embedOrigin: string | null,
  selfHost: string | null | undefined,
): string | null {
  if (embedOrigin && sameHost(origin, selfHost)) return embedOrigin;
  return origin;
}

/**
 * Origin allow-list check for embedded chats. An empty list allows everything.
 *
 * Fails closed when the list is set but no Origin header arrived. Browsers
 * always send Origin on a POST, so the only callers without one are scripts,
 * and letting those through would make the whole feature advisory: anyone
 * could curl the endpoint and burn the creator's credits. The app's own host
 * is always allowed, so the hosted chat page keeps working.
 */
export function originAllowed(allowed: string[], origin: string | null, selfHost?: string | null): boolean {
  if (!allowed.length) return true;
  if (!origin) return false;

  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Requests from this deployment's own pages are always fine.
  if (selfHost) {
    const self = selfHost.toLowerCase().replace(/:\d+$/, '');
    if (host === self) return true;
  }

  return hostMatches(allowed, host);
}
