/**
 * Unit + integration tests that need no database.
 *
 *   npm test
 *
 * Covers the parts where a bug would be silent: key encryption, prompt
 * assembly, config validation, the domain allow-list, and both streaming
 * adapters (run against a local fake provider, so no API keys are used).
 */
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { encrypt, decrypt, maskKey, newId } from '../src/lib/crypto';
import { buildSystemPrompt, DEFAULT_CONFIG } from '../src/lib/prompt';
import { parseConfig, originAllowed, effectiveOrigin } from '../src/lib/validate';
import { PROVIDERS, getProvider, resolveKey, resolveBaseUrl } from '../src/lib/providers';
import { isPrivateIp, assertPublicUrl, assertReachableEndpoint } from '../src/lib/net-guard';
import { TALKING_STYLES } from '../src/lib/styles';
import { streamChat, UpstreamError } from '../src/lib/llm';
import { readableOn, contrastRatio, accessibleSurface } from '../src/lib/contrast';
import { rateLimit, consume, clientKey, resetRateLimits, PER_AUTH } from '../src/lib/ratelimit';
import type { LimitResult } from '../src/lib/ratelimit';
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  verifySession,
  sessionRevoked,
  isAdminEmail,
  isAdmin,
} from '../src/lib/auth';
import { issueToken, consumeToken, hashToken, revokeSessions } from '../src/lib/reset';
import {
  PLATFORM_MODELS,
  creditsFor,
  fitToPlatformBudget,
  reserveCredits,
  refundCredits,
  grantCredits,
  trialGrant,
  TRIAL_PER_IP,
  PLATFORM_MAX_PROMPT_CHARS,
  PLATFORM_MAX_OUTPUT_TOKENS,
  PLATFORM_MAX_SYSTEM_CHARS,
  TOKENS_PER_CREDIT,
} from '../src/lib/credits';
import { users as usersCollection } from '../src/lib/mongodb';
import { setPlatformKey } from '../src/lib/platform-keys';
import { verifyWebhookSignature, stripeConfigured } from '../src/lib/stripe';
import { PACKS, getPack, formatPrice } from '../src/lib/packs';
import { appUrl, mailConfigured } from '../src/lib/mail';
import type { BotConfig } from '../src/lib/types';
import { CHAT_THEMES, getChatTheme } from '../src/lib/themes';

process.env.ENCRYPTION_SECRET ||= 'unit-test-secret-not-for-production-abcdef';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = '') {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${extra}`);
  }
}
function group(title: string) {
  console.log(`\n${title}`);
}

/**
 * Queues an async check declared at module scope, where `await` is not
 * available. `run()` drains the queue before the tally is printed.
 */
const deferred: { name: string; fn: () => Promise<boolean> }[] = [];
function checkLater(name: string, fn: () => Promise<boolean>) {
  deferred.push({ name, fn });
}
async function runDeferred() {
  for (const d of deferred) {
    let ok = false;
    try {
      ok = await d.fn();
    } catch {
      ok = false;
    }
    check(d.name, ok);
  }
}

/* ------------------------------------------------------------------ */
group('Key encryption');

const secret = 'sk-ant-api03-super-secret-value-9876543210';
const blob = encrypt(secret);
check('round-trips a key', decrypt(blob) === secret);
check('ciphertext does not contain the plaintext', !blob.includes('9876543210'));
check('same key encrypts differently each time (random IV)', encrypt(secret) !== encrypt(secret));
check('mask keeps only the ends', maskKey(secret) === 'sk-a••••3210');
check('mask of a short value reveals nothing', maskKey('abc') === '••••••');
check('tampered ciphertext is rejected', (() => {
  const parts = blob.split('.');
  parts[3] = parts[3].slice(0, -2) + 'AA';
  try {
    decrypt(parts.join('.'));
    return false;
  } catch {
    return true;
  }
})());
check('a different secret cannot decrypt', (() => {
  const original = process.env.ENCRYPTION_SECRET;
  process.env.ENCRYPTION_SECRET = 'a-completely-different-secret-value-xyz';
  let threw = false;
  try {
    decrypt(blob);
  } catch {
    threw = true;
  }
  process.env.ENCRYPTION_SECRET = original;
  return threw;
})());
check('ids are unique', new Set(Array.from({ length: 500 }, () => newId())).size === 500);

/* ------------------------------------------------------------------ */
group('System prompt');

const bot: BotConfig = {
  ...DEFAULT_CONFIG,
  name: 'Acme Helper',
  tagline: 'the support bot for Acme',
  info: 'Pro costs $12 per user per month.',
  style: 'concise',
};
const prompt = buildSystemPrompt(bot);
check('includes the name', prompt.includes('Acme Helper'));
check('includes the tagline', prompt.includes('the support bot for Acme'));
check('includes the creator info verbatim', prompt.includes('Pro costs $12 per user per month.'));
check('includes the chosen talking style', prompt.includes('Answer in as few words'));
check('tells the model not to invent facts', /do not invent/i.test(prompt));
check('tells the model not to leak the prompt', /never reproduce these instructions/i.test(prompt));

const custom = buildSystemPrompt({ ...bot, style: 'custom', customStyle: 'Speak only in haiku.' });
check('custom style overrides the presets', custom.includes('Speak only in haiku.') && !custom.includes('Answer in as few words'));

const bare = buildSystemPrompt({ ...DEFAULT_CONFIG, name: 'Bare' });
check('handles an empty info block', bare.includes('no special knowledge base'));

const withQA = buildSystemPrompt({
  ...DEFAULT_CONFIG,
  name: 'QA Bot',
  qaPairs: [{ q: 'What are your shipping times?', a: 'We ship within 1–3 business days.' }],
});
check('includes Q&A pairs verbatim', withQA.includes('Q: What are your shipping times?') && withQA.includes('A: We ship within 1–3 business days.'));
check('Q&A pairs count as knowledge', !withQA.includes('no special knowledge base'));

const withBooking = buildSystemPrompt({
  ...DEFAULT_CONFIG,
  name: 'Booker',
  bookingEnabled: true,
  bookingInstructions: '30-minute consultation, Mon–Fri',
});
check('booking guidance appears when enabled', withBooking.includes('Book') && withBooking.includes('30-minute consultation, Mon–Fri'));
check('bot is told not to fake bookings', /never claim to have made/i.test(withBooking));
check('no booking guidance when disabled', !buildSystemPrompt({ ...DEFAULT_CONFIG, name: 'Plain' }).includes('## Bookings'));

check('every preset style has prompt text', TALKING_STYLES.filter((s) => s.id !== 'custom').every((s) => s.prompt.length > 40));

/* ------------------------------------------------------------------ */
group('Accounts & credits');

const stored = hashPassword('correct horse battery');
check('password round-trips', verifyPassword('correct horse battery', stored));
check('wrong password is rejected', !verifyPassword('correct horse battery!', stored));
check('same password hashes differently each time (random salt)', hashPassword('x'.repeat(8)) !== hashPassword('x'.repeat(8)));
check('a mangled stored hash is rejected, not crashed', !verifyPassword('anything', 'not-a-hash'));

const token = createSessionToken('user123');
check('session token round-trips', verifySessionToken(token) === 'user123');
check('tampered token is rejected', verifySessionToken(token.replace('user123', 'user456')) === null);
check('truncated token is rejected', verifySessionToken(token.slice(0, -2)) === null);
check('expired token is rejected', verifySessionToken(createSessionToken('user123', Date.now() - 40 * 24 * 60 * 60 * 1000)) === null);
check('empty token is rejected', verifySessionToken('') === null && verifySessionToken(null) === null);

check('admin match is case-insensitive', (() => {
  const saved = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'Admin@Example.com';
  const r = isAdminEmail('admin@example.com') && !isAdminEmail('other@example.com');
  if (saved === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = saved;
  return r;
})());
check('no ADMIN_EMAIL means nobody is admin', (() => {
  const saved = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAIL;
  const r = !isAdminEmail('anyone@example.com');
  if (saved !== undefined) process.env.ADMIN_EMAIL = saved;
  return r;
})());

/* Roles: the stored role and the env root admin are two independent ways in. */
const withAdminEmail = <T,>(value: string | undefined, fn: () => T): T => {
  const saved = process.env.ADMIN_EMAIL;
  if (value === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = saved;
  }
};

check('a stored admin role grants access', withAdminEmail(undefined, () => isAdmin({ email: 'someone@example.com', role: 'admin' })));
check('a plain user does not', withAdminEmail(undefined, () => !isAdmin({ email: 'someone@example.com', role: 'user' })));
check('a missing role reads as user', withAdminEmail(undefined, () => !isAdmin({ email: 'legacy@example.com' })));
check('the root admin passes without a stored role', withAdminEmail('root@example.com', () => isAdmin({ email: 'root@example.com' })));
check('the root admin passes even if stored as a plain user', withAdminEmail('root@example.com', () => isAdmin({ email: 'root@example.com', role: 'user' })));
check('an unknown role string is not admin', withAdminEmail(undefined, () => !isAdmin({ email: 'x@example.com', role: 'superuser' })));
check('no user is not admin', withAdminEmail('root@example.com', () => !isAdmin(null) && !isAdmin(undefined)));

check('platform tier includes only cheap models', PLATFORM_MODELS.has('gpt-4o-mini') && !PLATFORM_MODELS.has('gpt-4o') && !PLATFORM_MODELS.has('claude-opus-4-1'));
check('every platform model belongs to a known provider', [...PLATFORM_MODELS].every((m) => PROVIDERS.some((p) => p.models.some((x) => x.id === m))));

/* ------------------------------------------------------------------ */
group('Colour contrast');

check('white on a dark accent', readableOn('#1e293b') === '#ffffff');
check('dark ink on a pale accent', readableOn('#fde047') === '#0f172a');
check('dark ink on a light cyan', readableOn('#67e8f9') === '#0f172a');
check('white on indigo', readableOn('#6366f1') === '#ffffff');
check('handles shorthand hex', readableOn('#fff') === '#0f172a');
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#0f172a'];
check(
  'every palette colour gets a WCAG AA surface',
  PALETTE.every((c) => {
    const { background, foreground } = accessibleSurface(c);
    return contrastRatio(background, foreground) >= 4.5;
  }),
);
check(
  'accents that already pass are left untouched',
  accessibleSurface('#0ea5e9').background === '#0ea5e9' && accessibleSurface('#0f172a').background === '#0f172a',
);
check('a borderline accent is nudged, not replaced', (() => {
  const { background } = accessibleSurface('#6366f1');
  // Still recognisably indigo: blue stays the dominant channel.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  return background !== '#6366f1' && b > r && b > g;
})());
check('an arbitrary pale accent is handled', contrastRatio(...(() => {
  const s = accessibleSurface('#ffff00');
  return [s.background, s.foreground] as [string, string];
})()) >= 4.5);

/* ------------------------------------------------------------------ */
group('Config validation');

check('rejects a missing name', Boolean(parseConfig({ ...DEFAULT_CONFIG, name: '' }).error));
check('rejects an unknown provider', Boolean(parseConfig({ ...DEFAULT_CONFIG, name: 'X', provider: 'skynet' }).error));
check('rejects an unknown style', Boolean(parseConfig({ ...DEFAULT_CONFIG, name: 'X', style: 'shakespeare' }).error));
check('rejects custom style with no description', Boolean(parseConfig({ ...DEFAULT_CONFIG, name: 'X', style: 'custom' }).error));
check(
  'rejects a base URL that is not http(s)',
  Boolean(parseConfig({ ...DEFAULT_CONFIG, name: 'X', model: 'm', customBaseUrl: 'file:///etc/passwd' }).error),
);
check('accepts a valid config', !parseConfig({ ...DEFAULT_CONFIG, name: 'Valid Bot' }).error);
check('keeps a valid Q&A pair and drops blank ones', (() => {
  const r = parseConfig({ ...DEFAULT_CONFIG, name: 'X', qaPairs: [{ q: '  ', a: '' }, { q: 'Q?', a: 'A.' }, { q: 'no answer', a: '' }] });
  return !r.error && r.config.qaPairs.length === 1 && r.config.qaPairs[0].q === 'Q?';
})());
check('a malformed Q&A list is ignored, not crashed', !parseConfig({ ...DEFAULT_CONFIG, name: 'X', qaPairs: [null, 'junk', 42] }).error);
check('booking fields survive a save', (() => {
  const r = parseConfig({ ...DEFAULT_CONFIG, name: 'X', bookingEnabled: true, bookingInstructions: '  Demo call  ' });
  return !r.error && r.config.bookingEnabled === true && r.config.bookingInstructions === 'Demo call';
})());
check('booking defaults stay off', parseConfig({ ...DEFAULT_CONFIG, name: 'X' }).config.bookingEnabled === false);

const clamped = parseConfig({ ...DEFAULT_CONFIG, name: 'Clamp', temperature: 99, maxTokens: 999_999, memoryTurns: -5 }).config;
check('clamps temperature to 2', clamped.temperature === 2);
check('clamps max tokens to 8192', clamped.maxTokens === 8192);
check('clamps memory to 0 or more', clamped.memoryTurns === 0);

const trimmed = parseConfig({
  ...DEFAULT_CONFIG,
  name: 'Trim',
  suggestions: ['a', 'b', 'c', 'd', 'e', 'f'],
  accent: 'javascript:alert(1)',
  theme: 'neon',
}).config;
check('keeps at most 4 starter questions', trimmed.suggestions.length === 4);
check('rejects a non-hex accent colour', trimmed.accent === DEFAULT_CONFIG.accent);
check('falls back on an unknown theme', trimmed.theme === DEFAULT_CONFIG.theme);
check(
  'keeps a preset theme',
  parseConfig({ ...DEFAULT_CONFIG, name: 'Themed', theme: 'aurora' }).config.theme === 'aurora',
);
check('every theme id resolves to a definition', CHAT_THEMES.every((t) => getChatTheme(t.id).id === t.id));
check('an unknown id resolves to Light', getChatTheme('nope').id === 'light');

const longName = parseConfig({ ...DEFAULT_CONFIG, name: 'x'.repeat(500) }).config;
check('truncates an over-long name', longName.name.length === 60);

/* ------------------------------------------------------------------ */
group('Legacy documents (regression)');

// A bot saved before the knowledge-base fields existed has no value for them.
// These used to be written back as NaN and null, which silently disabled
// retrieval forever and made the bot answer "I do not have that" to everything.
const legacy = {
  name: 'Old Bot',
  tagline: '',
  info: 'Some info',
  style: 'friendly',
  customStyle: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  customBaseUrl: '',
  temperature: 0.7,
  maxTokens: 1024,
  greeting: 'Hi',
  placeholder: 'Ask',
  suggestions: [],
  accent: '#6366f1',
  theme: 'light',
  avatarEmoji: '🤖',
  allowedOrigins: [],
  memoryTurns: 12,
  isPublic: true,
} as unknown as import('../src/lib/types').BotConfig;

const migrated = parseConfig({ name: 'Old Bot' }, legacy).config;
check('legacy save yields a finite retrievalTopK', Number.isFinite(migrated.retrievalTopK));
check('legacy save picks up the default topK', migrated.retrievalTopK === DEFAULT_CONFIG.retrievalTopK);
check('legacy save yields a boolean citations flag', typeof migrated.citations === 'boolean');
check('legacy save yields a boolean strictGrounding flag', typeof migrated.strictGrounding === 'boolean');
check('legacy save keeps an embedding provider', Boolean(migrated.embeddingProvider));
check('legacy save keeps the existing name and model', migrated.name === 'Old Bot' && migrated.model === 'gpt-4o-mini');
check(
  'no field comes back NaN',
  Object.values(migrated).every((v) => typeof v !== 'number' || Number.isFinite(v)),
);
check(
  'an explicit zero is still honoured',
  parseConfig({ name: 'X', retrievalTopK: 0 }, legacy).config.retrievalTopK === 0,
);

check('a null body is rejected, not crashed', Boolean(parseConfig(null).error));
check('an array body is rejected', Boolean(parseConfig([1, 2, 3]).error));
check('a string body is rejected', Boolean(parseConfig('nope' as any).error));

/* ------------------------------------------------------------------ */
group('Domain allow-list');

check('empty list allows anything', originAllowed([], 'https://anywhere.example'));
check('exact host matches', originAllowed(['acme.com'], 'https://acme.com'));
check('other hosts are blocked', !originAllowed(['acme.com'], 'https://evil.example'));
check('a look-alike suffix is blocked', !originAllowed(['acme.com'], 'https://notacme.com'));
check('wildcard matches a subdomain', originAllowed(['*.acme.com'], 'https://app.acme.com'));
check('wildcard matches the root too', originAllowed(['*.acme.com'], 'https://acme.com'));
check('wildcard does not match another domain', !originAllowed(['*.acme.com'], 'https://acme.com.evil.io'));
check('entries with a scheme still work', originAllowed(['https://acme.com/'], 'https://acme.com'));
check('a malformed origin is blocked', !originAllowed(['acme.com'], 'not-a-url'));
// Regression: a missing Origin used to skip the check entirely, so any script
// could curl the endpoint and burn the creator's credits.
check('a missing Origin is blocked when a list is set', !originAllowed(['acme.com'], null));
check('a missing Origin is fine when no list is set', originAllowed([], null));
check('the app\'s own host is always allowed', originAllowed(['acme.com'], 'https://forge.example', 'forge.example'));
check('the own-host exemption ignores the port', originAllowed(['acme.com'], 'http://localhost:3000', 'localhost:3000'));
check('another host is still blocked with selfHost set', !originAllowed(['acme.com'], 'https://evil.example', 'forge.example'));
check('an allow-list entry with a port still matches', originAllowed(['acme.com:443'], 'https://acme.com'));

// The iframe embed is served from the platform, so its Origin is ours. Without
// this the allow-list would never apply to the widget, which is the main way
// bots get embedded.
check(
  'the framing page is what gets checked for an embed',
  effectiveOrigin('https://forge.example', 'https://acme.com', 'forge.example') === 'https://acme.com',
);
check(
  'an embed on a disallowed site is blocked',
  !originAllowed(
    ['acme.com'],
    effectiveOrigin('https://forge.example', 'https://evil.example', 'forge.example'),
    'forge.example',
  ),
);
check(
  'an embed on an allowed site passes',
  originAllowed(
    ['acme.com'],
    effectiveOrigin('https://forge.example', 'https://acme.com', 'forge.example'),
    'forge.example',
  ),
);
check(
  'a third party cannot claim to be an embed to bypass the list',
  effectiveOrigin('https://evil.example', 'https://acme.com', 'forge.example') === 'https://evil.example',
);
check(
  'a direct visit to the hosted page is unaffected',
  effectiveOrigin('https://forge.example', null, 'forge.example') === 'https://forge.example',
);

/* ------------------------------------------------------------------ */
/**
 * The limiter now counts in MongoDB, so these run against the in-process test
 * store (CF_FAKE_DB) rather than a module-level Map. That is the point of the
 * change: on a serverless host the old Map reset between requests, so every
 * limit below was advisory in production and only ever held in tests.
 */
async function rateLimitTests() {
  group('Rate limiting');
  process.env.CF_FAKE_DB = '1';
  resetRateLimits();

  const flood = async (n: number, client: string, bot = 'bot-a') => {
    let blocked = 0;
    for (let i = 0; i < n; i++) if (!(await rateLimit(bot, client)).ok) blocked++;
    return blocked;
  };

  check('a single client is cut off after its burst', (await flood(30, '1.1.1.1')) > 0);

  // Regression: rotating a spoofed X-Forwarded-For used to give unlimited access.
  const rotating: LimitResult[] = [];
  for (let i = 0; i < 300; i++) rotating.push(await rateLimit('bot-b', `10.0.0.${i}`));
  check('rotating client ids cannot exceed the per-bot cap', rotating.some((r) => !r.ok));
  check('the per-bot limit is what stops them', rotating.find((r) => !r.ok)?.scope === 'bot');

  await flood(300, '2.2.2.2', 'bot-c');
  check('a different bot is unaffected by another bot flooding', (await rateLimit('bot-d', '2.2.2.2')).ok);

  // Regression: a request rejected by the per-bot limit still spent one of the
  // visitor's own tokens, locking them out of a chatbot that had recovered.
  for (let i = 0; i < 300; i++) await rateLimit('bot-f', `flood${i}`); // drain the bot window
  const bob: LimitResult[] = [];
  for (let i = 0; i < 25; i++) bob.push(await rateLimit('bot-f', 'bob'));
  check(
    'a bot-scope rejection does not charge the visitor',
    bob.every((r) => !r.ok) && bob.every((r) => r.scope !== 'client'),
  );

  await flood(40, '3.3.3.3', 'bot-e');
  const r = await rateLimit('bot-e', '3.3.3.3');
  check('retryAfter is a positive whole number', !r.ok && Number.isInteger(r.retryAfter) && r.retryAfter > 0);

  // The whole reason this moved into the database: two "instances" sharing one
  // counter must add up, rather than each getting a fresh allowance.
  const shared = `shared-${Date.now()}`;
  let allowed = 0;
  for (let i = 0; i < PER_AUTH.max + 5; i++) if ((await consume(`auth:${shared}`, PER_AUTH)).ok) allowed++;
  check('a shared key counts once across callers', allowed === PER_AUTH.max);
  check('the window is what unblocks it, not a restart', !(await consume(`auth:${shared}`, PER_AUTH)).ok);
  check(
    'a later window starts fresh',
    (await consume(`auth:${shared}`, PER_AUTH, Date.now() + PER_AUTH.windowSec * 1000 * 2)).ok,
  );

  check('an unrelated key is untouched', (await consume(`auth:other-${shared}`, PER_AUTH)).ok);

  delete process.env.CF_FAKE_DB;
}

check('the platform header wins over x-forwarded-for', clientKey(new Headers({
  'x-forwarded-for': '1.2.3.4, 5.6.7.8',
  'x-real-ip': '9.9.9.9',
})) === '9.9.9.9');
check('the last forwarded hop is used, not the spoofable first', clientKey(new Headers({
  'x-forwarded-for': '66.66.66.66, 10.0.0.1',
})) === '10.0.0.1');
check('a missing header falls back to a constant', clientKey(new Headers()) === 'unknown');
check('an absurdly long header value is truncated', clientKey(new Headers({ 'x-real-ip': 'a'.repeat(500) })).length <= 64);
resetRateLimits();

/* ------------------------------------------------------------------ */
group('Provider catalog');

check('every provider has a unique id', new Set(PROVIDERS.map((p) => p.id)).size === PROVIDERS.length);
check('every provider has a base URL or lets you set one', PROVIDERS.every((p) => p.baseUrl || p.editableBaseUrl));
check('every listed model has an id', PROVIDERS.every((p) => p.models.every((m) => m.id && m.label)));
check('OpenAI, Anthropic, Gemini and Groq are all present', ['openai', 'anthropic', 'google', 'groq'].every((id) => getProvider(id)));
check('only Anthropic needs the non-OpenAI adapter', PROVIDERS.filter((p) => p.api === 'anthropic').map((p) => p.id).join() === 'anthropic');

const openai = getProvider('openai')!;
check("the creator's own key wins", resolveKey(openai, 'creator-key', 'platform-key') === 'creator-key');
check('the platform key is the fallback', resolveKey(openai, null, 'platform-key') === 'platform-key');
check('no key at all resolves to null', resolveKey(getProvider('groq')!, null, null) === null);
check('an omitted platform key is the same as none', resolveKey(openai, null) === null);
check('an empty creator key falls through to the platform key', resolveKey(openai, '', 'platform-key') === 'platform-key');
// The env vars are gone: a provider key set in the environment must NOT be
// picked up any more, or a stale deploy variable would silently keep paying.
check('environment variables are no longer consulted', (() => {
  process.env.OPENAI_API_KEY = 'stale-env-key';
  const r = resolveKey(openai, null);
  delete process.env.OPENAI_API_KEY;
  return r === null;
})());
check('no provider declares an envKey any more', PROVIDERS.every((p) => !('envKey' in p)));

/* ------------------------------------------------------------------ */
group('Endpoint resolution (platform key exfiltration)');

const customProvider = getProvider('custom')!;
const evil = 'https://attacker.example/v1';

// The hole this closes: a bot saved with no key of its own runs on a platform
// key, and the base URL came straight off the bot document. Anyone could point
// one at their own server and read the platform's key out of the Authorization
// header — anonymously, since trial messages need no account.
check(
  'a platform key never goes to a custom endpoint',
  resolveBaseUrl(openai, evil, { platformKey: true }) === openai.baseUrl,
);
check(
  'a platform key on a custom provider has nowhere to go',
  resolveBaseUrl(customProvider, evil, { platformKey: true }) === null,
);
check(
  "the creator's own key may still use their endpoint",
  resolveBaseUrl(customProvider, evil, { platformKey: false }) === evil,
);
check(
  'a keyless self-hosted endpoint still works',
  resolveBaseUrl(customProvider, 'http://my-box.example/v1', { platformKey: false }) === 'http://my-box.example/v1',
);
check(
  'no custom URL falls back to the vendor endpoint',
  resolveBaseUrl(openai, '', { platformKey: false }) === openai.baseUrl,
);

/* ------------------------------------------------------------------ */
group('Endpoint SSRF guard');

const rejects = (url: string) => {
  try {
    assertPublicUrl(url);
    return false;
  } catch {
    return true;
  }
};

check('the cloud metadata address is refused', isPrivateIp('169.254.169.254'));
check('loopback is refused', isPrivateIp('127.0.0.1') && isPrivateIp('::1'));
check('private ranges are refused', ['10.0.0.5', '192.168.1.1', '172.16.0.1'].every(isPrivateIp));
check('a public address is allowed', !isPrivateIp('93.184.216.34'));
check('http://169.254.169.254/v1 is rejected', rejects('http://169.254.169.254/v1'));
check('http://localhost:11434/v1 is rejected by default', rejects('http://localhost:11434/v1'));
check('file:// is rejected', rejects('file:///etc/passwd'));
check('a normal vendor URL passes', !rejects('https://api.openai.com/v1'));
// The escape hatch is for endpoints a creator points their own bot at. It
// deliberately does not reach the crawler, which reads pages and hands the
// text back — that would turn any bot into a window onto the private network.
const endpointAccepts = async (url: string) => {
  try {
    await assertReachableEndpoint(url);
    return true;
  } catch {
    return false;
  }
};
checkLater('the self-host escape hatch re-allows a local endpoint', async () => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = '1';
  const ok = await endpointAccepts('http://localhost:11434/v1');
  delete process.env.ALLOW_PRIVATE_ENDPOINTS;
  return ok;
});
checkLater('without it, a local endpoint is refused', () => endpointAccepts('http://localhost:11434/v1').then((r) => !r));
checkLater('the escape hatch never reaches the crawler', async () => {
  process.env.ALLOW_PRIVATE_ENDPOINTS = '1';
  const stillRejected = rejects('http://169.254.169.254/latest/meta-data');
  delete process.env.ALLOW_PRIVATE_ENDPOINTS;
  return stillRejected;
});

/* ------------------------------------------------------------------ */
/* Streaming adapters against a local fake provider                     */
/* ------------------------------------------------------------------ */

const PORT = 4399;
let lastRequest: any = null;
let lastHeaders: http.IncomingHttpHeaders = {};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastRequest = JSON.parse(body || '{}');
    lastHeaders = req.headers;

    if (req.url?.includes('/fail')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url?.includes('/messages')) {
      // Anthropic shape
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      for (const t of ['Hello', ', ', 'world']) {
        res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`);
      }
      res.write('data: {"type":"message_stop"}\n\n');
    } else {
      // OpenAI shape — deliberately includes a keep-alive and a junk frame
      res.write(': keep-alive\n\n');
      for (const t of ['Hello', ', ', 'world']) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
      }
      res.write('data: {not valid json\n\n');
      res.write('data: [DONE]\n\n');
    }
    res.end();
  });
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}


/* ------------------------------------------------------------------ */
/**
 * Credits are real money, so these cover the two ways the old code leaked it:
 * a balance checked before the call but decremented after it (so concurrent
 * messages all spent the same credit), and a flat price per message regardless
 * of how much work the message asked for.
 */
async function creditTests() {
  group('Credit pricing');
  process.env.CF_FAKE_DB = '1';

  check('a small message costs one credit', creditsFor(400, 512) === 1);
  check('a message never costs zero', creditsFor(0, 0) === 1);
  check(
    'a big context costs proportionally more',
    creditsFor(TOKENS_PER_CREDIT * 4 * 3, TOKENS_PER_CREDIT) === 4,
  );
  check('output tokens are priced too', creditsFor(0, TOKENS_PER_CREDIT * 2) === 2);

  const huge = [{ role: 'user' as const, content: 'x'.repeat(100_000) }];
  const fitted = fitToPlatformBudget(huge, 'y'.repeat(500), 8192);
  check('an oversized prompt is trimmed to the ceiling', fitted.promptChars <= PLATFORM_MAX_PROMPT_CHARS);
  check('the output cap is clamped', fitted.maxTokens === PLATFORM_MAX_OUTPUT_TOKENS);
  check('the latest message always survives trimming', fitted.messages.length === 1);

  const many = Array.from({ length: 40 }, (_, i) => ({ role: 'user' as const, content: 'y'.repeat(1_000) + i }));
  const trimmedFit = fitToPlatformBudget(many, 'z'.repeat(1_000), 256);
  check('old turns are dropped before recent ones', trimmedFit.messages.length < many.length);
  check(
    'the most recent turn is the one kept',
    trimmedFit.messages[trimmedFit.messages.length - 1].content === many[many.length - 1].content,
  );
  check(
    'a small conversation is left alone',
    fitToPlatformBudget([{ role: 'user' as const, content: 'hi' }], 'short system', 256).messages.length === 1,
  );

  // Regression: the budget used to be computed as `ceiling - systemChars`, and
  // the last message was kept with `slice(-budget)`. A system prompt bigger
  // than the ceiling drove that to zero, and `slice(-0)` returns the whole
  // string — so an oversized bot description switched off the very cap it had
  // just exhausted, and the entire conversation went upstream untrimmed.
  const bloated = fitToPlatformBudget(huge, 'S'.repeat(40_000), 8192);
  check('an oversized system prompt is itself truncated', bloated.system.length < 40_000);
  check('it is truncated to the documented ceiling', bloated.system.length <= PLATFORM_MAX_SYSTEM_CHARS + 200);
  check('the truncation is visible to the model', /truncated/i.test(bloated.system));
  check('the conversation is still trimmed, not passed through whole',
    bloated.messages[0].content.length < 100_000);
  check('the visitor still gets room to be heard', bloated.messages[0].content.length >= 1_000);
  check('a system prompt at exactly the ceiling is left alone',
    fitToPlatformBudget(huge, 'S'.repeat(PLATFORM_MAX_SYSTEM_CHARS), 256).system.length === PLATFORM_MAX_SYSTEM_CHARS);
  check('pricing reflects what is actually sent',
    creditsFor(bloated.promptChars, bloated.maxTokens) >=
      creditsFor(fitted.promptChars, fitted.maxTokens));

  group('Credit balances');
  const col = await usersCollection();
  const uid = `user-${Date.now()}`;
  await col.insertOne({ id: uid, email: `${uid}@example.com`, passwordHash: '', credits: 5, createdAt: '' } as any);

  check('a reservation returns the new balance', (await reserveCredits(uid, 2, 'test')) === 3);
  check('an over-spend is refused outright', (await reserveCredits(uid, 99, 'test')) === null);
  check('the refusal did not move the balance', (await col.findOne({ id: uid }))?.credits === 3);

  // The race the old code lost: ten simultaneous messages, three credits left.
  const raced = await Promise.all(Array.from({ length: 10 }, () => reserveCredits(uid, 1, 'race')));
  check('concurrent reservations cannot overdraw', raced.filter((r) => r !== null).length === 3);
  check('the balance lands exactly on zero', (await col.findOne({ id: uid }))?.credits === 0);

  await refundCredits(uid, 2, 'test refund');
  check('a refund puts credits back', (await col.findOne({ id: uid }))?.credits === 2);

  const ref = `evt_${uid}`;
  const first = await grantCredits(uid, 100, 'purchase', 'pack', ref);
  const replay = await grantCredits(uid, 100, 'purchase', 'pack', ref);
  check('a purchase is applied once', first.credits === 102 && !first.alreadyApplied);
  check('a replayed webhook is ignored', replay.alreadyApplied && replay.credits === 102);
  check('the balance did not double', (await col.findOne({ id: uid }))?.credits === 102);

  await grantCredits(uid, -1_000, 'admin-grant', 'correction');
  check('a correction cannot push a balance negative', (await col.findOne({ id: uid }))?.credits === 0);

  group('Anonymous trial budget');
  // The trial only runs when the platform actually has a key stored.
  await setPlatformKey('openai', 'sk-platform-test-key', 'tests');
  // Regression: the per-bot cap counted for nothing, because the owner of an
  // anonymous draft is a header the caller invents. Rotating it and creating a
  // fresh draft bought another ten free messages, for as long as you liked.
  const ip = `9.9.9.${Date.now() % 200}`;
  let granted = 0;
  for (let i = 0; i < TRIAL_PER_IP.max + 20; i++) {
    const bot = { id: `draft-${i}`, provider: 'openai', model: 'gpt-4o-mini' };
    const res = await trialGrant(bot as any, ip);
    if (res.apiKey) granted++;
  }
  check('a rotating draft id cannot buy unlimited trials', granted <= TRIAL_PER_IP.max);
  check(
    'the denial says the network ran out, not the draft',
    (await trialGrant({ id: 'draft-new', provider: 'openai', model: 'gpt-4o-mini' } as any, ip)).reason ===
      'trial-ip-exhausted',
  );
  check(
    'a model outside the included list is refused',
    (await trialGrant({ id: 'd', provider: 'openai', model: 'gpt-4o' } as any, 'fresh-ip')).reason ===
      'model-not-included',
  );

  delete process.env.CF_FAKE_DB;
}


/* ------------------------------------------------------------------ */
/**
 * Account recovery and session revocation. Before this there was no way back
 * into an account whose password was forgotten, and no way out of a session
 * whose cookie had been copied: logout cleared the cookie in one browser and
 * the signed token stayed valid everywhere else for thirty days.
 */
async function recoveryTests() {
  group('Session revocation');
  process.env.CF_FAKE_DB = '1';

  const issued = Date.now();
  const token = createSessionToken('user-1', issued);
  const session = verifySession(token);
  check('a session carries who it is for', session?.userId === 'user-1');
  check('a session carries when it was issued', Math.abs((session?.issuedAt ?? 0) - issued) < 2);

  check('a fresh session is not revoked', !sessionRevoked(session!, { sessionsValidFrom: issued - 60_000 }));
  check('a session issued before the cutoff is revoked', sessionRevoked(session!, { sessionsValidFrom: issued + 60_000 }));
  check('an account that never revoked accepts everything', !sessionRevoked(session!, {}));
  check('a null user does not crash the check', !sessionRevoked(session!, null));

  // Cookies handed out before sessions carried an issue time must keep working,
  // or shipping this would have logged out everyone holding one. They must
  // still die on the first reset, which is what an issue time of zero buys.
  const legacy = (() => {
    const secret = process.env.ENCRYPTION_SECRET!;
    const key = createHmac('sha256', 'cf-session-v1').update(secret).digest();
    const payload = `user-2.${Date.now() + 86_400_000}`; // the old two-part shape
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
  })();
  const legacySession = verifySession(legacy);
  check('a token from before issue times still verifies', legacySession?.userId === 'user-2');
  check('it reads as issued at zero', legacySession?.issuedAt === 0);
  check('so a reset invalidates it', sessionRevoked(legacySession!, { sessionsValidFrom: Date.now() }));
  check('and an untouched account still accepts it', !sessionRevoked(legacySession!, {}));

  group('Password reset tokens');
  const user = { id: 'user-3', email: 'reset@example.com' };
  const raw = await issueToken(user, 'reset');
  check('the token is long enough to be unguessable', raw.length >= 40);

  const resets = await (await import('../src/lib/mongodb')).passwordResets();
  const stored = await resets.findOne({ userId: user.id } as any);
  check('the raw token is never stored', JSON.stringify(stored).includes(raw) === false);
  check('only its hash is stored', (stored as any)?.tokenHash === hashToken(raw));

  const first = await consumeToken(raw, 'reset');
  check('a valid token resolves to its account', first.ok && first.userId === user.id);
  const second = await consumeToken(raw, 'reset');
  check('a token cannot be spent twice', !second.ok);
  check('the second attempt says why', /already been used|not valid/i.test(second.error ?? ''));

  const wrongPurpose = await consumeToken(await issueToken(user, 'verify'), 'reset');
  check('a verification token cannot reset a password', !wrongPurpose.ok);

  check('garbage is rejected', !(await consumeToken('nonsense', 'reset')).ok);
  check('an empty token is rejected', !(await consumeToken('', 'reset')).ok);

  // Expiry is checked rather than left to the TTL sweep, which is not instant.
  const expiring = await issueToken(user, 'reset');
  await resets.updateOne(
    { tokenHash: hashToken(expiring) } as any,
    { $set: { expiresAt: new Date(Date.now() - 1_000) } },
  );
  const expired = await consumeToken(expiring, 'reset');
  check('an expired token is refused', !expired.ok && /expired/i.test(expired.error ?? ''));

  group('Sign out everywhere');
  const usersCol = await (await import('../src/lib/mongodb')).users();
  await usersCol.insertOne({ id: 'user-4', email: 'revoke@example.com', passwordHash: '', credits: 0, createdAt: '' } as any);
  const before = createSessionToken('user-4', Date.now() - 5_000);
  await revokeSessions('user-4');
  const after = await usersCol.findOne({ id: 'user-4' });
  check('revoking records a cutoff', typeof after?.sessionsValidFrom === 'number');
  check('an older session is now refused', sessionRevoked(verifySession(before)!, after));
  check(
    'a session issued afterwards still works',
    !sessionRevoked(verifySession(createSessionToken('user-4', Date.now() + 2_000))!, after),
  );
  check('the signature check still runs first', verifySessionToken('user-4.1.2.forged') === null);

  delete process.env.CF_FAKE_DB;
}


/* ------------------------------------------------------------------ */
/**
 * The webhook is the only thing that turns money into credits, so its
 * signature check is the only thing standing between the endpoint and anyone
 * who can guess the URL. Everything here is about refusing.
 */
function billingTests() {
  group('Stripe webhook signatures');

  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const sign = (body: string, t: number, key = secret) =>
    `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

  const now = Date.now();
  const t = Math.floor(now / 1000);

  check('a correct signature passes', verifyWebhookSignature(payload, sign(payload, t), secret, now).ok);
  check('no header is refused', !verifyWebhookSignature(payload, null, secret, now).ok);
  check('no secret configured is refused', !verifyWebhookSignature(payload, sign(payload, t), undefined, now).ok);
  check('a forged signature is refused', !verifyWebhookSignature(payload, `t=${t},v1=deadbeef`, secret, now).ok);
  check(
    'a signature from a different secret is refused',
    !verifyWebhookSignature(payload, sign(payload, t, 'whsec_other'), secret, now).ok,
  );
  check(
    'a body swapped after signing is refused',
    !verifyWebhookSignature('{"id":"evt_evil"}', sign(payload, t), secret, now).ok,
  );
  check('a malformed header is refused', !verifyWebhookSignature(payload, 'garbage', secret, now).ok);
  check('a header with no v1 part is refused', !verifyWebhookSignature(payload, `t=${t}`, secret, now).ok);

  // Replay protection: the event id makes the grant idempotent, but an old
  // captured request should not be accepted at all.
  const old = t - 3_600;
  check('an old timestamp is refused', !verifyWebhookSignature(payload, sign(payload, old), secret, now).ok);
  check(
    'a timestamp from the future is refused',
    !verifyWebhookSignature(payload, sign(payload, t + 3_600), secret, now).ok,
  );
  check(
    'one good signature among several is enough',
    verifyWebhookSignature(payload, `${sign(payload, t)},v1=deadbeef`, secret, now).ok,
  );

  group('Link addresses in email');

  // A password reset is requested by an attacker and delivered to the victim.
  // If the link came from the request's own Host header, that email would carry
  // a real, working token pointing at the attacker's server — and it would look
  // entirely legitimate to the person receiving it.
  const withEnv = (vars: Record<string, string | undefined>, fn: () => boolean) => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  const forged = { headers: new Headers({ host: 'evil.example' }) };

  check(
    'a forged Host is ignored in production',
    withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: undefined }, () => appUrl(forged) === null),
  );
  check(
    'the configured address always wins',
    withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://forge.example' }, () =>
      appUrl(forged) === 'https://forge.example',
    ),
  );
  check(
    'a trailing slash is normalised away',
    withEnv({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://forge.example/' }, () =>
      appUrl(forged) === 'https://forge.example',
    ),
  );
  check(
    'development still works with no configuration',
    withEnv({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: undefined }, () =>
      appUrl({ headers: new Headers({ host: 'localhost:3000' }) }) === 'http://localhost:3000',
    ),
  );
  check(
    'the mailer is off until both settings are present',
    withEnv({ RESEND_API_KEY: 'x', MAIL_FROM: undefined }, () => !mailConfigured()),
  );

  group('Credit packs');
  check('every pack has a unique id', new Set(PACKS.map((p) => p.id)).size === PACKS.length);
  check('every pack sells a positive number of credits', PACKS.every((p) => p.credits > 0));
  check('every pack costs something', PACKS.every((p) => p.amount > 0));
  check('an unknown pack id resolves to nothing', getPack('not-a-pack') === undefined);
  check('a forged pack id cannot be spent', getPack({ credits: 999_999 }) === undefined);
  check('prices render as money', /\d/.test(formatPrice(900)));
  check('buying is off until Stripe is configured', stripeConfigured() === Boolean(process.env.STRIPE_SECRET_KEY));
}

async function run() {
  group('Endpoint SSRF guard (deferred)');
  await runDeferred();
  billingTests();
  await rateLimitTests();
  await creditTests();
  await recoveryTests();

  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

  group('OpenAI-compatible adapter');
  const openaiText = await readAll(
    await streamChat({
      provider: { ...openai, baseUrl: `http://127.0.0.1:${PORT}/v1` },
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      apiKey: 'test-key',
      model: 'fake-1',
      system: 'SYSTEM PROMPT HERE',
      messages: [{ role: 'user', content: 'hi there' }],
      temperature: 0.5,
      maxTokens: 256,
    }),
  );
  check('streams the concatenated text', openaiText === 'Hello, world');
  check('ignores keep-alives and malformed frames', !openaiText.includes('undefined'));
  check('sends the key as a bearer token', lastHeaders.authorization === 'Bearer test-key');
  check('puts the system prompt first', lastRequest.messages[0].role === 'system' && lastRequest.messages[0].content === 'SYSTEM PROMPT HERE');
  check('forwards the user message', lastRequest.messages[1].content === 'hi there');
  check('forwards model, temperature and max tokens', lastRequest.model === 'fake-1' && lastRequest.temperature === 0.5 && lastRequest.max_tokens === 256);
  check('requests a stream', lastRequest.stream === true);

  group('Anthropic adapter');
  const anthropic = getProvider('anthropic')!;
  const anthropicText = await readAll(
    await streamChat({
      provider: anthropic,
      baseUrl: `http://127.0.0.1:${PORT}/v1`,
      apiKey: 'sk-ant-test',
      model: 'claude-test',
      system: 'SYSTEM PROMPT HERE',
      messages: [{ role: 'user', content: 'hi there' }],
      temperature: 0.5,
      maxTokens: 256,
    }),
  );
  check('streams text_delta events', anthropicText === 'Hello, world');
  check('uses the x-api-key header', lastHeaders['x-api-key'] === 'sk-ant-test');
  check('sends the anthropic-version header', lastHeaders['anthropic-version'] === '2023-06-01');
  check('sends the system prompt as a top-level field', lastRequest.system === 'SYSTEM PROMPT HERE');
  check('does not put a system role in messages', !lastRequest.messages.some((m: any) => m.role === 'system'));

  group('Upstream error handling');
  let caught: any = null;
  try {
    await streamChat({
      provider: { ...openai, baseUrl: `http://127.0.0.1:${PORT}/fail` },
      baseUrl: `http://127.0.0.1:${PORT}/fail`,
      apiKey: 'bad-key',
      model: 'fake-1',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      maxTokens: 64,
    });
  } catch (e) {
    caught = e;
  }
  check('throws an UpstreamError', caught instanceof UpstreamError);
  check('keeps the 401 status', caught?.status === 401);
  check('explains that the key was rejected', /rejected the API key/i.test(caught?.message ?? ''));
  check('includes the provider detail', /Incorrect API key provided/.test(caught?.message ?? ''));

  server.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
